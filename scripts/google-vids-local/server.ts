import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuration, Consent, DriveOneFileTest, LOCAL_ORIGIN, exchangeCode, TestBlocked } from "./drive";
import { inspectLocalImport } from "./media";

// Intentionally never load .env.local, Supabase credentials, or video-generation settings.
const localEnv = resolve(".env.google-vids-local");
if (existsSync(localEnv)) loadEnvFile(localEnv);
const config = configuration(process.env);
const consent = config ? new Consent(config) : null;
const sessionId = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
let drive: DriveOneFileTest | null = null;
let connected = false, selected = false;
let phase = "WAITING_CONFIGURATION";
let lastError: string | null = null;
let result: Awaited<ReturnType<typeof inspectLocalImport>> | null = null;
let testRun: Promise<void> | null = null;
let authAttempted = false;
if (config) phase = "WAITING_OWNER_CONSENT";
const cookies = (req: IncomingMessage) => Object.fromEntries((req.headers.cookie ?? "").split(";").flatMap(item => {
  const at = item.indexOf("="); return at >= 0 ? [[item.slice(0, at).trim(), item.slice(at + 1).trim()]] : [];
}));
function headers(res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; frame-src https://docs.google.com https://accounts.google.com; connect-src 'self' https://apis.google.com https://www.googleapis.com https://docs.google.com; img-src 'self' data: https://*.googleusercontent.com https://*.gstatic.com; object-src 'none'; base-uri 'none'; form-action 'self'");
}
function send(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  if (req.headers.origin !== LOCAL_ORIGIN || !req.headers["content-type"]?.startsWith("application/json")) throw new TestBlocked("LOCAL_ORIGIN_REQUIRED");
  let bytes = 0; const parts: Buffer[] = [];
  for await (const part of req) { const chunk = Buffer.from(part); bytes += chunk.length; if (bytes > 4096) throw new TestBlocked("REQUEST_TOO_LARGE"); parts.push(chunk); }
  let value: Record<string, unknown>;
  try { value = JSON.parse(Buffer.concat(parts).toString()); } catch { throw new TestBlocked("REQUEST_INVALID"); }
  if (!value || value.csrf !== csrf) throw new TestBlocked("LOCAL_CSRF_REQUIRED");
  return value;
}
async function runOneFile() {
  if (!drive || !selected) throw new TestBlocked("SELECT_FILE_FIRST");
  phase = "DOWNLOADING_EXISTING_PROJECT";
  const bytes = await drive.download();
  const directory = resolve(".video-cache", "google-vids-drive-test", randomUUID());
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "original.mp4");
  await writeFile(path, bytes, { flag: "wx" });
  phase = "CHECKING_LOCAL_VIDEO";
  result = await inspectLocalImport(path);
  // Explicit allowlist: no account names, file IDs, credentials, tokens, URLs or provider payloads.
  await writeFile(resolve(directory, "result.json"), JSON.stringify({ testedAt: new Date().toISOString(),
    scope: "OWNER_SELECTED_EXISTING_VIDS_LOCAL_MEDIA_BOUNDARY", source: "OFFICIAL_DRIVE_API",
    googleOAuth: "PASS", pickerSelection: "PASS", projectAccess: "PASS", mp4Download: "PASS",
    ...result, apiCalls: { ...drive.calls }, extraGenerationCalls: 0, generatedSeconds: 0,
    paidVideoCalls: 0, tiktokCalls: 0, invoiceCost: "NOT_VERIFIED", artifact: "original.mp4" }, null, 2), { flag: "wx" });
  phase = "LOCAL_IMPORT_COMPLETE_REVIEW_REQUIRED";
}
const server = createServer(async (req, res) => {
  headers(res);
  try {
    // Host + Origin checks prevent LAN exposure, DNS rebinding and cross-site local actions.
    if (req.headers.host !== "localhost:3020") throw new TestBlocked("LOCAL_HOST_REQUIRED");
    const url = new URL(req.url ?? "/", LOCAL_ORIGIN);
    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("Set-Cookie", `vf_local_test=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(fileURLToPath(new URL("./index.html", import.meta.url)))); return;
    }
    if (cookies(req).vf_local_test !== sessionId || req.headers["sec-fetch-site"] === "cross-site" && url.pathname !== "/oauth/callback") throw new TestBlocked("LOCAL_SESSION_REQUIRED");
    if (req.method === "GET" && url.pathname === "/client.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end(await readFile(fileURLToPath(new URL("./client.js", import.meta.url)))); return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      send(res, { configured: !!config, connected, selected, phase, error: lastError, csrf,
        result, counts: drive ? { ...drive.calls } : null }); return;
    }
    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      res.setHeader("Referrer-Policy", "no-referrer");
      if (!config || !consent) throw new TestBlocked("LOCAL_CONFIGURATION_REQUIRED");
      consent.consume(url.searchParams.get("state"), cookies(req).vf_consent);
      res.setHeader("Set-Cookie", "vf_consent=; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0");
      if (url.searchParams.has("error")) throw new TestBlocked("OWNER_CONSENT_NOT_GRANTED");
      const grant = await exchangeCode(config, url.searchParams.get("code") ?? "");
      drive = new DriveOneFileTest(grant.token, grant.expires); connected = true; phase = "WAITING_OWNER_PICKER";
      res.writeHead(303, { Location: "/" }); res.end(); return;
    }
    if (req.method === "POST") {
      const input = await body(req);
      if (url.pathname === "/api/connect") {
        if (!consent || !config) throw new TestBlocked("LOCAL_CONFIGURATION_REQUIRED");
        if (authAttempted) throw new TestBlocked("ONE_CONSENT_ATTEMPT_RESTART_LOCAL_TEST");
        authAttempted = true;
        const pending = consent.begin();
        res.setHeader("Set-Cookie", `vf_consent=${pending.state}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=300`);
        send(res, { authorizeUrl: pending.url }); return;
      }
      if (url.pathname === "/api/picker") {
        if (!drive || !config || selected) throw new TestBlocked("PICKER_NOT_READY");
        // Official Picker requires the narrowly scoped token in browser memory; never storage/log it.
        send(res, { token: drive.pickerToken(), key: config.pickerKey, appId: config.projectNumber }); return;
      }
      if (url.pathname === "/api/select") {
        if (!drive || selected) throw new TestBlocked("ONE_FILE_ONLY");
        await drive.select(input.fileId, input.resourceKey); selected = true; phase = "READY_TO_DOWNLOAD";
        send(res, { projectAccess: "PASS", canDownload: true }); return;
      }
      if (url.pathname === "/api/download") {
        if (!testRun) testRun = runOneFile().catch(error => { phase = "BLOCKED"; lastError = error instanceof TestBlocked ? error.reason : "LOCAL_TEST_FAILED"; });
        // Start/poll status without holding the browser request open. No generation/queue is created.
        send(res, { phase }); return;
      }
      if (url.pathname === "/api/disconnect") {
        drive?.clear(); consent?.clear(); connected = false; selected = false; phase = "STOPPED";
        send(res, { stopped: true }); return;
      }
    }
    send(res, { error: "NOT_FOUND" }, 404);
  } catch (error) {
    // Never print raw OAuth/Drive/FFmpeg errors or request/callback URLs.
    const safeError = error instanceof TestBlocked ? error.reason : "LOCAL_TEST_FAILED";
    if (req.url?.startsWith("/oauth/callback")) { lastError = safeError; phase = "BLOCKED"; res.writeHead(303, { Location: "/" }); res.end(); }
    else send(res, { error: safeError }, 400);
  }
});
server.on("error", () => { console.error("Local Google Vids test could not start (configuration or port unavailable)."); process.exitCode = 1; });
server.listen(3020, "127.0.0.1", () => console.log(`Local test prepared: ${LOCAL_ORIGIN} — ${config ? "waiting for owner consent" : "Google Cloud configuration required"}`));
function stop() { drive?.clear(); consent?.clear(); server.close(); server.closeAllConnections(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
