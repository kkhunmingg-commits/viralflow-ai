#!/usr/bin/env node
/**
 * Optional local/owner-operated Chrome worker for an authorized Google Flow session.
 * It never uses private APIs, scrapes credentials, solves CAPTCHA, or posts to TikTok.
 * UI selectors need calibration against the owner's actual page before first submission.
 */
import { readFile, readdir, mkdir, writeFile, rm, open, chmod, copyFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { validateJob, inspectMp4, safeJobFilename, assertContained, shouldGenerate, validateResultIds, newResultId } from "./core.mjs";
import { inspectVideo, probeBinary } from './media.mjs';
import { importTarget } from './portal.mjs';

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
  for (const dir of [queueDir, readyDir, stateDir, profileDir]) await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(profileDir, 0o700);
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
async function ownerApproval(job, action) {
  if (!process.stdin.isTTY) throw new Error('OWNER_INTERACTIVE_APPROVAL_REQUIRED');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(action === 'generate'
      ? `Review Flow model, credits, portrait settings, product rights and prompt for ${job.label}.`
      : `Review downloaded MP4 and confirm it was generated with your authorized Google account: ${job.label}.`);
    const answer = await input.question(`Type ${action} ${job.jobId} to approve: `);
    if (answer.trim() !== `${action} ${job.jobId}`) throw new Error('OWNER_APPROVAL_DECLINED');
  } finally { input.close(); }
}
function identityAttribute(selectors) {
  const attribute = mustSelector(selectors, 'resultIdAttribute');
  if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(attribute)) throw new Error('INVALID_RESULT_ID_ATTRIBUTE');
  return attribute;
}
async function resultIds(page, selectors) {
  const ids = await page.locator(mustSelector(selectors, 'resultCard')).evaluateAll(
    (cards, attribute) => cards.map(card => card.getAttribute(attribute)), identityAttribute(selectors));
  return validateResultIds(ids);
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
  return { initialResultIds: await resultIds(page, selectors), resultSelector: result };
}
async function createOnce(page, selectors, job, baseline) {
  await ownerApproval(job, 'generate');
  // Refresh after the owner has reviewed the page; ignore results from that interval.
  baseline.initialResultIds = await resultIds(page, selectors);
  await mark(job.jobId, "GENERATING", { generationClickedAt: new Date().toISOString() });
  await page.locator(mustSelector(selectors, "generate")).click({ timeout: 20_000 });
  // A new result is required; never download the first existing historical clip.
  const deadline = Date.now() + MAX_WAIT_MS;
  let resultId;
  while (Date.now() < deadline) {
    resultId = newResultId(baseline.initialResultIds, await resultIds(page, selectors));
    if (resultId) break;
    await page.waitForTimeout(1500);
  }
  if (!resultId) throw new Error('NEW_RESULT_TIMEOUT_REVIEW_REQUIRED');
  await mark(job.jobId, 'GENERATING', { resultId });
  const attribute = identityAttribute(selectors);
  const escapedId = await page.evaluate(id => CSS.escape(id), resultId);
  const target = page.locator(baseline.resultSelector).and(page.locator(`[${attribute}="${escapedId}"]`));
  const button = target.locator(mustSelector(selectors, "download")).first();
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), button.click({ timeout: 20_000 })]);
  const path = assertContained(readyDir, join(readyDir, safeJobFilename(job.jobId)));
  await file.saveAs(path);
  const bytes = await readFile(path);
  const info = inspectMp4(bytes);
  const media = await inspectVideo(path);
  await mark(job.jobId, "DOWNLOADED", { path, sha256: info.sha256, bytes: info.size, media });
  return path;
}
async function preflightImport(context, job) {
  const page = await context.newPage();
  try {
    const target = await importTarget(page, job);
    if (target.masterUrl) {
      await mark(job.jobId, 'IMPORTED', { masterUrl: target.masterUrl });
      return false;
    }
    return true;
  } finally { await page.close(); }
}
async function importToViralFlow(context, job, path) {
  const page = await context.newPage();
  try {
    const { card, masterUrl } = await importTarget(page, job);
    if (masterUrl) {
      await mark(job.jobId, "IMPORTED", { masterUrl });
      return;
    }
    // The existing form is an owner attestation; automation cannot attest on their behalf.
    await ownerApproval(job, 'import');
    await card.locator('input[name="video"]').setInputFiles(path);
    await card.locator('input[name="attested"]').check();
    await card.getByRole("button", { name: /นำคลิปเข้างานเดิมและตรวจ/ }).click();
    await card.locator('a[href^="/video-factory/"]').waitFor({ state: "visible", timeout: 180_000 });
    const href = await card.locator('a[href^="/video-factory/"]').first().getAttribute('href');
    await mark(job.jobId, "IMPORTED", { masterUrl: new URL(href, job.portalUrl).href });
  } finally { await page.close(); }
}
async function launchBrowser() {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, {
    headless: process.env.FLOW_HEADLESS === "1",
    acceptDownloads: true,
    downloadsPath: join(root, 'downloads'),
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
  let downloaded = state.state === "DOWNLOADED" ? assertContained(readyDir, state.path || "") : null;
  if (!downloaded && shouldGenerate(state)) {
    // Confirm the authenticated original job can accept the output before spending credits.
    if (!await preflightImport(context, job)) return;
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
  const info = inspectMp4(await readFile(downloaded));
  const downloadedState = await stateOf(job.jobId);
  if (downloadedState.sha256 && downloadedState.sha256 !== info.sha256) throw new Error('OUTPUT_HASH_CHANGED_REVIEW_REQUIRED');
  await inspectVideo(downloaded);
  await importToViralFlow(context, job, downloaded);
  console.log("Imported into ViralFlow:", job.jobId);
}
async function recoverMp4(files) {
    const jobId = process.argv[3];
    safeJobFilename(jobId);
    const jobs = await Promise.all(files.map(async file => validateJob(await json(file))));
    const job = jobs.find(candidate => candidate.jobId === jobId.toLowerCase());
    if (!job) throw new Error('QUEUED_JOB_REQUIRED');
    if (!process.argv[4]) throw new Error('RECOVER_MP4_PATH_REQUIRED');
    const source = resolve(process.argv[4]);
    if (process.platform === 'win32' && !/^D:\\/i.test(source)) throw new Error('RECOVER_FILE_MUST_BE_ON_DRIVE_D');
    const prior = await stateOf(job.jobId);
    if (prior.state === 'IMPORTED') throw new Error('ALREADY_IMPORTED');
    const info = inspectMp4(await readFile(source));
    const media = await inspectVideo(source);
    await ownerApproval(job, 'recover');
    const path = assertContained(readyDir, join(readyDir, safeJobFilename(job.jobId)));
    // Do not overwrite an earlier recovered/downloaded artifact without reconciliation.
    if (source !== path) await copyFile(source, path, 1);
    await mark(job.jobId, 'DOWNLOADED', { path, sha256: info.sha256, bytes: info.size, media, recoveredManually: true });
    console.log('Recovered for import only:', job.jobId);
}
async function main() {
  if (process.platform === 'win32') {
    for (const path of [root, selectorsPath, process.env.TEMP, process.env.TMP, process.env.TMPDIR, process.env.PLAYWRIGHT_BROWSERS_PATH]) {
      if (typeof path !== 'string' || !/^D:\\/i.test(resolve(path))) throw new Error('USE_SCRIPTS_DEV_D_PS1');
    }
  }
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
  if (!files.length && ['--once', '--import-only', '--preflight'].includes(arg)) {
    console.log('No queued jobs. Export a real Creative Brain job before continuing.');
    return;
  }
  const lock = join(root, "worker.lock");
  let handle;
  try { handle = await open(lock, "wx"); }
  catch { throw new Error("WORKER_ALREADY_RUNNING_OR_STALE_LOCK"); }
  let browser;
  try {
    if (arg === '--recover-mp4') return await recoverMp4(files);
    if (arg === '--once' || arg === '--import-only') await probeBinary();
    browser = await launchBrowser();
    if (arg === "--login") {
      const flow = await browser.newPage();
      await flow.goto(FLOW_URL, { waitUntil: "domcontentloaded" });
      if (files.length || process.env.FLOW_PORTAL_URL) {
        const first = files.length ? validateJob(await json(files[0])) : validateJob({
          jobId: '00000000-0000-4000-8000-000000000000', prompt: 'Login only', portalUrl: process.env.FLOW_PORTAL_URL
        });
        const portal = await browser.newPage();
        await portal.goto(first.portalUrl + "/video-factory/providers", { waitUntil: "domcontentloaded" });
      }
      console.log("Sign into Google Flow and ViralFlow in the opened browser windows (do not share this profile).");
      const input = createInterface({ input: process.stdin, output: process.stdout });
      await input.question("Press Enter when both logins are finished: ");
      input.close();
      await flow.close();
      return;
    }
    if (arg === "--inspect") {
      const page = await browser.newPage();
      await page.goto(FLOW_URL, { waitUntil: "domcontentloaded" });
      await page.pause();
      return;
    }
    if (arg === '--preflight') {
      for (const file of files) {
        const job = validateJob(await json(file));
        const ready = await preflightImport(browser, job);
        console.log(job.jobId, ready ? 'IMPORT_READY_NO_GENERATION' : 'ALREADY_IMPORTED_NO_GENERATION');
      }
      return;
    }
    if (!['--once', '--import-only'].includes(arg)) throw new Error("USE_LOGIN_ONCE_INSPECT_DRY_RUN_OR_IMPORT_ONLY");
    const selectors = arg === '--import-only' ? {} : await json(selectorsPath);
    if (!selectors) throw new Error("SELECTORS_CONFIG_MISSING");
    // Require calibration before opening / submitting a Google job.
    if (arg === '--once') {
      for (const key of ["prompt", "generate", "resultCard", "download", "resultIdAttribute"]) mustSelector(selectors, key);
      identityAttribute(selectors);
    }
    let processed = false;
    for (const file of files) {
      const job = validateJob(await json(file));
      const state = await stateOf(job.jobId);
      if (state.state === "IMPORTED") continue;
      if (arg === '--import-only' && state.state !== 'DOWNLOADED') continue;
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
