import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { clipStoragePath } from "@/features/flow-farm/service";
import { metaConfig, socialReadiness, youtubeConfig, type SocialPlatform } from "@/features/social-publish/config";
import { advancePost, newPost, type PlatformPost } from "@/features/social-publish/publishers";
import { PLATFORM_LABEL, productIdFromUrl, type ProductPlatform } from "./link";
import type { ProductCapture } from "./capture";
import { detailsFromBrowser, LOOKUP_MAX_ATTEMPTS, lookupErrorLabel, type LookupResult, type LookupState } from "./browser-lookup";
import { factCandidates } from "./source";
import { writeProductClip, type ClipLength, type ProductClipScript } from "./script";
import { buildProductSubtitles } from "./subtitles";

const BUCKET = "video-assets";
const MAX_IMAGE_BYTES = 5_000_000;
const MAX_IMAGES = 4;
/** A failed or skipped take is made again up to this many times before the clip gives up. */
export const MAX_SHOT_ATTEMPTS = 3;
const SHOT_RETRY_WAIT_MS = 10 * 60_000;
const LOCK_MS = 30_000;
const ASSEMBLY_STALE_MS = 10 * 60_000;
const COLUMNS = "id,owner_id,tiktok_account_id,platform,source,link,product_url,external_id,title,facts,image_paths,length_seconds,script,status,shot_clip_ids,shot_attempts,final_clip_id,targets,posts,assemble_attempts,error,ready_at,reviewed_at,published_at,created_at,updated_at";

export type JobStatus = "PRODUCING" | "ASSEMBLING" | "REVIEW" | "APPROVED" | "PUBLISHING" | "PUBLISHED" | "REJECTED" | "FAILED";
export interface ProductClipJob {
  id: string; owner_id: string; tiktok_account_id: string; platform: ProductPlatform; source: string; link: string; product_url: string | null;
  external_id: string | null; title: string; facts: string[]; image_paths: string[]; length_seconds: ClipLength;
  /** A clip still waiting for the owner's computer to read the product page has only `lookup` (no shots yet). */
  script: ProductClipScript & { lookup?: LookupState };
  status: JobStatus; shot_clip_ids: string[]; shot_attempts: number[]; final_clip_id: string | null; targets: SocialPlatform[]; posts: PlatformPost[];
  assemble_attempts: number; error: string | null; ready_at: string | null; reviewed_at: string | null; published_at: string | null; created_at: string; updated_at: string;
}

function check<T>(result: { data: T; error: { message: string } | null }, code: string): T {
  if (result.error) throw new Error(code);
  return result.data;
}

// ---------------------------------------------------------------- Photos

/** Listing photos are only fetched from the marketplaces' own image hosts (the URLs come back from the browser). */
const IMAGE_HOSTS = /(^|\.)(shopee\.[a-z.]+|susercontent\.com|shopeemobile\.com|lazcdn\.com|slatic\.net|alicdn\.com|lazada\.[a-z.]+)$/i;
export function allowedImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.port && !url.username && IMAGE_HOSTS.test(url.hostname); } catch { return false; }
}
/** JPEG, PNG or WebP by their first bytes; anything else is refused whatever the server called it. */
export function imageType(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP") return "webp";
  return null;
}
async function fetchImage(url: string) {
  if (!allowedImageUrl(url)) throw new Error("IMAGE_HOST_NOT_ALLOWED");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`IMAGE_HTTP_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  return bytes;
}
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

async function saveImages(admin: SupabaseClient, owner: string, jobId: string, images: Uint8Array[]) {
  const paths: string[] = [];
  for (const [i, bytes] of images.entries()) {
    const type = imageType(bytes);
    if (!type || bytes.byteLength < 2000 || bytes.byteLength > MAX_IMAGE_BYTES) continue;
    const path = `owner/${owner}/product-links/${jobId}/${i + 1}.${type}`;
    const upload = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: MIME[type], upsert: true });
    if (!upload.error) paths.push(path);
  }
  return paths;
}

// ---------------------------------------------------------------- Create

export interface NewProductClip {
  tiktokAccountId: string; platform: ProductPlatform; source: "MANUAL_LINK" | "AFFILIATE_API"; link: string; productUrl: string | null; externalId: string | null;
  title: string; facts: string[]; lengthSeconds: ClipLength;
  /** Listing photo URLs chosen by the owner (marketplace hosts only) and/or photos uploaded from the computer. */
  imageUrls: string[]; uploads: Uint8Array[];
  /** A remake reuses the photos already saved. */
  imagePaths?: string[]; variant?: number;
}

/** Saves the photos and writes the script. Throws SCRIPT_REJECTED / NO_USABLE_IMAGE. */
async function prepare(admin: SupabaseClient, owner: string, id: string, input: NewProductClip) {
  let paths = input.imagePaths?.filter(p => p.startsWith(`owner/${owner}/`)) ?? [];
  if (!paths.length) {
    const fetched: Uint8Array[] = [];
    for (const url of input.imageUrls.slice(0, MAX_IMAGES)) { try { fetched.push(await fetchImage(url)); } catch { /* one bad photo does not stop the clip */ } }
    paths = await saveImages(admin, owner, id, [...input.uploads, ...fetched].slice(0, MAX_IMAGES));
  }
  if (!paths.length) throw new Error("NO_USABLE_IMAGE");
  const script = writeProductClip({ platform: input.platform, link: input.link, title: input.title, facts: input.facts, imageCount: paths.length,
    lengthSeconds: input.lengthSeconds, variant: input.variant });
  if (script.compliance.status === "REJECT") throw new Error("SCRIPT_REJECTED");
  return { paths, script };
}

/** Saves the photos, writes the script, and queues one Flow take per shot. Throws SCRIPT_REJECTED / NO_USABLE_IMAGE. */
export async function createProductClip(admin: SupabaseClient, owner: string, input: NewProductClip, now = new Date()) {
  const account = check(await admin.from("tiktok_accounts").select("id").eq("owner_id", owner).eq("id", input.tiktokAccountId).maybeSingle(), "accounts_unavailable");
  if (!account) throw new Error("account_not_found");
  const id = crypto.randomUUID();
  const { paths, script } = await prepare(admin, owner, id, input);
  const shotIds = script.shots.map(() => crypto.randomUUID());
  check(await admin.from("product_link_clips").insert({
    id, owner_id: owner, tiktok_account_id: input.tiktokAccountId, platform: input.platform, source: input.source, link: input.link,
    product_url: input.productUrl, external_id: input.externalId, title: input.title.slice(0, 300), facts: script.facts, image_paths: paths,
    length_seconds: input.lengthSeconds, script, status: "PRODUCING", shot_clip_ids: shotIds, shot_attempts: shotIds.map(() => 1),
    created_at: now.toISOString(), updated_at: new Date(now.getTime() - LOCK_MS).toISOString(),
  }), "product_clip_not_saved");
  const queued = await admin.from("flow_clips").insert(script.shots.map((shot, i) => shotRow(owner, input.tiktokAccountId, id, script, i, shotIds[i], paths)));
  if (queued.error) {
    await admin.from("product_link_clips").delete().eq("owner_id", owner).eq("id", id);
    throw new Error("flow_clips_not_queued");
  }
  return { id, script };
}

// ---------------------------------------------------------------- Read the product page on the owner's computer

/** Facts for an automatic clip: the seller's own feature lines (the script screens them again). */
export const autoFacts = (description: string) => factCandidates(description, 8);

/**
 * The marketplace refused the server: the clip waits (status PRODUCING, no shots yet) until the owner's Flow worker
 * opens the link in its Chrome and sends the page back (finishProductLookup), then the script and takes follow by themselves.
 */
export async function queueProductLookup(admin: SupabaseClient, owner: string,
  input: { tiktokAccountId: string; platform: ProductPlatform; link: string; externalId: string | null; lengthSeconds: ClipLength }, now = new Date()) {
  const account = check(await admin.from("tiktok_accounts").select("id").eq("owner_id", owner).eq("id", input.tiktokAccountId).maybeSingle(), "accounts_unavailable");
  if (!account) throw new Error("account_not_found");
  const id = crypto.randomUUID();
  const lookup: LookupState = { state: "PENDING", attempts: 0, requestedAt: now.toISOString(), claimedAt: null, note: null };
  check(await admin.from("product_link_clips").insert({
    id, owner_id: owner, tiktok_account_id: input.tiktokAccountId, platform: input.platform, source: "MANUAL_LINK", link: input.link, product_url: null,
    external_id: input.externalId, title: `${PLATFORM_LABEL[input.platform]} · กำลังดึงข้อมูลสินค้า`, facts: [], image_paths: [], length_seconds: input.lengthSeconds,
    script: { lookup }, status: "PRODUCING", shot_clip_ids: [], shot_attempts: [], created_at: now.toISOString(), updated_at: now.toISOString(),
  }), "product_clip_not_saved");
  return { id };
}

const LOOKUP_CLAIM_MS = 4 * 60_000;
/** Pages for the worker to open: waiting ones, and ones a worker took but never answered within 4 minutes. */
export async function claimProductLookups(admin: SupabaseClient, owner: string, now = new Date()) {
  const result = await admin.from("product_link_clips").select("id,platform,link,script,updated_at").eq("owner_id", owner).eq("status", "PRODUCING")
    .order("created_at", { ascending: true }).limit(20);
  if (result.error) return [];
  const out: Array<{ id: string; platform: ProductPlatform; link: string; attempts: number }> = [];
  for (const row of (result.data ?? []) as Array<{ id: string; platform: ProductPlatform; link: string; script: { lookup?: LookupState }; updated_at: string }>) {
    const lookup = row.script?.lookup;
    if (!lookup || lookup.state === "FAILED") continue;
    const stale = lookup.claimedAt && now.getTime() - Date.parse(lookup.claimedAt) > LOOKUP_CLAIM_MS;
    // LOGIN: the shop blocked the worker's window; it waits for the owner's "ส่งเข้า ViralFlow" button instead of looping.
    if (lookup.state === "LOGIN" || (lookup.state !== "PENDING" && !stale)) continue;
    // A claim that ran out with no answer (a Shopee page opened in the owner's Chrome without the extension) counts as a try.
    const attempts = lookup.attempts + (stale ? 1 : 0);
    if (attempts >= LOOKUP_MAX_ATTEMPTS) {
      await save(admin, owner, row.id, { script: { lookup: { ...lookup, state: "FAILED", attempts, claimedAt: null, note: "NO_EXTENSION" } }, status: "FAILED",
        error: `ดึงข้อมูลสินค้าไม่สำเร็จ: ${lookupErrorLabel("NO_EXTENSION")}`, updated_at: now.toISOString() }).catch(() => {});
      continue;
    }
    const next: LookupState = { ...lookup, state: "CLAIMED", attempts, claimedAt: now.toISOString() };
    const taken = await admin.from("product_link_clips").update({ script: { lookup: next }, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", row.id)
      .eq("updated_at", row.updated_at).select("id");
    if (!taken.error && taken.data?.length) out.push({ id: row.id, platform: row.platform, link: row.link, attempts: lookup.attempts });
    if (out.length >= 2) break;
  }
  return out;
}

function decodeImage(base64: string) {
  try { return new Uint8Array(Buffer.from(base64, "base64")); } catch { return null; }
}

/** What the worker's Chrome saw on the product page: write the script and queue the takes, or retry / give up. */
export async function finishProductLookup(admin: SupabaseClient, owner: string, result: LookupResult, now = new Date()) {
  const job = await loadJob(admin, owner, result.jobId);
  const lookup = job.script.lookup;
  if (job.status !== "PRODUCING" || !lookup || lookup.state === "FAILED") return { status: "IGNORED" as const };
  const giveUpOrRetry = async (code: string) => {
    if (code === "LOGIN_REQUIRED") {
      // Not counted as a try: the worker opens a window for the owner to sign in, then reads the page again.
      await save(admin, owner, job.id, { script: { lookup: { ...lookup, state: "LOGIN", note: code } }, error: lookupErrorLabel(code), updated_at: now.toISOString() });
      return { status: "LOGIN" as const };
    }
    const attempts = lookup.attempts + 1, last = attempts >= LOOKUP_MAX_ATTEMPTS;
    await save(admin, owner, job.id, { script: { lookup: { ...lookup, state: last ? "FAILED" : "PENDING", attempts, claimedAt: null, note: code.slice(0, 160) } },
      status: last ? "FAILED" : "PRODUCING", error: `${last ? "ดึงข้อมูลสินค้าไม่สำเร็จ" : `ดึงข้อมูลไม่สำเร็จ ลองใหม่ (ครั้งที่ ${attempts})`}: ${lookupErrorLabel(code)}`.slice(0, 480),
      updated_at: now.toISOString() });
    return { status: last ? "FAILED" as const : "RETRY" as const };
  };
  if (!result.ok) return giveUpOrRetry(result.error ?? "READ_FAILED");
  const details = detailsFromBrowser(job.platform, result);
  if (!details.title) return giveUpOrRetry("NO_TITLE");
  const uploads = (result.images ?? []).map(i => decodeImage(i.base64)).filter((b): b is Uint8Array<ArrayBuffer> => !!b && !!imageType(b));
  const input: NewProductClip = { tiktokAccountId: job.tiktok_account_id, platform: job.platform, source: "MANUAL_LINK", link: job.link, productUrl: details.productUrl,
    externalId: details.externalId ?? job.external_id, title: details.title, facts: autoFacts(details.description), lengthSeconds: job.length_seconds,
    imageUrls: uploads.length ? [] : details.imageUrls.filter(allowedImageUrl), uploads };
  let prepared;
  try { prepared = await prepare(admin, owner, job.id, input); }
  catch (error) {
    const code = error instanceof Error ? error.message : "SCRIPT_FAILED";
    if (code === "NO_USABLE_IMAGE") return giveUpOrRetry("NO_IMAGES");
    await save(admin, owner, job.id, { status: "FAILED", script: { lookup: { ...lookup, state: "FAILED", note: code } }, title: details.title,
      error: code === "SCRIPT_REJECTED" ? "ข้อมูลหน้าร้านมีคำกล่าวอ้างที่ห้ามใช้ ระบบไม่สร้างคลิปนี้" : `เขียนสคริปต์ไม่สำเร็จ: ${code}`.slice(0, 480), updated_at: now.toISOString() });
    return { status: "FAILED" as const };
  }
  const { paths, script } = prepared;
  const shotIds = script.shots.map(() => crypto.randomUUID());
  check(await admin.from("product_link_clips").update({
    title: details.title, product_url: details.productUrl, external_id: input.externalId, facts: script.facts, image_paths: paths, script,
    shot_clip_ids: shotIds, shot_attempts: shotIds.map(() => 1), error: null, updated_at: new Date(now.getTime() - LOCK_MS).toISOString(),
  }).eq("owner_id", owner).eq("id", job.id).eq("status", "PRODUCING"), "product_clip_not_saved");
  const queued = await admin.from("flow_clips").insert(script.shots.map((_, i) => shotRow(owner, job.tiktok_account_id, job.id, script, i, shotIds[i], paths)));
  if (queued.error) await save(admin, owner, job.id, { status: "FAILED", error: "เข้าคิว Flow ไม่ได้", updated_at: now.toISOString() });
  return { status: "QUEUED" as const, shots: script.shots.length, title: details.title };
}

/**
 * The owner sent the product page from their own Chrome (the "ส่งเข้า ViralFlow" bookmark). It fills the clip waiting
 * for that product, else the newest clip still waiting for product details, else starts a new clip on the first account.
 */
export async function captureProductPage(admin: SupabaseClient, owner: string, capture: ProductCapture, platform: ProductPlatform, now = new Date(), preferredJobId?: string | null) {
  let externalId: string | null = null;
  try { externalId = productIdFromUrl(platform, new URL(capture.finalUrl)); } catch { externalId = null; }
  const rows = check(await admin.from("product_link_clips").select("id,platform,external_id,script,shot_clip_ids,created_at").eq("owner_id", owner).eq("status", "PRODUCING")
    .order("created_at", { ascending: false }).limit(30), "product_clips_unavailable") as Array<{ id: string; platform: ProductPlatform; external_id: string | null;
      script: { lookup?: LookupState }; shot_clip_ids: string[] }>;
  const waiting = rows.filter(r => r.platform === platform && r.script?.lookup && r.script.lookup.state !== "FAILED" && !r.shot_clip_ids?.length);
  let jobId = (preferredJobId && waiting.find(r => r.id === preferredJobId)?.id) || (externalId && waiting.find(r => r.external_id === externalId)?.id) || waiting.find(r => !r.external_id)?.id || waiting[0]?.id || null;
  let created = false;
  if (!jobId) {
    const account = check(await admin.from("tiktok_accounts").select("id").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true }).limit(1).maybeSingle(), "accounts_unavailable") as { id: string } | null;
    if (!account) throw new Error("account_not_found");
    jobId = (await queueProductLookup(admin, owner, { tiktokAccountId: account.id, platform, link: capture.finalUrl, externalId, lengthSeconds: 16 }, now)).id;
    created = true;
  }
  const result = await finishProductLookup(admin, owner, { ...capture, jobId, ok: true }, now);
  return { jobId, created, ...result };
}

function shotRow(owner: string, tiktokAccountId: string, jobId: string, script: ProductClipScript, index: number, clipId: string, paths: string[]) {
  const shot = script.shots[index];
  return { id: clipId, owner_id: owner, tiktok_account_id: tiktokAccountId, batch_id: jobId, product_id: null, kind: "PRODUCT_SHOT",
    title: `${script.shortName} · ช็อต ${index + 1}/${script.shots.length} ${shot.roleTh}`.slice(0, 200), prompt: shot.prompt,
    caption: script.caption.slice(0, 2200), hashtags: script.hashtags, reference_image_path: paths[shot.imageIndex % paths.length] ?? paths[0] };
}

// ---------------------------------------------------------------- Read

export async function productClipsAvailable(client: SupabaseClient) {
  const result = await client.from("product_link_clips").select("id", { head: true, count: "exact" }).limit(1);
  return !result.error;
}
export interface ShotState { id: string; status: string; error: string | null }
export async function listProductClips(client: SupabaseClient, owner: string) {
  const jobs = check(await client.from("product_link_clips").select(COLUMNS).eq("owner_id", owner)
    .order("created_at", { ascending: false }).limit(40), "product_clips_unavailable") as ProductClipJob[];
  const ids = jobs.flatMap(j => j.status === "PRODUCING" ? j.shot_clip_ids : []);
  const shots = ids.length ? (check(await client.from("flow_clips").select("id,status,error").eq("owner_id", owner).in("id", ids), "flow_clips_unavailable") as ShotState[]) : [];
  const byId = new Map(shots.map(s => [s.id, s]));
  return jobs.map(job => ({ ...job, shots: job.shot_clip_ids.map(id => byId.get(id) ?? null) }));
}
export type ProductClipView = Awaited<ReturnType<typeof listProductClips>>[number];

async function loadJob(admin: SupabaseClient, owner: string, id: string) {
  const job = check(await admin.from("product_link_clips").select(COLUMNS).eq("owner_id", owner).eq("id", id).maybeSingle(), "product_clips_unavailable") as ProductClipJob | null;
  if (!job) throw new Error("PRODUCT_CLIP_NOT_FOUND");
  return job;
}

// ---------------------------------------------------------------- Tick (driven by the worker's poll and by page loads)

/**
 * Takes a short lock on the job by moving updated_at forward only if nobody touched it in the last 30 seconds, so two
 * ticks at once (worker poll + page load) never queue a shot twice or post a clip twice.
 */
async function lock(admin: SupabaseClient, owner: string, job: ProductClipJob, now: Date) {
  const rows = check(await admin.from("product_link_clips").update({ updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", job.id).eq("status", job.status)
    .lt("updated_at", new Date(now.getTime() - LOCK_MS).toISOString()).select("id"), "product_clips_unavailable") as unknown[] | null;
  return Boolean(rows?.length);
}
async function save(admin: SupabaseClient, owner: string, id: string, patch: Record<string, unknown>) {
  check(await admin.from("product_link_clips").update(patch).eq("owner_id", owner).eq("id", id), "product_clip_not_saved");
}

export async function tickProductClips(admin: SupabaseClient, owner: string, now = new Date()) {
  const result = await admin.from("product_link_clips").select(COLUMNS).eq("owner_id", owner).in("status", ["PRODUCING", "ASSEMBLING", "PUBLISHING"]).limit(20);
  if (result.error) return { jobs: 0 }; // migration not applied yet
  const jobs = (result.data ?? []) as ProductClipJob[];
  for (const job of jobs) {
    try {
      if (job.status === "ASSEMBLING" && now.getTime() - Date.parse(job.updated_at) < ASSEMBLY_STALE_MS) continue;
      // Still waiting for the owner's computer to read the product page; after a day without it, give up.
      if (job.script?.lookup) {
        if (now.getTime() - Date.parse(job.script.lookup.requestedAt) > 24 * 3600_000 && job.script.lookup.state !== "CLAIMED")
          await save(admin, owner, job.id, { status: "FAILED", script: { lookup: { ...job.script.lookup, state: "FAILED" } },
            error: "เครื่องสร้างคลิปไม่ได้เปิดหน้าสินค้าภายใน 1 วัน กด “ลองใหม่” ตอนเปิดคอมอยู่", updated_at: now.toISOString() });
        continue;
      }
      if (!(await lock(admin, owner, job, now))) continue;
      if (job.status === "PUBLISHING") await publishStep(admin, owner, job, now);
      else await produceStep(admin, owner, job, now);
    } catch (error) { console.error("[product-clips] tick failed", job.id, error); }
  }
  return { jobs: jobs.length };
}

async function produceStep(admin: SupabaseClient, owner: string, job: ProductClipJob, now: Date) {
  const clips = check(await admin.from("flow_clips").select("id,status,error,storage_path,duration_seconds,updated_at").eq("owner_id", owner).in("id", job.shot_clip_ids), "flow_clips_unavailable") as
    Array<{ id: string; status: string; error: string | null; storage_path: string | null; duration_seconds: number | null; updated_at: string }>;
  const byId = new Map(clips.map(c => [c.id, c]));
  const ids = [...job.shot_clip_ids], attempts = [...job.shot_attempts];
  let changed = false;
  for (const [i, id] of ids.entries()) {
    const clip = byId.get(id);
    if (clip && ["QUEUED", "GENERATING", "READY"].includes(clip.status)) continue;
    // Every Google account ran out of credits: wait for tomorrow's credits, then queue the take again (not counted as a try).
    const noCredit = clip?.status === "SKIPPED_NO_CREDIT";
    if (noCredit && bangkokDate(clip.updated_at) === bangkokDate(now)) continue;
    // A failed take waits 10 minutes before the next try, so Flow never sees the same shot started again and again.
    if (clip && !noCredit && now.getTime() - Date.parse(clip.updated_at) < SHOT_RETRY_WAIT_MS) continue;
    // Failed, out of credits, or the row is gone: make this take again, up to MAX_SHOT_ATTEMPTS.
    if (!noCredit && (attempts[i] ?? 1) >= MAX_SHOT_ATTEMPTS) {
      await save(admin, owner, job.id, { status: "FAILED", error: `ช็อต ${i + 1} สร้างไม่สำเร็จ ${attempts[i]} ครั้ง (${clip?.error ?? clip?.status ?? "ไม่พบ"})`.slice(0, 480), updated_at: now.toISOString() });
      return;
    }
    const next = crypto.randomUUID();
    check(await admin.from("flow_clips").insert(shotRow(owner, job.tiktok_account_id, job.id, job.script, i, next, job.image_paths)), "flow_clips_not_queued");
    ids[i] = next; attempts[i] = (attempts[i] ?? 1) + (noCredit ? 0 : 1); changed = true;
  }
  if (changed) return save(admin, owner, job.id, { shot_clip_ids: ids, shot_attempts: attempts, error: null, updated_at: now.toISOString() });
  if (!ids.every(id => byId.get(id)?.status === "READY")) return;
  await assemble(admin, owner, job, ids.map(id => byId.get(id)!), now);
}

async function assemble(admin: SupabaseClient, owner: string, job: ProductClipJob, shots: Array<{ id: string; storage_path: string | null; duration_seconds: number | null }>, now: Date) {
  const claimed = check(await admin.from("product_link_clips").update({ status: "ASSEMBLING", assemble_attempts: job.assemble_attempts + 1, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", job.id).in("status", ["PRODUCING", "ASSEMBLING"]).select("id"), "product_clips_unavailable") as unknown[] | null;
  if (!claimed?.length) return;
  const clipId = crypto.randomUUID(), path = clipStoragePath(owner, clipId);
  try {
    const inputs = [];
    for (const [i, shot] of shots.entries()) {
      if (!shot.storage_path) throw new Error("SHOT_VIDEO_MISSING");
      const file = await admin.storage.from(BUCKET).download(shot.storage_path);
      if (file.error || !file.data) throw new Error("SHOT_VIDEO_MISSING");
      inputs.push({ bytes: new Uint8Array(await file.data.arrayBuffer()), durationSeconds: Number(shot.duration_seconds ?? 8), subtitle: job.script.shots[i]?.narration ?? "" });
    }
    const { assembleEpisode } = await import("@/features/drama/media");
    const video = await assembleEpisode({ shots: inputs, ass: durations => buildProductSubtitles({ lines: [], durations,
      // 10 Nov (owner): no subtitles or headline on the video; only the AI disclosure and the end "link" card stay.
      endCard: "ลิงก์สินค้าอยู่ในคอมเมนต์", aiLabel: "สร้างด้วย AI" }) });
    const sha256 = createHash("sha256").update(video.bytes).digest("hex");
    const upload = await admin.storage.from(BUCKET).upload(path, video.bytes, { contentType: "video/mp4", upsert: true });
    if (upload.error) throw new Error("CLIP_NOT_SAVED");
    check(await admin.from("flow_clips").insert({
      id: clipId, owner_id: owner, tiktok_account_id: job.tiktok_account_id, batch_id: job.id, kind: "PRODUCT_CLIP",
      title: `${job.script.shortName} · ${job.length_seconds} วิ`.slice(0, 200), prompt: `Product clip cut from ${shots.length} Flow takes (${job.platform})`,
      caption: job.script.caption.slice(0, 2200), hashtags: job.script.hashtags, status: "READY", storage_path: path, video_sha256: sha256,
      video_bytes: video.bytes.length, duration_seconds: video.durationSeconds, width: video.width, height: video.height, ready_at: now.toISOString(),
    }), "product_clip_not_saved");
    await save(admin, owner, job.id, { status: "REVIEW", final_clip_id: clipId, ready_at: now.toISOString(), error: null, updated_at: now.toISOString() });
  } catch (error) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    const reason = error instanceof Error ? error.message.slice(0, 300) : "ASSEMBLY_FAILED";
    await save(admin, owner, job.id, { status: job.assemble_attempts + 1 >= 3 ? "FAILED" : "PRODUCING", error: `ตัดต่อไม่สำเร็จ: ${reason}`,
      updated_at: new Date(now.getTime() - LOCK_MS).toISOString() });
  }
}

async function publishStep(admin: SupabaseClient, owner: string, job: ProductClipJob, now: Date) {
  const clip = job.final_clip_id ? check(await admin.from("flow_clips").select("storage_path").eq("owner_id", owner).eq("id", job.final_clip_id).maybeSingle(), "flow_clips_unavailable") as
    { storage_path: string | null } | null : null;
  if (!clip?.storage_path) return save(admin, owner, job.id, { status: "FAILED", error: "ไม่พบไฟล์คลิป", updated_at: now.toISOString() });
  const signed = await admin.storage.from(BUCKET).createSignedUrl(clip.storage_path, 3600);
  if (signed.error || !signed.data) throw new Error("SIGNED_URL_UNAVAILABLE");
  let bytes: Uint8Array | null = null;
  const ctx = { videoUrl: signed.data.signedUrl, caption: job.script.caption, comment: job.script.comment, youtubeTitle: job.script.youtubeTitle,
    meta: metaConfig(), youtube: youtubeConfig(), now,
    videoBytes: async () => {
      if (bytes) return bytes;
      const file = await admin.storage.from(BUCKET).download(clip.storage_path!);
      if (file.error || !file.data) throw new Error("CLIP_FILE_MISSING");
      return (bytes = new Uint8Array(await file.data.arrayBuffer()));
    } };
  const posts: PlatformPost[] = [];
  for (const post of job.posts) posts.push(await advancePost(post, ctx));
  const finished = posts.every(p => p.status === "DONE" || p.status === "FAILED");
  await save(admin, owner, job.id, { posts, status: finished ? "PUBLISHED" : "PUBLISHING", published_at: finished ? now.toISOString() : null, updated_at: now.toISOString() });
}

// ---------------------------------------------------------------- Review

/** Approve: post to the chosen platforms that are set up (others are left for posting by hand). Reject: the cut is thrown away. */
export async function reviewProductClip(admin: SupabaseClient, owner: string, id: string, decision: { approved: boolean; targets: SocialPlatform[] }, now = new Date()) {
  const job = await loadJob(admin, owner, id);
  if (job.status !== "REVIEW") throw new Error("NOT_WAITING_FOR_REVIEW");
  if (!decision.approved) {
    await save(admin, owner, id, { status: "REJECTED", reviewed_at: now.toISOString(), updated_at: now.toISOString() });
    await discardFiles(admin, owner, job, true);
    return { posting: [] as SocialPlatform[] };
  }
  const ready = socialReadiness(owner).ready, targets = [...new Set(decision.targets)].filter(t => ready.includes(t));
  await save(admin, owner, id, { status: targets.length ? "PUBLISHING" : "APPROVED", targets, posts: targets.map(t => newPost(t, now)), reviewed_at: now.toISOString(),
    updated_at: new Date(now.getTime() - LOCK_MS).toISOString() });
  await discardFiles(admin, owner, job, false);
  return { posting: targets };
}

/** Shot MP4s are no longer needed once the cut is reviewed; a rejected cut goes too. */
async function discardFiles(admin: SupabaseClient, owner: string, job: ProductClipJob, includeFinal: boolean) {
  const ids = [...job.shot_clip_ids, ...(includeFinal && job.final_clip_id ? [job.final_clip_id] : [])];
  if (!ids.length) return;
  const rows = (await admin.from("flow_clips").select("id,storage_path,status").eq("owner_id", owner).in("id", ids)).data as Array<{ id: string; storage_path: string | null; status: string }> | null;
  const files = (rows ?? []).map(r => r.storage_path).filter((p): p is string => !!p);
  if (files.length) await admin.storage.from(BUCKET).remove(files).catch(() => {});
  const at = new Date().toISOString();
  await admin.from("flow_clips").update({ status: "DISCARDED", file_deleted_at: at, lease_until: null, updated_at: at }).eq("owner_id", owner).in("id", ids)
    .in("status", ["READY", "QUEUED", "FAILED", "SKIPPED_NO_CREDIT"]);
}

/** Make the same product again with another set and hook (after a rejected or failed clip). Uses the saved photos. */
export async function remakeProductClip(admin: SupabaseClient, owner: string, id: string, now = new Date()) {
  const job = await loadJob(admin, owner, id);
  if (!["REJECTED", "FAILED", "APPROVED", "PUBLISHED"].includes(job.status)) throw new Error("STILL_IN_PROGRESS");
  // The product page was never read: read it again on the same card.
  if (!job.image_paths.length) {
    const lookup: LookupState = { state: "PENDING", attempts: 0, requestedAt: now.toISOString(), claimedAt: null, note: null };
    await save(admin, owner, id, { status: "PRODUCING", script: { lookup }, shot_clip_ids: [], shot_attempts: [], error: null, updated_at: now.toISOString() });
    return { id, script: null };
  }
  const created = await createProductClip(admin, owner, { tiktokAccountId: job.tiktok_account_id, platform: job.platform, source: job.source === "AFFILIATE_API" ? "AFFILIATE_API" : "MANUAL_LINK",
    link: job.link, productUrl: job.product_url, externalId: job.external_id, title: job.title, facts: job.facts, lengthSeconds: job.length_seconds,
    imageUrls: [], uploads: [], imagePaths: job.image_paths, variant: Date.parse(job.created_at) % 97 + 1 }, now);
  if (job.status === "FAILED") await discardFiles(admin, owner, job, true);
  return created;
}

/** Removes a clip that is not posting right now, with its queued takes and files (saved photos stay for remakes of other clips). */
export async function deleteProductClip(admin: SupabaseClient, owner: string, id: string) {
  const job = await loadJob(admin, owner, id);
  if (job.status === "PUBLISHING" || job.status === "ASSEMBLING") throw new Error("STILL_IN_PROGRESS");
  await discardFiles(admin, owner, job, true);
  const used = check(await admin.from("product_link_clips").select("id,image_paths").eq("owner_id", owner).neq("id", id), "product_clips_unavailable") as Array<{ image_paths: string[] }>;
  const keep = new Set(used.flatMap(j => j.image_paths));
  const photos = job.image_paths.filter(p => !keep.has(p));
  if (photos.length) await admin.storage.from(BUCKET).remove(photos).catch(() => {});
  check(await admin.from("product_link_clips").delete().eq("owner_id", owner).eq("id", id), "product_clip_not_saved");
}
