import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runFarmPass } from "./farm-core.mjs";
import { openFlowAccount, signInFlowAccount } from "./farm-driver.mjs";
import { portalApi } from "./farm.mjs";

// Local fixtures only: a fake Flow page and a fake ViralFlow portal. Nothing here reaches Google or spends credits.
const require = createRequire(import.meta.url);
const run = promisify(execFile);
const testRoot = resolve(fileURLToPath(new URL("../../.runtime/tmp/", import.meta.url)));
if (process.platform === "win32" && !/^D:\\/i.test(testRoot)) throw new Error("TEST_WORKSPACE_MUST_BE_ON_D");
const TOKEN = "t".repeat(40);
let dir, server, base, video;
const portal = { clips: [], uploads: new Map(), exhausted: [], finished: 0 };

const FLOW_PAGE = `<!doctype html><meta charset="utf-8"><title>Flow</title><body>
<div id="results"></div>
<textarea placeholder="คุณต้องการสร้างอะไร"></textarea>
<button id="chip">วิดีโอ · 720p · 8 วินาที x1</button><div id="panel" hidden>Veo 3.1 - Lite<p>การสร้างจะใช้ <u>10 เครดิต</u></p></div>
<button id="go"><i>arrow_forward</i></button><div id="toast"></div>
<script>
const credits = () => Number(localStorage.getItem("credits") ?? 2);
document.getElementById("chip").onclick = () => { document.getElementById("panel").hidden = false; };
document.addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("panel").hidden = true; });
document.getElementById("go").onclick = () => {
  if (!document.querySelector("textarea").value.trim()) return;
  if (credits() < 1) { document.getElementById("toast").textContent = "เครดิตไม่พอสำหรับการสร้างนี้"; return; }
  localStorage.setItem("credits", String(credits() - 1));
  setTimeout(() => { const v = document.createElement("video"); v.src = "/clip.mp4?n=" + Math.random(); document.getElementById("results").append(v); }, 600);
};
</script></body>`;

function json(response, status, body) { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); }

before(async () => {
  await mkdir(testRoot, { recursive: true });
  dir = await mkdtemp(join(testRoot, "flow-farm-test-"));
  const path = join(dir, "clip.mp4");
  await run(require("ffmpeg-static"), ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=180x320:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path], { windowsHide: true });
  video = await readFile(path);
  portal.clips = Array.from({ length: 5 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, title: `clip ${i}`, prompt: `prompt ${i}`, status: "QUEUED" }));
  server = createServer(async (request, response) => {
    const url = new URL(request.url, base);
    if (url.pathname === "/flow") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(FLOW_PAGE); return; }
    if (url.pathname === "/clip.mp4") { response.writeHead(200, { "content-type": "video/mp4" }); response.end(video); return; }
    if (url.pathname.startsWith("/upload/")) { portal.uploads.set(url.pathname.slice(8), await body(request)); json(response, 200, {}); return; }
    if (request.headers.authorization !== `Bearer ${TOKEN}`) return json(response, 401, { error: "unauthorized" });
    const action = url.pathname.replace("/api/flow-worker/", ""), input = request.method === "POST" ? JSON.parse(String(await body(request)) || "{}") : {};
    const clip = portal.clips.find(c => c.id === input.clipId);
    if (action === "accounts") return json(response, 200, { accounts: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]
      .map((id, i) => ({ id, label: `flow-${i + 1}`, active: true, exhaustedToday: portal.exhausted.includes(id) })) });
    if (action === "claim") { const next = portal.clips.find(c => c.status === "QUEUED"); if (next) { next.status = "GENERATING"; next.account = input.flowAccountId; } return json(response, 200, { clip: next ? { ...next, imageUrl: null } : null }); }
    if (action === "upload-url") return json(response, 200, { path: clip.id, signedUrl: `${base}/upload/${clip.id}` });
    if (action === "complete") {
      const sha = createHash("sha256").update(portal.uploads.get(clip.id)).digest("hex");
      if (sha !== input.sha256) return json(response, 409, { error: "CHECKSUM_MISMATCH" });
      clip.status = "READY"; return json(response, 200, { status: "READY" });
    }
    if (action === "fail") { clip.status = input.notStarted ? "QUEUED" : "FAILED"; return json(response, 200, { ok: true }); }
    if (action === "exhausted") { portal.exhausted.push(input.flowAccountId); return json(response, 200, { ok: true }); }
    if (action === "finish") { const left = portal.clips.filter(c => c.status === "QUEUED"); left.forEach(c => { c.status = "SKIPPED_NO_CREDIT"; }); portal.finished++; return json(response, 200, { skipped: left.length }); }
    json(response, 404, { error: "not_found" });
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("drains Flow account 1, moves to account 2, stops when both are out and skips the rest", { timeout: 120_000 }, async () => {
  const config = { flowUrl: `${base}/flow`, windowMode: "headless", channel: "", costPolicy: { maxCredits: 10 }, maxWaitMs: 15_000, pollMs: 300,
    profilesDir: join(dir, "profiles"), readyDir: dir, scratchDir: dir, downloadsDir: dir, selectors: {} };
  const log = [];
  const summary = await runFarmPass({ api: portalApi({ portal: base, token: TOKEN }), openAccount: account => openFlowAccount(account, config), log: line => log.push(line) });
  assert.equal(summary.made, 4, log.join("\n"));
  assert.equal(summary.stoppedBy, "ALL_CREDITS_USED");
  assert.deepEqual(portal.clips.map(c => c.status), ["READY", "READY", "READY", "READY", "SKIPPED_NO_CREDIT"]);
  assert.deepEqual(portal.clips.slice(0, 4).map(c => c.account.slice(0, 1)), ["1", "1", "2", "2"]);
  assert.equal(portal.exhausted.length, 2);
  assert.ok([...portal.uploads.values()].every(bytes => bytes.equals(video)));
});

test("refuses to click Generate when the model costs more than the free-first ceiling", { timeout: 60_000 }, async () => {
  const config = { flowUrl: `${base}/flow`, windowMode: "headless", channel: "", costPolicy: { maxCredits: 5 }, maxWaitMs: 5_000, pollMs: 300,
    profilesDir: join(dir, "profiles-cost"), readyDir: dir, scratchDir: dir, downloadsDir: dir, selectors: {} };
  const session = await openFlowAccount({ id: "33333333-3333-4333-8333-333333333333", label: "cost" }, config);
  try {
    const result = await session.generate({ id: "c", title: "t", prompt: "p", imageUrl: null });
    assert.deepEqual(result, { status: "FAILED", reason: "COST_10_ABOVE_LIMIT_5", started: false });
  } finally { await session.close(); }
});

test("a newly linked account whose profile is already signed in becomes ready without showing a window", { timeout: 60_000 }, async () => {
  const config = { flowUrl: `${base}/flow`, windowMode: "headless", channel: "", costPolicy: { maxCredits: 10 },
    profilesDir: join(dir, "profiles-login"), selectors: {} };
  const result = await signInFlowAccount({ id: "44444444-4444-4444-8444-444444444444", label: "login" }, config);
  assert.deepEqual(result, { state: "READY", note: "10 เครดิต/คลิป" });
});
