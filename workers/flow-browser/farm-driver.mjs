/**
 * Browser side of the Flow farm: one signed-in Chrome profile per Flow account, run without showing the
 * Flow page (off-screen window by default, or headless). It fills the prompt, checks the credit cost,
 * clicks Generate once, waits for the new video and saves it. It reports what Flow showed; farm-core decides.
 *
 * Selectors default to Flow's current UI (Thai or English) and can be overridden in selectors.json under
 * "farm" after checking with `farm.mjs --probe <accountId>`, which never clicks Generate.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appeared, costDecision, FAILED_PATTERNS, newVideoSources, NO_CREDIT_PATTERNS, parseCreditCost, SIGN_IN_HOSTS } from "./farm-core.mjs";
import { inspectMp4, isFlowLocation } from "./core.mjs";
import { inspectVideo } from "./media.mjs";

export const DEFAULT_FARM_SELECTORS = Object.freeze({
  newProject: "",
  prompt: "textarea, [contenteditable=\"true\"][role=\"textbox\"]",
  generate: "button:has-text(\"arrow_forward\")",
  settingsChip: "button:has-text(\"720p\"), button:has-text(\"1080p\")",
  imageInput: "input[type=\"file\"]",
});
const NEW_PROJECT_NAME = /new project|โปรเจกต์ใหม่|โปรเจ็กต์ใหม่|สร้างโปรเจ/i;
const GENERATE_NAME = /^(สร้าง|create|generate|send)$/i;

export function windowArgs(mode) {
  // Off-screen keeps a real, fully rendering window (Google treats it as a normal browser) that never appears.
  const keepRendering = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"];
  if (mode === "offscreen") return ["--window-position=-32000,-32000", "--window-size=1280,900", ...keepRendering];
  // The profile remembers the off-screen placement, so a window meant to be seen must say where to open.
  if (mode === "visible") return ["--window-position=80,60", "--window-size=1280,900", ...keepRendering];
  return keepRendering;
}

export async function launchProfile(profileDir, { mode = "offscreen", channel, downloadsPath, executablePath = process.env.FLOW_CHROME_PATH } = {}) {
  const { chromium } = await import("playwright");
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  return chromium.launchPersistentContext(profileDir, {
    headless: mode === "headless", channel: executablePath ? undefined : channel || undefined, executablePath: executablePath || undefined,
    acceptDownloads: true, downloadsPath,
    viewport: { width: 1280, height: 900 }, args: windowArgs(mode),
  });
}

async function bodyText(page) {
  return page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
}
async function videoSources(page) {
  return page.evaluate(() => [...document.querySelectorAll("video")].flatMap(video =>
    [video.currentSrc, video.getAttribute("src"), ...[...video.querySelectorAll("source")].map(s => s.getAttribute("src"))])
    .filter(Boolean).map(src => new URL(src, location.href).href)).catch(() => []);
}
function signedOut(url) {
  try { return SIGN_IN_HOSTS.includes(new URL(url).hostname); } catch { return true; }
}
function fail(reason, started = false) { return { status: "FAILED", reason, started }; }

export async function firstVisible(page, selector) {
  const all = page.locator(selector);
  const count = await all.count();
  for (let i = count - 1; i >= 0; i--) if (await all.nth(i).isVisible().catch(() => false)) return all.nth(i);
  return null;
}
async function generateButton(page, selectors) {
  return await firstVisible(page, selectors.generate)
    ?? (await page.getByRole("button", { name: GENERATE_NAME }).count() ? page.getByRole("button", { name: GENERATE_NAME }).last() : null);
}

/** Opens Flow and makes sure a prompt box is on screen (creating a project if Flow shows its home page). */
export async function openComposer(page, { flowUrl, selectors, timeout = 45_000 }) {
  await page.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (signedOut(page.url()) || !isFlowLocation(page.url()) && !page.url().startsWith(flowUrl)) throw new Error("FLOW_LOGIN_REQUIRED");
  let prompt = await firstVisible(page, selectors.prompt);
  if (!prompt) {
    const create = selectors.newProject ? page.locator(selectors.newProject).first() : page.getByRole("button", { name: NEW_PROJECT_NAME }).first();
    if (await create.count()) await create.click({ timeout: 15_000 });
    const deadline = Date.now() + timeout;
    while (!prompt && Date.now() < deadline) { await page.waitForTimeout(700); prompt = await firstVisible(page, selectors.prompt); }
  }
  if (!prompt) throw new Error("PROMPT_BOX_NOT_FOUND");
  return prompt;
}

/** Reads the cost Flow shows for the current settings, opening the settings panel briefly if needed. */
export async function readCost(page, selectors) {
  let cost = parseCreditCost(await bodyText(page));
  if (cost != null) return cost;
  const chip = await firstVisible(page, selectors.settingsChip);
  if (!chip) return null;
  await chip.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  cost = parseCreditCost(await bodyText(page));
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  return cost;
}

async function attachReference(page, selectors, imageUrl, scratchDir, clipId) {
  if (!imageUrl) return;
  const response = await page.request.get(imageUrl, { timeout: 20_000, maxRedirects: 0 });
  if (!response.ok()) throw new Error("PRODUCT_IMAGE_LINK_EXPIRED");
  const type = response.headers()["content-type"] ?? "", bytes = await response.body();
  if (bytes.length > 12_000_000 || !/^image\/(png|jpeg|webp)/.test(type)) throw new Error("INVALID_PRODUCT_IMAGE");
  const path = join(scratchDir, `ingredient-${clipId}${type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg"}`);
  await writeFile(path, bytes);
  try {
    const input = page.locator(selectors.imageInput).first();
    if (!await input.count()) throw new Error("IMAGE_INPUT_NOT_FOUND");
    await input.setInputFiles(path);
    await page.waitForTimeout(4000);
  } finally { await rm(path, { force: true }); }
}

async function saveVideo(page, src, path) {
  let bytes;
  if (src.startsWith("blob:")) {
    const base64 = await page.evaluate(async url => {
      const blob = await (await fetch(url)).blob();
      return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(blob); });
    }, src);
    bytes = Buffer.from(base64, "base64");
  } else {
    const response = await page.request.get(src, { timeout: 90_000 });
    if (!response.ok()) throw new Error("VIDEO_DOWNLOAD_FAILED");
    bytes = await response.body();
  }
  inspectMp4(bytes);
  await writeFile(path, bytes);
  return bytes;
}

/**
 * One Flow account's session. generate(clip) never clicks Generate twice for a clip; once clicked, any
 * later problem is reported as started:true so the clip is not retried automatically.
 */
/** True once Flow itself has loaded for a signed-in user (its prompt box or its "new project" button is showing). */
async function flowReady(page, selectors, flowUrl) {
  if (signedOut(page.url()) || !isFlowLocation(page.url()) && !page.url().startsWith(flowUrl)) return false;
  if (await firstVisible(page, selectors.prompt)) return true;
  const create = selectors.newProject ? page.locator(selectors.newProject) : page.getByRole("button", { name: NEW_PROJECT_NAME });
  return (await create.count().catch(() => 0)) > 0;
}

/**
 * Signs one Google account in for the farm. The saved profile is checked out of sight first; only an account that is
 * not signed in gets a visible window, which closes by itself as soon as Flow loads. Never clicks Generate.
 */
export async function signInFlowAccount(account, config, { timeoutMs = 15 * 60_000, pollMs = 2_000 } = {}) {
  const selectors = { ...DEFAULT_FARM_SELECTORS, ...(config.selectors ?? {}) };
  const profile = join(config.profilesDir, account.id);
  const costNote = async page => {
    try {
      await openComposer(page, { flowUrl: config.flowUrl, selectors });
      const cost = await readCost(page, selectors);
      const decision = costDecision(cost, config.costPolicy);
      return decision.ok ? (cost == null ? undefined : `${cost} เครดิต/คลิป`) : `ตั้งโมเดลใน Flow เป็น Veo 3.1 - Lite x1 (ตอนนี้ ${cost ?? "?"} เครดิต/คลิป)`;
    } catch { return undefined; }
  };
  const quiet = await launchProfile(profile, { mode: config.windowMode === "visible" || config.windowMode === "headless" ? config.windowMode : "offscreen", channel: config.channel });
  try {
    const page = quiet.pages()[0] ?? await quiet.newPage();
    await page.goto(config.flowUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    if (await flowReady(page, selectors, config.flowUrl)) return { state: "READY", note: await costNote(page) };
  } finally { await quiet.close().catch(() => {}); }

  const shown = await launchProfile(profile, { mode: "visible", channel: config.channel });
  try {
    const page = shown.pages()[0] ?? await shown.newPage();
    await page.goto(config.flowUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!shown.pages().length) return { state: "FAILED", note: "ปิดหน้าต่างก่อนล็อกอินเสร็จ" };
      const current = shown.pages().at(-1);
      if (await flowReady(current, selectors, config.flowUrl).catch(() => false)) return { state: "READY", note: await costNote(current) };
      await new Promise(done => setTimeout(done, pollMs));
    }
    return { state: "FAILED", note: "ไม่ได้ล็อกอินภายใน 15 นาที" };
  } finally { await shown.close().catch(() => {}); }
}

export async function openFlowAccount(account, config) {
  const context = await launchProfile(join(config.profilesDir, account.id), { mode: config.windowMode, channel: config.channel, downloadsPath: config.downloadsDir });
  const page = context.pages()[0] ?? await context.newPage();
  const selectors = { ...DEFAULT_FARM_SELECTORS, ...(config.selectors ?? {}) };
  return {
    async close() { await context.close(); },
    async probe() {
      const report = { account: account.label, signedIn: false, promptBox: false, generateButton: false, cost: null, noCreditNotice: false, url: "" };
      try { await openComposer(page, { flowUrl: config.flowUrl, selectors }); report.signedIn = true; report.promptBox = true; }
      catch (error) { report.error = error.message; report.signedIn = error.message !== "FLOW_LOGIN_REQUIRED"; }
      report.url = page.url();
      report.generateButton = Boolean(await generateButton(page, selectors));
      report.cost = await readCost(page, selectors);
      report.noCreditNotice = appeared("", await bodyText(page), NO_CREDIT_PATTERNS);
      return report;
    },
    async generate(clip) {
      let prompt;
      try { prompt = await openComposer(page, { flowUrl: config.flowUrl, selectors }); }
      catch (error) { return fail(error.message); }
      if (appeared("", await bodyText(page), NO_CREDIT_PATTERNS)) return { status: "NO_CREDIT" };
      try { await attachReference(page, selectors, clip.imageUrl, config.scratchDir, clip.id); }
      catch (error) { return fail(error.message); }
      // Cost depends on the saved model/outputs, not the prompt: check it before typing anything.
      const cost = await readCost(page, selectors);
      const decision = costDecision(cost, config.costPolicy);
      if (!decision.ok) return fail(decision.reason);
      await prompt.click();
      await prompt.fill(clip.prompt);
      const button = await generateButton(page, selectors);
      if (!button) return fail("GENERATE_BUTTON_NOT_FOUND");
      if (await button.isDisabled().catch(() => false)) {
        return appeared("", await bodyText(page), NO_CREDIT_PATTERNS) ? { status: "NO_CREDIT" } : fail("GENERATE_BUTTON_DISABLED");
      }
      if (config.dryRun) return { status: "DRY_RUN", detail: `ล็อกอินแล้ว เจอช่อง prompt และปุ่ม Generate ค่าเครดิต ${cost ?? "ไม่ทราบ"}` };

      const beforeText = await bodyText(page), beforeVideos = await videoSources(page);
      await config.journal?.(clip.id, { state: "GENERATING", account: account.id, cost, clickedAt: new Date().toISOString() });
      await button.click({ timeout: 15_000 });
      const deadline = Date.now() + config.maxWaitMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(config.pollMs);
        const text = await bodyText(page);
        const added = newVideoSources(beforeVideos, await videoSources(page));
        if (added.length) {
          const path = join(config.readyDir, `${clip.id}.mp4`);
          try {
            const bytes = await saveVideo(page, added[0], path);
            const media = await inspectVideo(path);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            await config.journal?.(clip.id, { state: "DOWNLOADED", path, sha256 });
            return { status: "OK", path, sha256, bytes: bytes.length, media, cost };
          } catch (error) { return fail(error.message, true); }
        }
        // Refused for credits right after the click: Flow did not take the job.
        if (appeared(beforeText, text, NO_CREDIT_PATTERNS)) return { status: "NO_CREDIT" };
        if (appeared(beforeText, text, FAILED_PATTERNS)) return fail("FLOW_REPORTED_FAILURE", true);
      }
      return fail("NEW_VIDEO_TIMEOUT_CHECK_FLOW", true);
    },
  };
}

export async function readVideoFile(path) { return readFile(path); }
