import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductRadar } from "@/features/products/services";
import { bangkokDate, bangkokDayRange, COUNTED_STATUSES, FLOW_CLIP_MAX_BYTES, LIBRARY_STATUSES, MAX_CLIPS_PER_BATCH, MAX_FLOW_ACCOUNTS_PER_TIKTOK,
  type FlowAccountRow, type FlowClipStatus, type FlowLoginState } from "./contracts";
import { clipsToAdd, flowAccountViews } from "./capacity";
import { planBatch, type FarmProduct } from "./planner";

const BUCKET = "video-assets";
const ACCOUNT_COLUMNS = "id,tiktok_account_id,label,priority,clips_per_day_estimate,active,exhausted_on,clips_today,clips_today_on,last_used_at,created_at";
export const LIBRARY_COLUMNS = "id,tiktok_account_id,product_id,kind,title,caption,hashtags,status,error,ready_at,scheduled_at,posted_at,post_url,duration_seconds,width,height,created_at,flow_account_id";

function check<T>(result: { data: T; error: { message: string } | null }, code: string): T {
  if (result.error) throw new Error(code);
  return result.data;
}
/** Like check, but a table this database does not have yet (rights/evidence ship in a later migration) reads as empty. */
function optional<T>(result: { data: T[] | null; error: { message: string; code?: string } | null }, code: string): T[] {
  if (result.error && (result.error.code === "PGRST205" || result.error.code === "42P01")) return [];
  return check(result, code) ?? [];
}
export function clipStoragePath(owner: string, clipId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(owner) || !/^[0-9a-f-]{36}$/i.test(clipId)) throw new Error("INVALID_CLIP_PATH");
  return `owner/${owner}/flow-clips/${clipId}.mp4`;
}

// ---------------------------------------------------------------- Flow accounts (owner settings)

export async function listFlowAccounts(client: SupabaseClient, owner: string, now = new Date(), logins: FlowLogins = {}) {
  const rows = check(await client.from("flow_accounts").select(ACCOUNT_COLUMNS).eq("owner_id", owner), "flow_accounts_unavailable") as FlowAccountRow[];
  // An account the computer has not reported on yet still has to be signed in.
  return flowAccountViews(rows.map(row => ({ ...row, login_state: logins[row.id]?.state ?? "PENDING", login_note: logins[row.id]?.note ?? null })), bangkokDate(now));
}

// Sign-in state lives in one small private file per owner in a service-only bucket the app creates itself,
// so linking accounts needs no schema change.
const STATE_BUCKET = "flow-farm-state";
export type FlowLogins = Record<string, { state: FlowLoginState; note: string | null; checkedAt: string }>;
const loginsPath = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/flow-logins.json`;
};
export async function readStateFile<T>(admin: SupabaseClient, path: string): Promise<T | null> {
  const file = await admin.storage.from(STATE_BUCKET).download(path);
  if (file.error || !file.data) return null;
  try { return JSON.parse(await file.data.text()) as T; } catch { return null; }
}
/** Writes one small JSON file to the private state bucket, creating the bucket the first time. */
export async function saveStateFile(admin: SupabaseClient, path: string, value: unknown, failure: string) {
  const body = JSON.stringify(value), options = { contentType: "application/json", upsert: true };
  let saved = await admin.storage.from(STATE_BUCKET).upload(path, body, options);
  if (saved.error && /not.?found/i.test(saved.error.message)) {
    await admin.storage.createBucket(STATE_BUCKET, { public: false, fileSizeLimit: 65_536, allowedMimeTypes: ["application/json"] });
    saved = await admin.storage.from(STATE_BUCKET).upload(path, body, options);
  }
  if (saved.error) throw new Error(failure);
}
export async function removeStateFile(admin: SupabaseClient, path: string) {
  await admin.storage.from(STATE_BUCKET).remove([path]);
}
export async function flowLogins(admin: SupabaseClient, owner: string): Promise<FlowLogins> {
  return await readStateFile<FlowLogins>(admin, loginsPath(owner)) ?? {};
}
async function saveLogin(admin: SupabaseClient, owner: string, id: string, entry: FlowLogins[string] | null) {
  const logins = await flowLogins(admin, owner);
  if (entry) logins[id] = entry; else delete logins[id];
  await saveStateFile(admin, loginsPath(owner), logins, "flow_login_not_saved");
}
export async function addFlowAccount(admin: SupabaseClient, owner: string, input: { tiktokAccountId: string; label: string; clipsPerDay: number }) {
  const rows = check(await admin.from("flow_accounts").select("priority").eq("owner_id", owner).eq("tiktok_account_id", input.tiktokAccountId), "flow_accounts_unavailable") as Array<{ priority: number }>;
  if (rows.length >= MAX_FLOW_ACCOUNTS_PER_TIKTOK) throw new Error("FLOW_ACCOUNT_LIMIT_5");
  const priority = Math.min(100, rows.reduce((max, row) => Math.max(max, row.priority), 0) + 1);
  const result = await admin.from("flow_accounts").insert({ owner_id: owner, tiktok_account_id: input.tiktokAccountId, label: input.label,
    clips_per_day_estimate: input.clipsPerDay, priority });
  if (result.error?.code === "23505") {
    // A label is unique per owner: the same Google account linked under another TikTok account moves here, keeping
    // its signed-in browser profile (keyed by id), instead of failing while this TikTok account shows none.
    const existing = check(await admin.from("flow_accounts").select("id,tiktok_account_id").eq("owner_id", owner).eq("label", input.label).maybeSingle(),
      "flow_accounts_unavailable") as { id: string; tiktok_account_id: string | null } | null;
    if (!existing || existing.tiktok_account_id === input.tiktokAccountId) throw new Error("FLOW_ACCOUNT_LABEL_TAKEN");
    const moved = await admin.from("flow_accounts").update({ tiktok_account_id: input.tiktokAccountId, priority, active: true,
      clips_per_day_estimate: input.clipsPerDay, updated_at: new Date().toISOString() }).eq("owner_id", owner).eq("id", existing.id);
    if (moved.error?.message.includes("FLOW_ACCOUNT_LIMIT_5")) throw new Error("FLOW_ACCOUNT_LIMIT_5");
    check(moved, "flow_account_not_saved");
    return { moved: true };
  }
  if (result.error?.message.includes("FLOW_ACCOUNT_LIMIT_5")) throw new Error("FLOW_ACCOUNT_LIMIT_5");
  check(result, "flow_account_not_saved");
  return { moved: false };
}
/** Moves a Google account one place earlier or later in its TikTok account's drain order. */
export async function moveFlowAccount(admin: SupabaseClient, owner: string, id: string, direction: "UP" | "DOWN") {
  const all = await listFlowAccounts(admin, owner, new Date(), await flowLogins(admin, owner));
  const group = all.find(view => view.id === id)?.tiktokAccountId ?? null;
  const views = all.filter(view => view.tiktokAccountId === group);
  const index = views.findIndex(view => view.id === id), swap = direction === "UP" ? index - 1 : index + 1;
  if (index < 0 || swap < 0 || swap >= views.length) return;
  const order = views.map(view => view.id);
  [order[index], order[swap]] = [order[swap], order[index]];
  for (const [position, accountId] of order.entries()) {
    check(await admin.from("flow_accounts").update({ priority: position + 1, updated_at: new Date().toISOString() })
      .eq("owner_id", owner).eq("id", accountId), "flow_account_not_saved");
  }
}
export async function updateFlowAccount(admin: SupabaseClient, owner: string, id: string, patch: { active?: boolean; clipsPerDay?: number; resetCredits?: boolean }) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.clipsPerDay !== undefined) update.clips_per_day_estimate = patch.clipsPerDay;
  // The owner topped up or switched plans: let the worker try this account again today.
  if (patch.resetCredits) update.exhausted_on = null;
  check(await admin.from("flow_accounts").update(update).eq("owner_id", owner).eq("id", id), "flow_account_not_saved");
}
/** Signed out or switched Google account: the owner's computer opens the sign-in window for it again. */
export async function requestFlowLogin(admin: SupabaseClient, owner: string, id: string) {
  await saveLogin(admin, owner, id, null);
}
export async function removeFlowAccount(admin: SupabaseClient, owner: string, id: string) {
  check(await admin.from("flow_accounts").delete().eq("owner_id", owner).eq("id", id), "flow_account_not_removed");
  await saveLogin(admin, owner, id, null).catch(() => {});
}

// ---------------------------------------------------------------- One click: find products and queue clips

/** Best-scoring available products that have a reviewed, commercially cleared photograph Flow can use. */
export async function findBatchProducts(admin: SupabaseClient, owner: string, limit = 5, now = new Date()): Promise<FarmProduct[]> {
  const radar = await getProductRadar(admin, owner, { sort: "opportunity" }, now);
  const candidates = radar.items.filter(item => item.product.status === "available").slice(0, 40);
  if (!candidates.length) return [];
  const ids = candidates.map(item => item.product.id);
  const assets = check(await admin.from("media_assets").select("id,product_id,storage_path,mime_type,created_at")
    .eq("owner_id", owner).in("product_id", ids).in("asset_type", ["PRODUCT_IMAGE", "IMAGE"]).like("mime_type", "image/%"), "product_media_unavailable") as
    Array<{ id: string; product_id: string; storage_path: string; created_at: string }>;
  if (!assets.length) return [];
  const rights = optional(await admin.from("media_asset_rights").select("media_asset_id,platform_scope,expires_at")
    .eq("owner_id", owner).in("media_asset_id", assets.map(asset => asset.id)).eq("review_state", "APPROVED").is("revoked_at", null)
    .eq("allows_commercial", true).eq("allows_promotion", true), "media_rights_unavailable") as
    Array<{ media_asset_id: string; platform_scope: string[]; expires_at: string | null }>;
  const cleared = new Set(rights.filter(r => r.platform_scope.includes("TIKTOK") && (!r.expires_at || Date.parse(r.expires_at) > now.getTime()))
    .map(r => r.media_asset_id));
  const facts = optional(await admin.from("content_evidence").select("id,product_id,statement,role")
    .eq("owner_id", owner).in("product_id", ids).is("revoked_at", null), "product_facts_unavailable") as
    Array<{ id: string; product_id: string; statement: string; role: "PROBLEM" | "SELLING_POINT" | "OBSERVATION" | null }>;
  const products: FarmProduct[] = [];
  for (const { product } of candidates) {
    const asset = assets.filter(a => a.product_id === product.id && cleared.has(a.id)).toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!asset) continue;
    products.push({ id: product.id, title: product.title, categoryKey: product.category_key, imagePath: asset.storage_path, imageAssetId: asset.id,
      facts: facts.filter(f => f.product_id === product.id).map(f => ({ id: f.id, text: f.statement, role: f.role ?? undefined })) });
    if (products.length >= limit) break;
  }
  return products;
}

/** `selling` is the account's own mode; `mode` is what was queued (a selling account with no usable product gets warm-up clips). */
export interface BatchResult { accountId: string; added: number; mode: "GROWTH" | "AFFILIATE"; selling: boolean; products: number }

/** The one-click start: for each chosen TikTok account, tops today's clips up to `count` with new plans. */
export async function startBatch(admin: SupabaseClient, owner: string, accountId: string | "ALL", count: number, now = new Date()): Promise<BatchResult[]> {
  let query = admin.from("tiktok_accounts").select("id,effective_mode").eq("owner_id", owner).is("hidden_at", null);
  if (accountId !== "ALL") query = query.eq("id", accountId);
  const accounts = check(await query, "accounts_unavailable") as Array<{ id: string; effective_mode: string | null }>;
  if (!accounts.length) throw new Error("account_not_found");
  const today = bangkokDate(now), { start, end } = bangkokDayRange(today);
  let products: FarmProduct[] | null = null;
  const results: BatchResult[] = [];
  for (const [position, account] of accounts.entries()) {
    const existing = await admin.from("flow_clips").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", account.id).in("status", COUNTED_STATUSES).gte("created_at", start).lt("created_at", end);
    if (existing.error) throw new Error("flow_clips_unavailable");
    const add = clipsToAdd(count, existing.count ?? 0, MAX_CLIPS_PER_BATCH);
    const mode = account.effective_mode === "AFFILIATE" ? "AFFILIATE" : "GROWTH";
    if (mode === "AFFILIATE" && products === null) products = await findBatchProducts(admin, owner);
    const planned = add ? planBatch({ mode, count: add, products: products ?? [], offset: (existing.count ?? 0) + Number(today.slice(-2)) + position * 3 }) : [];
    if (planned.length) {
      const batchId = crypto.randomUUID();
      check(await admin.from("flow_clips").insert(planned.map(clip => ({
        owner_id: owner, tiktok_account_id: account.id, batch_id: batchId, product_id: clip.productId, kind: clip.kind, title: clip.title,
        prompt: clip.prompt, caption: clip.caption, hashtags: clip.hashtags, reference_image_path: clip.referenceImagePath,
      }))), "flow_clips_not_queued");
    }
    results.push({ accountId: account.id, added: planned.length, mode: planned[0]?.kind ?? mode, selling: mode === "AFFILIATE", products: mode === "AFFILIATE" ? products?.length ?? 0 : 0 });
  }
  return results;
}

// ---------------------------------------------------------------- Local worker (service role, token-authenticated)

/** The worker's poll doubles as its heartbeat, so the page can tell whether the computer is running it. */
export async function workerAccounts(admin: SupabaseClient, owner: string, now = new Date()) {
  await admin.from("flow_worker_status").upsert({ owner_id: owner, last_seen_at: now.toISOString() });
  // Each TikTok account's own Google accounts first; shared accounts only pick up what is left.
  const views = (await listFlowAccounts(admin, owner, now, await flowLogins(admin, owner))).filter(view => view.active);
  return [...views.filter(view => view.tiktokAccountId), ...views.filter(view => !view.tiktokAccountId)];
}
export async function workerLastSeen(client: SupabaseClient, owner: string) {
  const row = await client.from("flow_worker_status").select("last_seen_at").eq("owner_id", owner).maybeSingle();
  return (row.data as { last_seen_at: string } | null)?.last_seen_at ?? null;
}

/** Clips whose worker vanished mid-generation are not retried automatically: Flow may already have spent credits. */
export async function expireStaleGenerating(admin: SupabaseClient, owner: string, now = new Date()) {
  check(await admin.from("flow_clips").update({ status: "FAILED", error: "WORKER_LOST_CHECK_FLOW_LIBRARY", lease_until: null, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("status", "GENERATING").lt("lease_until", now.toISOString()), "flow_clips_unavailable");
}

/** What the computer found when it opened (or showed) the account's sign-in window. */
export async function setLoginState(admin: SupabaseClient, owner: string, input: { flowAccountId: string; state: "READY" | "FAILED"; note?: string }) {
  const exists = check(await admin.from("flow_accounts").select("id").eq("owner_id", owner).eq("id", input.flowAccountId).maybeSingle(), "flow_accounts_unavailable");
  if (!exists) throw new Error("FLOW_ACCOUNT_UNAVAILABLE");
  await saveLogin(admin, owner, input.flowAccountId, { state: input.state, note: input.note || null, checkedAt: new Date().toISOString() });
}

export async function claimClip(admin: SupabaseClient, owner: string, flowAccountId: string) {
  await expireStaleGenerating(admin, owner);
  if ((await flowLogins(admin, owner))[flowAccountId]?.state !== "READY") throw new Error("FLOW_ACCOUNT_UNAVAILABLE");
  const result = await admin.rpc("claim_flow_clip", { p_owner: owner, p_flow_account: flowAccountId, p_lease_seconds: 1200 });
  if (result.error) throw new Error(result.error.message.includes("FLOW_ACCOUNT_UNAVAILABLE") ? "FLOW_ACCOUNT_UNAVAILABLE" : "claim_failed");
  const clip = (result.data as Array<{ id: string; title: string; prompt: string; reference_image_path: string | null; kind: string }> | null)?.[0];
  if (!clip) return null;
  let imageUrl: string | null = null;
  if (clip.reference_image_path) {
    const signed = await admin.storage.from(BUCKET).createSignedUrl(clip.reference_image_path, 900);
    if (signed.error || !signed.data) {
      await failClip(admin, owner, { clipId: clip.id, reason: "PRODUCT_IMAGE_UNAVAILABLE", notStarted: false });
      throw new Error("PRODUCT_IMAGE_UNAVAILABLE");
    }
    imageUrl = signed.data.signedUrl;
  }
  return { id: clip.id, title: clip.title, prompt: clip.prompt, kind: clip.kind, imageUrl };
}

async function generatingClip(admin: SupabaseClient, owner: string, clipId: string) {
  const clip = check(await admin.from("flow_clips").select("id,status,flow_account_id").eq("owner_id", owner).eq("id", clipId).maybeSingle(), "flow_clips_unavailable") as
    { id: string; status: FlowClipStatus; flow_account_id: string | null } | null;
  if (!clip || clip.status !== "GENERATING") throw new Error("CLIP_NOT_GENERATING");
  return clip;
}

/** A signed one-time upload slot so the MP4 goes straight to private Storage, not through the web server. */
export async function clipUploadUrl(admin: SupabaseClient, owner: string, clipId: string) {
  await generatingClip(admin, owner, clipId);
  const path = clipStoragePath(owner, clipId);
  const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) throw new Error("UPLOAD_URL_UNAVAILABLE");
  return { path, signedUrl: signed.data.signedUrl };
}

/** Re-checks the uploaded file on the server (size, MP4 signature, checksum) before it enters the library. */
export async function completeClip(admin: SupabaseClient, owner: string, input: { clipId: string; sha256: string; width: number; height: number; durationSeconds: number }, now = new Date()) {
  const clip = await generatingClip(admin, owner, input.clipId);
  const path = clipStoragePath(owner, input.clipId);
  const file = await admin.storage.from(BUCKET).download(path);
  if (file.error || !file.data) throw new Error("UPLOADED_VIDEO_MISSING");
  const bytes = Buffer.from(await file.data.arrayBuffer());
  const reject = async (reason: string) => {
    await admin.storage.from(BUCKET).remove([path]);
    await failClip(admin, owner, { clipId: input.clipId, reason, notStarted: false });
    throw new Error(reason);
  };
  if (bytes.length < 32 || bytes.length > FLOW_CLIP_MAX_BYTES || bytes.toString("ascii", 4, 8) !== "ftyp") return reject("INVALID_MP4");
  if (createHash("sha256").update(bytes).digest("hex") !== input.sha256) return reject("CHECKSUM_MISMATCH");
  if (Math.abs(input.width / input.height - 9 / 16) > .02) return reject("NOT_PORTRAIT_9_16");
  const update = await admin.from("flow_clips").update({ status: "READY", storage_path: path, video_sha256: input.sha256, video_bytes: bytes.length,
    width: input.width, height: input.height, duration_seconds: input.durationSeconds, ready_at: now.toISOString(), lease_until: null, error: null,
    updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", input.clipId).eq("status", "GENERATING");
  if (update.error?.code === "23505") return reject("DUPLICATE_VIDEO");
  check(update, "flow_clip_not_saved");
  if (clip.flow_account_id) await countFlowUse(admin, owner, clip.flow_account_id, now);
  return { status: "READY" as const };
}

async function countFlowUse(admin: SupabaseClient, owner: string, flowAccountId: string, now: Date) {
  const today = bangkokDate(now);
  const row = check(await admin.from("flow_accounts").select("clips_today,clips_today_on").eq("owner_id", owner).eq("id", flowAccountId).maybeSingle(), "flow_accounts_unavailable") as
    { clips_today: number; clips_today_on: string | null } | null;
  if (!row) return;
  const clipsToday = (row.clips_today_on === today ? row.clips_today : 0) + 1;
  check(await admin.from("flow_accounts").update({ clips_today: clipsToday, clips_today_on: today, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", flowAccountId), "flow_account_not_saved");
}

export async function failClip(admin: SupabaseClient, owner: string, input: { clipId: string; reason: string; notStarted: boolean }) {
  const now = new Date().toISOString();
  const patch = input.notStarted
    ? { status: "QUEUED", flow_account_id: null, lease_until: null, error: null, updated_at: now }
    : { status: "FAILED", lease_until: null, error: input.reason.slice(0, 300), updated_at: now };
  check(await admin.from("flow_clips").update(patch).eq("owner_id", owner).eq("id", input.clipId).eq("status", "GENERATING"), "flow_clip_not_saved");
}

export async function markExhausted(admin: SupabaseClient, owner: string, flowAccountId: string, now = new Date()) {
  check(await admin.from("flow_accounts").update({ exhausted_on: bangkokDate(now), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", flowAccountId), "flow_account_not_saved");
}

/** After a pass: queued clips that no Google account with credits left may make are skipped; what was made stays. */
export async function finishWithoutCredits(admin: SupabaseClient, owner: string, now = new Date()) {
  const result = await admin.rpc("skip_unreachable_flow_clips", { p_owner: owner, p_today: bangkokDate(now) });
  if (result.error) throw new Error("flow_clips_unavailable");
  return { skipped: Number(result.data ?? 0) };
}

// ---------------------------------------------------------------- Library (owner)

export interface LibraryClip {
  id: string; tiktok_account_id: string; product_id: string | null; kind: "GROWTH" | "AFFILIATE"; title: string; caption: string;
  hashtags: string[]; status: FlowClipStatus; error: string | null; ready_at: string | null; scheduled_at: string | null; posted_at: string | null;
  post_url: string | null; duration_seconds: number | null; width: number | null; height: number | null; created_at: string; flow_account_id: string | null;
}

export async function listTodayClips(client: SupabaseClient, owner: string, accountId?: string, now = new Date()) {
  const { start, end } = bangkokDayRange(bangkokDate(now));
  let query = client.from("flow_clips").select(LIBRARY_COLUMNS).eq("owner_id", owner).gte("created_at", start).lt("created_at", end)
    .order("created_at", { ascending: true });
  if (accountId) query = query.eq("tiktok_account_id", accountId);
  return check(await query, "flow_clips_unavailable") as LibraryClip[];
}
export async function listLibrary(client: SupabaseClient, owner: string, accountId?: string) {
  let query = client.from("flow_clips").select(LIBRARY_COLUMNS).eq("owner_id", owner).in("status", LIBRARY_STATUSES)
    .order("scheduled_at", { ascending: true, nullsFirst: false }).order("ready_at", { ascending: true }).limit(200);
  if (accountId) query = query.eq("tiktok_account_id", accountId);
  return check(await query, "flow_clips_unavailable") as LibraryClip[];
}

async function libraryClip(admin: SupabaseClient, owner: string, id: string) {
  const clip = check(await admin.from("flow_clips").select("id,status,storage_path").eq("owner_id", owner).eq("id", id).maybeSingle(), "flow_clips_unavailable") as
    { id: string; status: FlowClipStatus; storage_path: string | null } | null;
  if (!clip || !LIBRARY_STATUSES.includes(clip.status) || !clip.storage_path) throw new Error("CLIP_NOT_IN_LIBRARY");
  return clip as { id: string; status: FlowClipStatus; storage_path: string };
}

export async function clipSignedUrl(admin: SupabaseClient, owner: string, id: string, download: boolean) {
  const clip = await libraryClip(admin, owner, id);
  const signed = await admin.storage.from(BUCKET).createSignedUrl(clip.storage_path, 600, download ? { download: `viralflow-${id.slice(0, 8)}.mp4` } : undefined);
  if (signed.error || !signed.data) throw new Error("VIDEO_UNAVAILABLE");
  return signed.data.signedUrl;
}

export async function scheduleClip(admin: SupabaseClient, owner: string, id: string, at: string | null) {
  await libraryClip(admin, owner, id);
  check(await admin.from("flow_clips").update({ status: at ? "SCHEDULED" : "READY", scheduled_at: at, updated_at: new Date().toISOString() })
    .eq("owner_id", owner).eq("id", id).in("status", LIBRARY_STATUSES), "flow_clip_not_saved");
}

/** Posted (or thrown away): the MP4 is deleted from Storage straight away; the row stays for counts and results. */
export async function closeClip(admin: SupabaseClient, owner: string, id: string, outcome: { posted: true; url: string | null } | { posted: false }, now = new Date()) {
  const clip = await libraryClip(admin, owner, id);
  const removed = await admin.storage.from(BUCKET).remove([clip.storage_path]);
  if (removed.error) throw new Error("VIDEO_NOT_DELETED");
  check(await admin.from("flow_clips").update({
    status: outcome.posted ? "POSTED" : "DISCARDED", posted_at: outcome.posted ? now.toISOString() : null, post_url: outcome.posted ? outcome.url : null,
    storage_path: null, file_deleted_at: now.toISOString(), updated_at: now.toISOString(),
  }).eq("owner_id", owner).eq("id", id).in("status", LIBRARY_STATUSES), "flow_clip_not_saved");
}
