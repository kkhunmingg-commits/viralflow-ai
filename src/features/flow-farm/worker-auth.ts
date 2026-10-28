import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { readStateFile, removeStateFile, saveStateFile } from "./service";

/** The owner's own worker may still sign in with the server-wide secret; both must be set. */
export function flowWorkerConfig() {
  // Trimmed: values piped into `vercel env add` from Windows can carry a BOM or CRLF.
  const clean = (value: string | undefined) => (value ?? "").replace(/^﻿/, "").trim();
  const token = clean(process.env.FLOW_WORKER_TOKEN), owner = clean(process.env.FLOW_WORKER_OWNER_ID);
  return { enabled: token.length >= 32 && /^[0-9a-f-]{36}$/i.test(owner), token, owner };
}

// Every web account gets its own computer token from the installer download. Only its SHA-256 is stored, in the
// private state bucket: tokens/<hash>.json says whose it is, owner/<id>/worker-token.json which hash is current.
const PERSONAL = /^vfw_[A-Za-z0-9_-]{43}$/;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenPath = (hash: string) => `tokens/${hash}.json`;
const ownerPath = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/worker-token.json`;
};

/** A new token for this account's computer; the previous one stops working, so only the latest install runs. */
export async function issueWorkerToken(admin: SupabaseClient, owner: string, now = new Date()) {
  const token = `vfw_${randomBytes(32).toString("base64url")}`, hash = hashOf(token);
  const previous = await readStateFile<{ hash: string }>(admin, ownerPath(owner));
  await saveStateFile(admin, tokenPath(hash), { owner, issuedAt: now.toISOString() }, "worker_token_not_saved");
  await saveStateFile(admin, ownerPath(owner), { hash, issuedAt: now.toISOString() }, "worker_token_not_saved");
  if (previous?.hash && previous.hash !== hash) await removeStateFile(admin, tokenPath(previous.hash)).catch(() => {});
  return token;
}

export async function authorizeFlowWorker(request: Request, admin: () => SupabaseClient = createAdminClient) {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented) return { ok: false as const, status: 401 };
  if (PERSONAL.test(presented)) {
    const hash = hashOf(presented), client = admin();
    const entry = await readStateFile<{ owner: string }>(client, tokenPath(hash));
    if (!entry?.owner || !/^[0-9a-f-]{36}$/i.test(entry.owner)) return { ok: false as const, status: 401 };
    // Revoked by a newer download even if the index file was left behind.
    const current = await readStateFile<{ hash: string }>(client, ownerPath(entry.owner));
    if (current?.hash !== hash) return { ok: false as const, status: 401 };
    return { ok: true as const, owner: entry.owner };
  }
  const config = flowWorkerConfig();
  if (!config.enabled) return { ok: false as const, status: 401 };
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(presented), digest(config.token))) return { ok: false as const, status: 401 };
  return { ok: true as const, owner: config.owner };
}
