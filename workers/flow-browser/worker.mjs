#!/usr/bin/env node
/**
 * Optional local/owner-operated Chrome worker for an authorized Google Flow session.
 * It never uses private APIs, scrapes credentials, solves CAPTCHA, or posts to TikTok.
 * UI selectors need calibration against the owner's actual page before first submission.
 */
import { readFile, readdir, mkdir, writeFile, rm, open } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { validateJob, inspectMp4, safeJobFilename, assertContained, shouldGenerate } from "./core.mjs";

const root = resolve(process.env.FLOW_WORKSPACE || join(process.cwd(), "workspace"));
const queueDir = join(root, "queue");
const readyDir = join(root, "ready");
const stateDir = join(root, "state");
const profileDir = join(root, "chrome-profile");
const selectorsPath = resolve(process.env.FLOW_SELECTORS || join(process.cwd(), "selectors.json"));
const FLOW_URL = "https://labs.google/fx/tools/flow";
const arg = process.argv[2] || "--dry-run";
const MAX_WAIT_MS = 12 * 60_000;

function message(error) { return error instanceof Error ? error.message : String(error); }
async function json(path, fallback = null) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
async function safeWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(value, null, 2));
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
}
async function setup() {
  for (const dir of [queueDir, readyDir, stateDir, profileDir]) await mkdir(dir, { recursive: true });
}
async function queued() {
  const names = (await readdir(queueDir)).filter(n => n.endsWith(".json")).sort();
  return names.map(n => join(queueDir, n));
}
async function stateOf(id) { return await json(join(stateDir, id + ".json"), { state: "NEW" }); }
async function mark(id, state, other = {}) {
  const prior = await stateOf(id);
  const next = { ...prior, ...other, state, updatedAt: new Date().toISOString() };
  await safeWrite(join(stateDir, id + ".json"), next);
  return next;
}
function mustSelector(config, name) {
  const value = config[name];
  if (typeof value !== "string" || !value.trim()) throw new Error("CALIBRATE_FLOW_SELECTOR_" + name);
  return value;
}
async function downloadIngredient(page, input, job) {
  if (!job.imageUrl || !input.imageInput) return;
  const uri = new URL(job.imageUrl);
  // Product photos should be owner-supplied private Supabase signed URLs.
  if (!uri.hostname.endsWith(".supabase.co") || !uri.pathname.includes("/storage/v1/object/")) {
    throw new Error("IMAGE_HOST_NOT_AUTHORIZED");
  }
  const response = await page.request.get(job.imageUrl, { timeout: 20_000, maxRedirects: 0 });
  if (!response.ok()) throw new Error("PRODUCT_IMAGE_LINK_EXPIRED");
  const bytes = await response.body();
  const type = response.headers()["content-type"] || "";
  if (bytes.length > 12_000_000 || !/^image\/(png|jpeg|webp)/.test(type)) throw new Error("INVALID_PRODUCT_IMAGE");
  const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
  const path = join(root, "ingredient-" + job.jobId + ext);
  await writeFile(path, bytes);
  try { await page.locator(input.imageInput).setInputFiles(path); }
  finally { await rm(path, { force: true }); }
}
async function prepareFlow(page, selectors, job) {
  await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (!page.url().startsWith(FLOW_URL)) throw new Error("FLOW_LOGIN_REQUIRED");
  if (selectors.newProject) await page.locator(selectors.newProject).click({ timeout: 10_000 });
  if (selectors.videoMode) await page.locator(selectors.videoMode).click({ timeout: 10_000 });
  if (selectors.portraitMode) await page.locator(selectors.portraitMode).click({ timeout: 10_000 });
  await downloadIngredient(page, selectors, job);
  await page.locator(mustSelector(selectors, "prompt")).fill(job.prompt, { timeout: 20_000 });
  const result = mustSelector(selectors, "resultCard");
  return { initialResults: await page.locator(result).count(), resultSelector: result };
}
async function createOnce(page, selectors, job, baseline) {
  await mark(job.jobId, "GENERATING", { generationClickedAt: new Date().toISOString() });
  await page.locator(mustSelector(selectors, "generate")).click({ timeout: 20_000 });
  // A new result is required; never download the first existing historical clip.
  await page.waitForFunction(({ css, before }) => document.querySelectorAll(css).length > before,
    { css: baseline.resultSelector, before: baseline.initialResults }, { timeout: MAX_WAIT_MS, polling: 1500 });
  const target = page.locator(baseline.resultSelector).last();
  const button = target.locator(mustSelector(selectors, "download")).first();
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), button.click({ timeout: 20_000 })]);
  const path = assertContained(readyDir, join(readyDir, safeJobFilename(job.jobId)));
  await file.saveAs(path);
  const bytes = await readFile(path);
  const info = inspectMp4(bytes);
  await mark(job.jobId, "DOWNLOADED", { path, sha256: info.sha256, bytes: info.size });
  return path;
}
async function importToViralFlow(context, job, path) {
  const page = await context.newPage();
  try {
    await page.goto(job.portalUrl + "/video-factory/providers", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const card = page.locator('article[data-flow-job-id="' + job.jobId + '"]');
    await card.waitFor({ state: "visible", timeout: 30_000 });
    if (await card.locator('a[href^="/video-factory/"]').count()) {
      await mark(job.jobId, "IMPORTED");
      return;
    }
    await card.locator('input[name="video"]').setInputFiles(path);
    await card.locator('input[name="attested"]').check();
    await card.getByRole("button", { name: /นำคลิปเข้างานเดิมและตรวจ/ }).click();
    await card.locator('a[href^="/video-factory/"]').waitFor({ state: "visible", timeout: 180_000 });
    await mark(job.jobId, "IMPORTED");
  } finally { await page.close(); }
}
async function launchBrowser() {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, {
    headless: process.env.FLOW_HEADLESS === "1",
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    locale: "en-US"
  });
}
async function processJob(context, selectors, path) {
  const job = validateJob(await json(path));
  const state = await stateOf(job.jobId);
  if (state.state === "IMPORTED") return console.log("Already imported:", job.jobId);
  if (state.state === "GENERATING" || state.state === "NEEDS_REVIEW") {
    return console.warn("Manual reconciliation needed. No duplicate Generate:", job.jobId);
  }
  let downloaded = state.state === "DOWNLOADED" ? state.path : null;
  if (!downloaded && shouldGenerate(state)) {
    const page = await context.newPage();
    try {
      const baseline = await prepareFlow(page, selectors, job);
      downloaded = await createOnce(page, selectors, job, baseline);
      console.log("Downloaded:", downloaded);
    } catch (error) {
      const prior = await stateOf(job.jobId);
      if (prior.state === "GENERATING") {
        await mark(job.jobId, "NEEDS_REVIEW", { error: message(error) });
      }
      throw error;
    } finally { await page.close(); }
  }
  if (!downloaded) throw new Error("OUTPUT_NOT_READY");
  inspectMp4(await readFile(downloaded));
  await importToViralFlow(context, job, downloaded);
  console.log("Imported into ViralFlow:", job.jobId);
}
async function main() {
  await setup();
  const files = await queued();
  if (arg === "--dry-run") {
    for (const path of files) {
      const job = validateJob(await json(path));
      const state = await stateOf(job.jobId);
      console.log(job.jobId, state.state, job.label, "portal=" + job.portalUrl);
    }
    if (!files.length) console.log("No jobs. Download a Flow Worker JSON from ViralFlow into workspace/queue.");
    return;
  }
  const lock = join(root, "worker.lock");
  let handle;
  try { handle = await open(lock, "wx"); }
  catch { throw new Error("WORKER_ALREADY_RUNNING_OR_STALE_LOCK"); }
  let browser;
  try {
    browser = await launchBrowser();
    if (arg === "--login") {
      const flow = await browser.newPage();
      await flow.goto(FLOW_URL, { waitUntil: "domcontentloaded" });
      console.log("Log into Google Flow in the opened browser. Log into ViralFlow in a second tab.");
      const input = createInterface({ input: process.stdin, output: process.stdout });
      await input.question("Press Enter when both logins are finished: ");
      input.close();
      await flow.close();
      return;
    }
    if (arg !== "--once") throw new Error("USE_LOGIN_ONCE_OR_DRY_RUN");
    const selectors = await json(selectorsPath);
    if (!selectors) throw new Error("SELECTORS_CONFIG_MISSING");
    // Require calibration before opening / submitting a Google job.
    for (const key of ["prompt", "generate", "resultCard", "download"]) mustSelector(selectors, key);
    let processed = false;
    for (const file of files) {
      const job = validateJob(await json(file));
      const state = await stateOf(job.jobId);
      if (state.state === "IMPORTED") continue;
      await processJob(browser, selectors, file);
      processed = true;
      break;
    }
    if (!processed) console.log("Nothing new to generate or import.");
  } finally {
    if (browser) await browser.close();
    await handle.close();
    await rm(lock, { force: true });
  }
}
main().catch(error => { console.error(message(error)); process.exitCode = 1; });
