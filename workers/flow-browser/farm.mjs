#!/usr/bin/env node
/**
 * ViralFlow Flow farm — the semi-auto worker that runs on the owner's computer.
 *
 *   node farm.mjs --login <flowAccountId>   sign one Flow account in (visible window, once per account)
 *   node farm.mjs --probe <flowAccountId>   check sign-in, prompt box, Generate button and credit cost; never generates
 *   node farm.mjs --dry-run                 claim one clip, prepare it in Flow, stop before Generate (clip goes back)
 *   node farm.mjs --once                    make clips until the queue is empty or every account is out of credits
 *   node farm.mjs --watch                   keep doing --once whenever the library page queues new clips
 *
 * Settings come from the environment (or workers/flow-browser/farm.env): FLOW_PORTAL_URL, FLOW_WORKER_TOKEN,
 * FLOW_WINDOW (offscreen | headless | visible), FLOW_CHROME_CHANNEL (e.g. chrome), FLOW_MAX_CREDITS_PER_CLIP (10),
 * FLOW_URL (https://flow.google.com/), FLOW_WATCH_SECONDS (60).
 */
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { message, runFarmPass, runLoginPass } from "./farm-core.mjs";
import { openFlowAccount, openPlainChrome, signInFlowAccount } from "./farm-driver.mjs";
import { probeBinary } from "./media.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
await loadEnvFile(join(here, "farm.env"));
const root = resolve(process.env.FLOW_WORKSPACE || join(here, "workspace"));
const dirs = { profiles: join(root, "profiles"), ready: join(root, "ready"), journal: join(root, "farm-journal"), scratch: join(root, "tmp"), downloads: join(root, "downloads") };
const [command = "--once", argument] = process.argv.slice(2);

async function loadEnvFile(path) {
  let text;
  try {
    // Windows PowerShell may save the file as UTF-16 or with a BOM.
    const bytes = await readFile(path);
    text = (bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString("utf16le") : bytes.toString("utf8")).replace(/^\uFEFF/, "");
  } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function config() {
  const portal = new URL(process.env.FLOW_PORTAL_URL || "http://localhost:3000");
  const local = ["localhost", "127.0.0.1"].includes(portal.hostname);
  if ((portal.protocol !== "https:" && !(local && portal.protocol === "http:")) || portal.username || portal.password) throw new Error("INVALID_FLOW_PORTAL_URL");
  const token = process.env.FLOW_WORKER_TOKEN ?? "";
  if (token.length < 32) throw new Error("SET_FLOW_WORKER_TOKEN (same value as the server's FLOW_WORKER_TOKEN)");
  const windowMode = ["offscreen", "headless", "visible"].includes(process.env.FLOW_WINDOW) ? process.env.FLOW_WINDOW : "offscreen";
  return {
    portal: portal.origin, token, windowMode, channel: process.env.FLOW_CHROME_CHANNEL || (process.platform === "win32" ? "chrome" : ""),
    flowUrl: process.env.FLOW_URL || "https://flow.google.com/",
    costPolicy: { maxCredits: Number(process.env.FLOW_MAX_CREDITS_PER_CLIP || 10), requireKnownCost: process.env.FLOW_ALLOW_UNKNOWN_COST !== "1" },
    maxWaitMs: Number(process.env.FLOW_MAX_WAIT_SECONDS || 600) * 1000, pollMs: 3000,
    watchSeconds: Math.max(20, Number(process.env.FLOW_WATCH_SECONDS || 60)),
  };
}

/** Talks to ViralFlow's /api/flow-worker endpoints with the worker token. */
export function portalApi({ portal, token }, fetchImpl = fetch) {
  async function call(action, body) {
    const response = await fetchImpl(`${portal}/api/flow-worker/${action}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`PORTAL_${action.toUpperCase()}_${data.error ?? response.status}`);
    return data;
  }
  return {
    accounts: async () => (await call("accounts")).accounts,
    claim: async accountId => (await call("claim", { flowAccountId: accountId })).clip,
    fail: (clipId, reason, notStarted) => call("fail", { clipId, reason, notStarted }),
    exhausted: accountId => call("exhausted", { flowAccountId: accountId }),
    login: (accountId, state, note) => call("login", { flowAccountId: accountId, state, note }),
    finish: () => call("finish", {}),
    async upload(clip, result) {
      const slot = await call("upload-url", { clipId: clip.id });
      const bytes = await readFile(result.path);
      const put = await fetchImpl(slot.signedUrl, { method: "PUT", headers: { "content-type": "video/mp4", "x-upsert": "true" }, body: bytes });
      if (!put.ok) throw new Error(`STORAGE_UPLOAD_${put.status}`);
      await call("complete", { clipId: clip.id, sha256: result.sha256, width: result.media.width, height: result.media.height,
        durationSeconds: result.media.durationSeconds });
      // The library holds the copy now; keep the computer's disk clean.
      await rm(result.path, { force: true });
    },
  };
}

async function journal(clipId, entry) {
  await mkdir(dirs.journal, { recursive: true });
  const path = join(dirs.journal, `${clipId}.json`);
  let prior = {};
  try { prior = JSON.parse(await readFile(path, "utf8")); } catch { prior = {}; }
  await writeFile(path, JSON.stringify({ ...prior, ...entry, updatedAt: new Date().toISOString() }, null, 2));
}

async function selectors() {
  try { return JSON.parse(await readFile(process.env.FLOW_SELECTORS || join(here, "selectors.json"), "utf8")).farm ?? {}; }
  catch { return {}; }
}

async function pass(settings, dryRun) {
  const api = portalApi(settings), farmSelectors = await selectors();
  const driverConfig = { ...settings, selectors: farmSelectors, dryRun, journal, profilesDir: dirs.profiles, readyDir: dirs.ready,
    scratchDir: dirs.scratch, downloadsDir: dirs.downloads };
  // Newly linked Google accounts are signed in first, one at a time; clips only start once that is done.
  await runLoginPass({ api, signIn: account => signInFlowAccount(account, driverConfig), log: line => console.log(new Date().toLocaleTimeString("th-TH"), line) });
  const summary = await runFarmPass({ api, openAccount: account => openFlowAccount(account, driverConfig), log: line => console.log(new Date().toLocaleTimeString("th-TH"), line) });
  console.log(JSON.stringify(summary));
  return summary;
}

async function main() {
  if (process.platform === "win32" && !/^D:\\/i.test(root)) throw new Error("USE_SCRIPTS_FLOW_FARM_D_PS1");
  for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true, mode: 0o700 });
  if (command === "--login") {
    if (!/^[0-9a-f-]{36}$/i.test(argument ?? "")) throw new Error("USAGE: --login <flowAccountId from the library page>");
    const settings = { flowUrl: process.env.FLOW_URL || "https://flow.google.com/", channel: process.env.FLOW_CHROME_CHANNEL || (process.platform === "win32" ? "chrome" : "") };
    console.log("ล็อกอิน Google ของบัญชี Flow นี้ในหน้าต่าง Chrome ที่เปิดขึ้น ตั้งค่าโมเดล Veo 3.1 - Lite, 9:16, x1 แล้วปิดหน้าต่าง");
    await openPlainChrome(join(dirs.profiles, argument), settings);
    return;
  }
  const settings = config();
  if (command === "--probe") {
    const accounts = await portalApi(settings).accounts();
    const targets = argument ? accounts.filter(a => a.id === argument) : accounts;
    if (!targets.length) throw new Error("FLOW_ACCOUNT_NOT_FOUND");
    for (const account of targets) {
      const session = await openFlowAccount(account, { ...settings, selectors: await selectors(), profilesDir: dirs.profiles, readyDir: dirs.ready, scratchDir: dirs.scratch, downloadsDir: dirs.downloads });
      try { console.log(JSON.stringify(await session.probe())); } finally { await session.close(); }
    }
    return;
  }
  await probeBinary();
  const lock = join(root, "farm.lock");
  let handle;
  try { handle = await open(lock, "wx"); }
  catch {
    // A lock left by a worker that was killed (restart at logon, crash) must not block the next start.
    const pid = Number(await readFile(lock, "utf8").catch(() => ""));
    let alive = false;
    try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch { alive = false; }
    if (alive) throw new Error("FARM_ALREADY_RUNNING");
    await rm(lock, { force: true });
    handle = await open(lock, "wx");
  }
  await handle.writeFile(String(process.pid));
  const release = async () => { await handle.close().catch(() => {}); await rm(lock, { force: true }); };
  process.once("SIGINT", async () => { await release(); process.exit(130); });
  try {
    if (command === "--dry-run") return void await pass(settings, true);
    if (command === "--once") return void await pass(settings, false);
    if (command !== "--watch") throw new Error("USAGE: --login <id> | --probe [id] | --dry-run | --once | --watch");
    console.log(`เฝ้าคิวทุก ${settings.watchSeconds} วินาที (Ctrl+C เพื่อหยุด) หน้าต่าง Flow: ${settings.windowMode}`);
    for (;;) {
      try { await pass(settings, false); } catch (error) { console.error("รอบนี้ผิดพลาด:", message(error)); }
      await new Promise(done => setTimeout(done, settings.watchSeconds * 1000));
    }
  } finally { await release(); }
}

if (process.argv[1] && resolve(process.argv[1]) === join(here, "farm.mjs")) {
  main().catch(error => { console.error(message(error)); process.exitCode = 1; });
}
