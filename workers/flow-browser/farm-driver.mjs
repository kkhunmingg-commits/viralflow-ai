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
import { appeared, costDecision, FAILED_PATTERNS, newVideoSources, NO_CREDIT_PATTERNS, parseCreditCost, SIGN_IN_HOSTS, UNUSUAL_ACTIVITY_PATTERNS } from "./farm-core.mjs";
import { inspectMp4, isFlowLocation } from "./core.mjs";
import { inspectVideo } from "./media.mjs";

export const DEFAULT_FARM_SELECTORS = Object.freeze({
  newProject: "",
  prompt: "textarea, [contenteditable=\"true\"][role=\"textbox\"]",
  generate: "button:has-text(\"arrow_forward\")",
  settingsChip: "button:has-text(\"360p\"), button:has-text(\"720p\"), button:has-text(\"1080p\")",
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

/** Flow project pages ("…/project/<id>"), as opposed to Flow's home page. */
export const isProjectUrl = url => /\/project\/[A-Za-z0-9_-]+/.test(url);
const projectsFile = dir => join(dir, "episode-projects.json");
/** { "<account id>:<episode id>": "<Flow project URL>" }, kept for the last 200 episodes. */
async function readProjects(dir) {
  if (!dir) return {};
  try { const saved = JSON.parse(await readFile(projectsFile(dir), "utf8")); return saved && typeof saved === "object" ? saved : {}; }
  catch { return {}; }
}
async function saveProjects(dir, projects) {
  if (!dir) return;
  const keep = Object.fromEntries(Object.entries(projects).slice(-200));
  await mkdir(dir, { recursive: true });
  await writeFile(projectsFile(dir), JSON.stringify(keep));
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

const LITE_MODEL = /Veo\s*3\.1\s*[-–]?\s*Lite/i;
// Drama shots (Lucky, 7 Nov): Omni 1.2 Flash, 360p, 10 seconds, 10 credits. It keeps shots continuous far better;
// the lower picture quality is accepted. Promo clips stay on Veo 3.1 Lite.
const OMNI_MODEL = /Omni\s*1\.2\s*Flash/i;
/** Flow settings for a clip: what model, resolution and length every account must use for it. */
export function videoPlan(kind) {
  return kind === "DRAMA_SHOT" ? { model: OMNI_MODEL, resolution: /^\s*360p/, seconds: 10 } : { model: LITE_MODEL, resolution: null, seconds: null };
}
/** The composer's settings chip: "วิดีโอ · 720p · 8 วินาที crop_9_16 x1" (or "Nano Banana … x2" on a fresh account). */
async function settingsChip(page, selectors) {
  // In a narrow window Flow folds the chip ("Nano Banana 2.1 crop x2" on a fresh account) into a "tune" icon button.
  return await firstVisible(page, selectors.settingsChip) ?? await firstVisible(page, 'button:has-text("crop_")')
    ?? await firstVisible(page, 'button:has-text("tune")');
}
/** Moves Flow's length slider ("ความยาว 10 วินาที") to `seconds` with the arrow keys. Never clicks Generate. */
async function setLength(page, seconds) {
  const slider = page.getByRole("slider").first();
  if (!await slider.count()) return;
  await slider.focus().catch(() => {});
  for (let i = 0; i < 20; i++) {
    const now = Number(await slider.getAttribute("aria-valuenow").catch(() => null));
    if (!Number.isFinite(now) || now === seconds) break;
    await page.keyboard.press(now < seconds ? "ArrowRight" : "ArrowLeft").catch(() => {});
    await page.waitForTimeout(150);
  }
}
async function pickRadio(page, name) {
  const radio = page.getByRole("radio", { name }).first();
  if (await radio.count() && await radio.getAttribute("aria-checked") !== "true") { await radio.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(400); }
}
/**
 * Sets what every account must use, whatever Flow last remembered for it: video, 9:16, Veo 3.1 Lite, one output, and
 * frames (a start picture) or ingredients mode. A newly added account starts on the image model, whose cost is not a
 * video's. Never clicks Generate. True when the panel was found.
 */
// Flow's Agent (chat) side panel, seen on newly added accounts (7 Nov, ninokuniman2/3): "สวัสดี คุณ nino / คุณต้องการสร้างอะไร"
// in an untitled session, with its own "tune" button that opens the Agent's settings instead of the video composer's.
const AGENT_PANEL = /เซสชันที่ไม่มีชื่อ|untitled session/i, AGENT_SETTINGS = /การตั้งค่า\s*Agent|Agent settings/i;
/** Closes the Agent chat panel when it is open, so the video composer (frames, 720p chip) is what the worker uses. */
export async function closeAgentPanel(page) {
  if (!AGENT_PANEL.test(await bodyText(page))) return false;
  const title = page.getByText(AGENT_PANEL).first();
  const close = title.locator("xpath=ancestor::*[.//button][1]").locator('button:has-text("close")').first();
  if (!await close.count()) return false;
  await close.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return true;
}
export async function chooseVideoSettings(page, selectors, { frames = false, plan = videoPlan() } = {}) {
  await closeAgentPanel(page);
  const chip = await settingsChip(page, selectors);
  if (!chip) return false;
  await chip.click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  // The folded "tune" button can belong to the Agent: its settings are not the video composer's, so leave them alone.
  if (AGENT_SETTINGS.test(await bodyText(page))) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
    return false;
  }
  try {
    await pickRadio(page, /วิดีโอ|video/i);
    // Switching from the image model redraws the panel; the frames choice only appears after it.
    await page.waitForTimeout(600);
    if (frames) await pickRadio(page, /เฟรม|frames?/i);
    await pickRadio(page, /9:16/);
    const model = page.locator('button:has-text("arrow_drop_down")').filter({ hasText: /Veo|Omni|Flash|Lite|Fast|Quality/i }).last();
    if (await model.count() && !plan.model.test(await model.innerText().catch(() => ""))) {
      await model.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(600);
      const wanted = page.getByRole("menuitem", { name: plan.model }).or(page.getByRole("option", { name: plan.model })).first();
      if (await wanted.count()) { await wanted.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(800); }
    }
    // Omni shows a resolution switch (360p / 720p) and a length slider under the model.
    if (plan.resolution) {
      await pickRadio(page, plan.resolution);
      const button = page.getByRole("button", { name: plan.resolution }).first();
      if (!await page.getByRole("radio", { name: plan.resolution }).count() && await button.count()) { await button.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(400); }
    }
    if (plan.seconds) await setLength(page, plan.seconds);
    await pickRadio(page, /^x1$/);
  } finally {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }
  return true;
}

async function attachReference(page, selectors, imageUrl, scratchDir, clipId, { frames = false } = {}) {
  if (!imageUrl) return;
  const response = await page.request.get(imageUrl, { timeout: 20_000, maxRedirects: 0 });
  if (!response.ok()) throw new Error("PRODUCT_IMAGE_LINK_EXPIRED");
  const type = response.headers()["content-type"] ?? "", bytes = await response.body();
  if (bytes.length > 12_000_000 || !/^image\/(png|jpeg|webp)/.test(type)) throw new Error("INVALID_PRODUCT_IMAGE");
  const path = join(scratchDir, `ingredient-${clipId}${type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg"}`);
  await writeFile(path, bytes);
  try {
    const input = page.locator(selectors.imageInput).first();
    if (selectors.imageInput && await input.count()) { await input.setInputFiles(path); await page.waitForTimeout(4000); return; }
    // Flow (Nov 2026): frames mode has a "เริ่ม" (start) slot, ingredients mode an "add" button; either opens a picker
    // whose "อัปโหลดสื่อ" button asks for a file.
    const startSlot = () => page.locator("button.empty-chip").filter({ hasText: /^\s*(เริ่ม|start)\s*$/i }).first();
    const slot = frames ? startSlot() : page.getByRole("button", { name: /^add$/ }).last();
    if (!await slot.count()) throw new Error("IMAGE_INPUT_NOT_FOUND");
    await slot.click({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    const upload = page.getByRole("button", { name: /อัปโหลดสื่อ|upload/i }).last();
    if (!await upload.count()) throw new Error("IMAGE_INPUT_NOT_FOUND");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15_000 }), upload.click({ timeout: 10_000 })]);
    await chooser.setFiles(path);
    // The picture uploads into the picker; when the picker stays open, pick the newest picture in it.
    const deadline = Date.now() + 40_000;
    let picked = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      if (frames && !await startSlot().isVisible().catch(() => false)) return;
      const picker = page.locator(':text("เลือกรูปภาพ"), :text("Select")').first();
      if (!await picker.isVisible().catch(() => false)) { if (!frames) return; continue; }
      // The uploaded picture shows in the picker's preview with "เพิ่มไปยังพรอมต์" (add to prompt) under it.
      const add = page.getByRole("button", { name: /เพิ่มไปยังพรอมต์|add to prompt/i }).last();
      if (await add.isVisible().catch(() => false)) { await add.click({ timeout: 5_000 }).catch(() => {}); continue; }
      if (!picked) {
        const image = picker.locator("xpath=ancestor::*[.//img][1]").locator("img").first();
        if (await image.count()) { await image.click({ timeout: 5_000 }).catch(() => {}); picked = true; }
      }
    }
    throw new Error("IMAGE_NOT_ATTACHED");
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
      const step = (stage, detail) => config.progress?.(clip.id, stage, detail);
      let prompt;
      // Lucky, 7 Nov: every shot of an episode goes into the same Flow project of this account, so the shots match.
      // The project of the episode's first shot is remembered and opened again for the next ones.
      const projects = clip.projectKey ? await readProjects(config.scratchDir) : {};
      const projectKey = clip.projectKey ? `${account.id}:${clip.projectKey}` : null;
      const known = projectKey ? projects[projectKey] : null;
      try {
        prompt = known ? await openComposer(page, { flowUrl: known, selectors }).catch(() => null) : null;
        prompt ??= await openComposer(page, { flowUrl: config.flowUrl, selectors });
      } catch (error) { return fail(error.message); }
      if (projectKey && isProjectUrl(page.url()) && projects[projectKey] !== page.url()) {
        projects[projectKey] = page.url().split("?")[0];
        await saveProjects(config.scratchDir, projects).catch(() => {});
      }
      // No early "out of credits" here: Flow keeps old credit notices on the page after the credits renew (6 Nov: the
      // main account renewed at 23:09 and three shots were still turned away as out of credits). Only a Generate
      // button Flow has disabled, or a notice that appears after the click, counts.
      if (clip.imageUrl) await step("ATTACHING_IMAGE");
      // A drama shot continues from a picture (the last frame, or the key still): Flow's "frames" mode, start slot.
      const frames = clip.kind === "DRAMA_SHOT" && Boolean(clip.imageUrl);
      const plan = videoPlan(clip.kind);
      // The prompt box found may be the Agent chat's: close that panel and take the composer's own box.
      if (await closeAgentPanel(page)) prompt = await firstVisible(page, selectors.prompt) ?? prompt;
      await chooseVideoSettings(page, selectors, { frames, plan });
      try { await attachReference(page, selectors, clip.imageUrl, config.scratchDir, clip.id, { frames }); }
      catch (error) {
        // A newly added account opens on Flow's image model, and the switch to video + frames does not always take on
        // the first try (7 Nov, ninokuniman2: no start slot). Open the composer again, set it once more, then retry.
        if (error.message !== "IMAGE_INPUT_NOT_FOUND") { await saveDebug(page, config.debugDir, clip.id, "image"); return fail(error.message); }
        try {
          await page.keyboard.press("Escape").catch(() => {});
          prompt = await openComposer(page, { flowUrl: config.flowUrl, selectors });
          await page.waitForTimeout(1500);
          await chooseVideoSettings(page, selectors, { frames, plan });
          await page.waitForTimeout(1500);
          await chooseVideoSettings(page, selectors, { frames, plan });
          await attachReference(page, selectors, clip.imageUrl, config.scratchDir, clip.id, { frames });
        } catch (again) { await saveDebug(page, config.debugDir, clip.id, "image"); return fail(again.message); }
      }
      // Cost depends on the saved model/outputs, not the prompt: check it before typing anything.
      await step("CHECKING_COST");
      await chooseSingleOutput(page, selectors);
      let cost = await readCost(page, selectors);
      if (!costDecision(cost, config.costPolicy).ok && await chooseVideoSettings(page, selectors, { frames, plan })) cost = await readCost(page, selectors);
      const decision = costDecision(cost, config.costPolicy);
      if (!decision.ok) { await saveDebug(page, config.debugDir, clip.id, "cost"); return fail(decision.reason); }
      // The settings Flow shows now ("วิดีโอ · 360p · 10 วินาที"), so the log tells which model and length a clip used.
      const chipText = (await firstVisible(page, selectors.settingsChip).then(c => c?.innerText()).catch(() => "") ?? "").replace(/\s+/g, " ").trim();
      await step("TYPING_PROMPT", [cost != null ? `${cost} เครดิต` : "", chipText.slice(0, 60)].filter(Boolean).join(" · ") || undefined);
      // Settings and the Agent panel may have redrawn the composer: type into the prompt box showing now.
      prompt = await firstVisible(page, selectors.prompt) ?? prompt;
      await prompt.click();
      await prompt.fill(clip.prompt);
      const button = await generateButton(page, selectors);
      // An account with no credits left may show no Generate button at all: that is out of credits, not a broken page
      // (7 Nov, a shot bounced between two empty accounts every two minutes as GENERATE_BUTTON_NOT_FOUND).
      if (!button) {
        const noCredit = appeared("", await bodyText(page), NO_CREDIT_PATTERNS);
        await saveDebug(page, config.debugDir, clip.id, noCredit ? "no-credit-no-button" : "no-button");
        return noCredit ? { status: "NO_CREDIT" } : fail("GENERATE_BUTTON_NOT_FOUND");
      }
      if (await button.isDisabled().catch(() => false)) {
        const noCredit = appeared("", await bodyText(page), NO_CREDIT_PATTERNS);
        await saveDebug(page, config.debugDir, clip.id, noCredit ? "no-credit-before" : "button-disabled");
        return noCredit ? { status: "NO_CREDIT" } : fail("GENERATE_BUTTON_DISABLED");
      }
      if (config.dryRun) return { status: "DRY_RUN", detail: `ล็อกอินแล้ว เจอช่อง prompt และปุ่ม Generate ค่าเครดิต ${cost ?? "ไม่ทราบ"}` };

      const beforeText = await bodyText(page), beforePosters = new Set(await resultPosters(page));
      const beforeVideos = await revealVideos(page, beforePosters);
      await config.journal?.(clip.id, { state: "GENERATING", account: account.id, cost, clickedAt: new Date().toISOString() });
      await button.click({ timeout: 15_000 });
      // From here on Google may have taken the job: any error is reported as started so the clip is never sent twice.
      try { return await waitForVideo(); }
      catch (error) {
        await saveDebug(page, config.debugDir, clip.id, "error");
        return fail(`WAIT_ERROR:${error?.message ?? error}`.slice(0, 200), true);
      }
      async function waitForVideo() {
      const clickedAt = Date.now(), deadline = clickedAt + config.maxWaitMs;
      let lastReport = 0, lastReload = clickedAt, noCreditAt = 0;
      await step("WAITING_FLOW", "ส่งงานให้ Google แล้ว");
      while (Date.now() < deadline) {
        await page.waitForTimeout(config.pollMs);
        // Flow finishes the clip but the open page often never shows it (seen 1 Nov): reload the project now and then.
        if (Date.now() - clickedAt >= 75_000 && Date.now() - lastReload >= 60_000) {
          lastReload = Date.now();
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
          await page.waitForTimeout(4_000);
        }
        const text = await bodyText(page);
        if (Date.now() - lastReport >= 15_000) {
          lastReport = Date.now();
          const percent = generationPercent(beforeText, text);
          await step("WAITING_FLOW", `${Math.round((Date.now() - clickedAt) / 60_000 * 10) / 10} นาที${percent != null ? ` · Flow ${percent}%` : ""}`);
        }
        const posters = (await resultPosters(page)).filter(src => !beforePosters.has(src));
        const added = newVideoSources(beforeVideos, posters.length ? await revealVideos(page, posters) : await videoSources(page));
        if (added.length) {
          const path = join(config.readyDir, `${clip.id}.mp4`);
          await step("DOWNLOADING");
          try {
            const bytes = await saveVideo(page, added[0], path);
            const media = await inspectVideo(path);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            await config.journal?.(clip.id, { state: "DOWNLOADED", path, sha256 });
            return { status: "OK", path, sha256, bytes: bytes.length, media, cost, ...(noCreditAt ? { creditsUsedUp: true } : {}) };
          } catch (error) {
            await saveDebug(page, config.debugDir, clip.id, "download");
            return fail(`DOWNLOAD_FAILED:${error.message}`.slice(0, 200), true);
          }
        }
        // An out-of-credits banner after the click can mean this job took the last credits (seen 1 Nov): keep looking
        // for the video a while before treating it as refused.
        if (!noCreditAt && appeared(beforeText, text, NO_CREDIT_PATTERNS)) {
          noCreditAt = Date.now();
          await step("WAITING_FLOW", "เครดิตหมดหลังกดสร้าง กำลังรอดูว่างานนี้ได้วิดีโอไหม");
        }
        if (noCreditAt && Date.now() - noCreditAt > config.noCreditGraceMs) {
          await saveDebug(page, config.debugDir, clip.id, "no-credit");
          return { status: "NO_CREDIT", afterClick: true };
        }
        if (appeared(beforeText, text, FAILED_PATTERNS)) {
          await saveDebug(page, config.debugDir, clip.id, "failed");
          return fail(appeared(beforeText, text, UNUSUAL_ACTIVITY_PATTERNS) ? "FLOW_UNUSUAL_ACTIVITY" : "FLOW_REPORTED_FAILURE", true);
        }
      }
      // Keep what Flow showed, so the next fix is based on the real page rather than a guess.
      await saveDebug(page, config.debugDir, clip.id, "timeout");
      return fail("NEW_VIDEO_TIMEOUT_CHECK_FLOW", true);
      }
    },
  };
}

/** The highest new "NN%" Flow shows on the page since the click (its progress on a tile), or null. */
export function generationPercent(before, after) {
  const seen = new Set(String(before).match(/\b\d{1,3}\s?%/g) ?? []);
  const values = (String(after).match(/\b\d{1,3}\s?%/g) ?? []).filter(v => !seen.has(v)).map(v => Number.parseInt(v, 10)).filter(n => n >= 0 && n <= 100);
  return values.length ? Math.max(...values) : null;
}

/** Screenshot, page text and media list of the Flow page, for a clip that did not come back. Best effort. */
async function saveDebug(page, dir, clipId, label) {
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true });
    const base = join(dir, `${clipId}-${label}`);
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    const media = await page.evaluate(() => ({
      url: location.href,
      images: [...document.querySelectorAll("img")].map(img => ({ src: img.src.slice(0, 200), w: img.naturalWidth, h: img.naturalHeight })).slice(-60),
      videos: [...document.querySelectorAll("video")].map(v => ({ src: v.currentSrc || v.getAttribute("src"), poster: v.poster })),
      // What can be clicked, so the next fix to a changed Flow page is based on its real controls.
      buttons: [...document.querySelectorAll("button,[role=button],[role=radio],[role=tab],textarea,[contenteditable=true]")].map(el => ({
        tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 80),
        aria: el.getAttribute("aria-label"), cls: String(el.className || "").slice(0, 80), visible: el.getClientRects().length > 0,
      })).slice(0, 200),
    })).catch(() => ({}));
    await writeFile(`${base}.json`, JSON.stringify({ ...media, text: (await bodyText(page)).slice(-20_000) }, null, 2));
  } catch { /* diagnostics must never break the run */ }
}

export async function readVideoFile(path) { return readFile(path); }

// ---------------------------------------------------------------- Product pages (Shopee / Lazada)

/** Sign-in and robot-check pages the marketplaces show instead of the product. */
export function isShopLoginWall(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return /\/(buyer\/login|verify\/|login)/i.test(pathname) || /^(member|login|passport)\./i.test(hostname);
  } catch { return false; }
}
export const SHOP_LOGIN_URL = { SHOPEE: "https://shopee.co.th/buyer/login", LAZADA: "https://member.lazada.co.th/user/login" };
const SHOP_IMAGE_HOST = /(^|\.)(susercontent\.com|shopeemobile\.com|lazcdn\.com|slatic\.net|alicdn\.com)$/i;
const SHOPEE_PRODUCT_API = /\/api\/v4\/(pdp\/get_pc|pdp\/get|item\/get)\?/;

function shopeeImage(id, pageUrl) {
  if (typeof id !== "string") return null;
  if (/^https:\/\//.test(id)) return id;
  if (!/^[a-z0-9_-]{8,80}$/i.test(id)) return null;
  let host = "shopee.co.th";
  try { host = new URL(pageUrl).hostname; } catch { /* default */ }
  const cc = /\.sg$/.test(host) ? "sg" : /\.com\.my$/.test(host) ? "my" : /\.vn$/.test(host) ? "vn" : /\.ph$/.test(host) ? "ph" : /\.co\.id$/.test(host) ? "id" : "th";
  return `https://down-${cc}.img.susercontent.com/file/${id}`;
}
function imageKind(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/**
 * Opens a pasted Shopee/Lazada link in the farm's own shop profile (a normal Chrome, so the marketplace shows the page
 * as it would to the owner) and returns what the page holds: Shopee's product data, the HTML, the photos (downloaded
 * here, because the image servers may refuse ViralFlow's server too). Never buys, clicks or types anything.
 */
export async function readShopPage(job, config) {
  const context = await launchProfile(join(config.profilesDir, "_shop"), { mode: config.windowMode, channel: config.channel });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    let api = null;
    page.on("response", async response => {
      if (api || !SHOPEE_PRODUCT_API.test(response.url())) return;
      try {
        const data = (await response.json())?.data;
        const item = data?.item;
        if (item) api = { item: { title: item.title ?? item.name, description: item.description, brand: item.brand, images: item.images, item_id: item.item_id, shop_id: item.shop_id },
          product_images: data.product_images?.images ? { images: data.product_images.images } : null };
      } catch { /* not JSON */ }
    });
    await page.goto(job.link, { waitUntil: "domcontentloaded", timeout: 60_000 });
    for (let i = 0; i < 25 && !api; i++) {
      if (isShopLoginWall(page.url())) break;
      // Lazada (and Shopee pages that render without the API) carry the product in JSON-LD / Open Graph.
      const tagged = await page.evaluate(() => !!document.querySelector('script[type="application/ld+json"]') && !!document.querySelector('meta[property="og:title"]')).catch(() => false);
      if (i >= 8 && tagged) break;
      await page.waitForTimeout(1_000);
    }
    const finalUrl = page.url();
    if (isShopLoginWall(finalUrl)) return { ok: false, error: "LOGIN_REQUIRED", finalUrl };
    await page.waitForTimeout(1_500);
    const dom = await page.evaluate(() => {
      const images = [...document.images].filter(img => img.naturalWidth >= 300 && img.naturalHeight >= 300).map(img => img.currentSrc || img.src);
      const og = [...document.querySelectorAll('meta[property="og:image"],meta[property="og:image:url"]')].map(m => m.getAttribute("content") || "");
      const ld = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const value = JSON.parse(s.textContent || "");
          for (const item of [value, ...(Array.isArray(value) ? value : []), ...(Array.isArray(value?.["@graph"]) ? value["@graph"] : [])])
            if (item && /Product/i.test(String(item["@type"] ?? ""))) ld.push(...[item.image].flat().map(x => typeof x === "string" ? x : x?.url).filter(Boolean));
        } catch { /* skip */ }
      }
      const description = document.querySelector('[class*="product-detail"], [class*="detail-content"], #module_product_detail')?.innerText ?? "";
      return { title: document.title, h1: document.querySelector("h1")?.innerText ?? "", description: description.slice(0, 6000), images: [...new Set([...ld, ...og, ...images])].slice(0, 40) };
    }).catch(() => ({ title: "", h1: "", description: "", images: [] }));
    const html = (await page.content().catch(() => "")).slice(0, 850_000);
    // Listing photos in the marketplace's own order: product data first, then tagged photos, then large photos on the page.
    const candidates = [...new Set([...(api?.item?.images ?? []), ...(api?.product_images?.images ?? [])].map(id => shopeeImage(id, finalUrl)).filter(Boolean)
      .concat(dom.images.map(src => src.startsWith("//") ? `https:${src}` : src)))]
      .filter(src => { try { const u = new URL(src); return u.protocol === "https:" && SHOP_IMAGE_HOST.test(u.hostname); } catch { return false; } });
    const images = [];
    for (const url of candidates.slice(0, 10)) {
      if (images.length >= 4) break;
      try {
        const response = await context.request.get(url, { timeout: 15_000, headers: { referer: finalUrl } });
        if (!response.ok()) continue;
        const bytes = await response.body();
        if (bytes.length < 3_000 || bytes.length > 800_000 || !imageKind(bytes)) continue;
        images.push({ url, base64: bytes.toString("base64") });
      } catch { /* the next photo */ }
    }
    return { ok: true, finalUrl, html, api, dom: { title: dom.title.slice(0, 500), h1: dom.h1.slice(0, 500), description: dom.description, images: candidates.slice(0, 40) }, images };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 150) };
  } finally { await context.close().catch(() => {}); }
}

/** A visible Chrome on the shop profile's sign-in page; resolves when the owner closes it (or after 15 minutes). */
export function openShopLogin(platform, config) {
  return openPlainChrome(join(config.profilesDir, "_shop"), { channel: config.channel, flowUrl: SHOP_LOGIN_URL[platform] ?? SHOP_LOGIN_URL.SHOPEE });
}
