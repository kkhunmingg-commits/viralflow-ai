/**
 * Browser side of the Flow farm: one signed-in Chrome profile per Flow account, run without showing the
 * Flow page (off-screen window by default, or headless). It fills the prompt, checks the credit cost,
 * clicks Generate once, waits for the new video and saves it. It reports what Flow showed; farm-core decides.
 *
 * Selectors default to Flow's current UI (Thai or English) and can be overridden in selectors.json under
 * "farm" after checking with `farm.mjs --probe <accountId>`, which never clicks Generate.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
/** Flow shows a finished clip as a poster image served from /asb/; its <video> only appears while the pointer is on it. */
export async function resultPosters(page) {
  return page.evaluate(() => [...document.querySelectorAll("img")].map(img => img.src).filter(src => /^https:\/\/[^/]*flow\.google\.com\/asb\//.test(src))).catch(() => []);
}
export async function revealVideos(page, posters) {
  for (const src of posters) {
    await page.locator(`img[src="${src.replace(/"/g, '\\"')}"]`).first().hover({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
  }
  return videoSources(page);
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

/** A new Flow project starts at x2 outputs (double the credits); picks x1 in the settings panel. Never clicks Generate. */
export async function chooseSingleOutput(page, selectors) {
  const chip = await firstVisible(page, selectors.settingsChip);
  if (!chip || !/\bx[2-4]\b/.test(await chip.innerText().catch(() => ""))) return;
  await chip.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const one = page.getByRole("radio", { name: /^x1$/ }).first();
  if (await one.count() && await one.getAttribute("aria-checked") !== "true") await one.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
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
 * not signed in gets an ordinary Chrome window to sign in, then is checked again once that window is closed. Never clicks Generate.
 */
export async function signInFlowAccount(account, config, { timeoutMs = 15 * 60_000, pollMs = 2_000 } = {}) {
  const selectors = { ...DEFAULT_FARM_SELECTORS, ...(config.selectors ?? {}) };
  const profile = join(config.profilesDir, account.id);
  const costNote = async page => {
    try {
      await openComposer(page, { flowUrl: config.flowUrl, selectors });
      await chooseSingleOutput(page, selectors);
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

  // Google refuses to sign in inside a browser driven by automation, so the window is plain Chrome on the same
  // profile. Once the person closes it, the profile is checked quietly again.
  const closed = await openPlainChrome(profile, config, timeoutMs);
  if (!closed) return { state: "FAILED", note: "ไม่ได้ล็อกอินภายใน 15 นาที" };
  const again = await launchProfile(profile, { mode: config.windowMode === "headless" ? "headless" : "offscreen", channel: config.channel });
  try {
    const page = again.pages()[0] ?? await again.newPage();
    await page.goto(config.flowUrl, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    if (await flowReady(page, selectors, config.flowUrl)) return { state: "READY", note: await costNote(page) };
    return { state: "FAILED", note: "ยังไม่ได้ล็อกอิน Google กด “ล็อกอินใหม่” แล้วล็อกอินให้จบก่อนปิดหน้าต่าง" };
  } finally { await again.close().catch(() => {}); }
}

/** The Chrome the farm drives (FLOW_CHROME_PATH, installed Chrome for the "chrome" channel, or Playwright's Chromium). */
export async function chromePath(channel, env = process.env) {
  if (env.FLOW_CHROME_PATH) return env.FLOW_CHROME_PATH;
  if (channel === "chrome" && process.platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    for (const base of roots) {
      const candidate = join(base, "Google", "Chrome", "Application", "chrome.exe");
      if (await access(candidate).then(() => true, () => false)) return candidate;
    }
  }
  const { chromium } = await import("playwright");
  return chromium.executablePath();
}

/** Opens the profile in ordinary Chrome on screen; resolves true when the person closes it, false on timeout. */
export async function openPlainChrome(profileDir, config, timeoutMs = 15 * 60_000) {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(await chromePath(config.channel), [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check",
    "--new-window", "--window-position=80,60", "--window-size=1280,900", config.flowUrl], { stdio: "ignore" });
  return new Promise(done => {
    const timer = setTimeout(() => { child.kill(); done(false); }, timeoutMs);
    child.once("exit", () => { clearTimeout(timer); done(true); });
    child.once("error", () => { clearTimeout(timer); done(false); });
  });
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
      await chooseSingleOutput(page, selectors);
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

      const beforeText = await bodyText(page), beforePosters = new Set(await resultPosters(page));
      const beforeVideos = await revealVideos(page, beforePosters);
      await config.journal?.(clip.id, { state: "GENERATING", account: account.id, cost, clickedAt: new Date().toISOString() });
      await button.click({ timeout: 15_000 });
      const deadline = Date.now() + config.maxWaitMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(config.pollMs);
        const text = await bodyText(page);
        const posters = (await resultPosters(page)).filter(src => !beforePosters.has(src));
        const added = newVideoSources(beforeVideos, posters.length ? await revealVideos(page, posters) : await videoSources(page));
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
