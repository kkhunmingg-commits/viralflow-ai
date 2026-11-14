import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { failureLabel, MAX_TAKE_ATTEMPTS, planTakes, promptFor, type PresenterStatus, type PresenterTake } from "./presenter-plan";

/**
 * AI LIVE presenters made by the owner's existing Google Flow worker. Driven by the worker's minute poll
 * (tickPresenters), like Drama Studio and product clips: queue the face take, turn its last frame into the face,
 * then queue the talking and idle takes that start from it.
 */
const BUCKET = "video-assets";
const LOCK_MS = 30_000;
// Flow refunds a failed take at once; a short pause is enough before trying again.
const RETRY_WAIT_MS = 2 * 60_000;
const CHECKS_PER_TICK = 4;
const COLUMNS = "id,owner_id,tiktok_account_id,name,look,status,face_still_path,takes,error,ready_at,created_at,updated_at";

export interface PresenterRow {
  id: string; owner_id: string; tiktok_account_id: string; name: string; look: string; status: PresenterStatus;
  face_still_path: string | null; takes: PresenterTake[]; error: string | null; ready_at: string | null; created_at: string; updated_at: string;
}
type ClipRow = { id: string; status: string; error: string | null; storage_path: string | null; updated_at: string };

function check<T>(result: { data: T; error: { message: string } | null }, code: string): T {
  if (result.error) throw new Error(code);
  return result.data;
}
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
export function faceStillPath(owner: string, presenterId: string) {
  if (!isUuid(owner) || !isUuid(presenterId)) throw new Error("INVALID_PRESENTER_PATH");
  return `owner/${owner}/ai-live/presenters/${presenterId}/face.jpg`;
}

// ---------------------------------------------------------------- Owner actions

export async function presentersAvailable(client: SupabaseClient) {
  const result = await client.from("ai_live_presenters").select("id", { head: true, count: "exact" }).limit(1);
  return !result.error;
}

export async function listPresenters(client: SupabaseClient, owner: string) {
  const result = await client.from("ai_live_presenters").select(COLUMNS).eq("owner_id", owner).order("created_at", { ascending: false }).limit(20);
  if (result.error) return [] as PresenterRow[];
  return (result.data ?? []) as PresenterRow[];
}

export async function createPresenter(admin: SupabaseClient, owner: string, input: { name: string; look: string }) {
  // flow_clips rows need a channel, but every Google account in the shared pool makes any channel's clips (10 Nov owner),
  // so the presenter is filed under the owner's first connected TikTok account without asking.
  const accounts = check(await admin.from("tiktok_accounts").select("id,is_mock,authorization_status").eq("owner_id", owner).order("created_at"), "account_not_found") as
    Array<{ id: string; is_mock: boolean | null; authorization_status: string | null }> | null;
  const account = accounts?.find(a => !a.is_mock && a.authorization_status === "authorized") ?? accounts?.[0];
  if (!account) throw new Error("account_not_found");
  await import("@/features/flow-farm/service").then(m => m.shareFlowAccounts(admin, owner)).catch(() => {});
  const busy = check(await admin.from("ai_live_presenters").select("id").eq("owner_id", owner).in("status", ["FACE", "CLIPS"]), "presenter_not_saved") as unknown[];
  if (busy.length) throw new Error("PRESENTER_IN_PROGRESS");
  const id = crypto.randomUUID();
  check(await admin.from("ai_live_presenters").insert({
    id, owner_id: owner, tiktok_account_id: account.id, name: input.name, look: input.look, status: "FACE", takes: planTakes(),
    // Old enough that the next worker poll may take the lock straight away.
    updated_at: new Date(Date.now() - LOCK_MS * 2).toISOString(),
  }), "presenter_not_saved");
  const presenter = await loadPresenter(admin, owner, id);
  await advance(admin, owner, presenter, new Date());
  return id;
}

export async function retryPresenter(admin: SupabaseClient, owner: string, id: string) {
  const presenter = await loadPresenter(admin, owner, id);
  if (presenter.status !== "FAILED") throw new Error("PRESENTER_NOT_FAILED");
  // Finished takes stay; the rest get fresh tries. A queued take keeps its Flow clip, so one still being made is not
  // queued twice (a failed one is queued again on the next poll).
  const takes = presenter.takes.map(t => t.status === "DONE" ? t
    : t.status === "QUEUED" && t.clipId ? { ...t, attempts: 0, error: null } : { ...t, status: "PLANNED" as const, attempts: 0, clipId: null, error: null });
  const status: PresenterStatus = takes.find(t => t.role === "FACE")?.status === "DONE" && presenter.face_still_path ? "CLIPS" : "FACE";
  await save(admin, owner, id, { status, takes, error: null, updated_at: new Date(Date.now() - LOCK_MS * 2).toISOString() });
}

export async function deletePresenter(admin: SupabaseClient, owner: string, id: string) {
  const presenter = await loadPresenter(admin, owner, id);
  const clipIds = presenter.takes.map(t => t.clipId).filter((v): v is string => Boolean(v));
  if (clipIds.length) {
    const clips = check(await admin.from("flow_clips").select("id,status,storage_path").eq("owner_id", owner).in("id", clipIds), "flow_clips_unavailable") as
      Array<{ id: string; status: string; storage_path: string | null }>;
    // A take Flow is making right now finishes and lands as an orphan READY clip; queued ones are simply dropped.
    await admin.from("flow_clips").update({ status: "DISCARDED", updated_at: new Date().toISOString() }).eq("owner_id", owner)
      .in("id", clips.filter(c => c.status === "QUEUED").map(c => c.id));
    const files = clips.map(c => c.storage_path).filter((p): p is string => Boolean(p));
    if (files.length) await admin.storage.from(BUCKET).remove(files).catch(() => {});
    await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, file_deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("owner_id", owner).in("id", clips.filter(c => ["READY", "SCHEDULED"].includes(c.status)).map(c => c.id));
  }
  if (presenter.face_still_path) await admin.storage.from(BUCKET).remove([presenter.face_still_path]).catch(() => {});
  check(await admin.from("ai_live_presenters").delete().eq("owner_id", owner).eq("id", id), "presenter_not_saved");
}

/** Short-lived links for the face picture shown on the page. */
export async function faceUrl(admin: SupabaseClient, presenter: PresenterRow) {
  if (!presenter.face_still_path) return null;
  const signed = await admin.storage.from(BUCKET).createSignedUrl(presenter.face_still_path, 3600);
  return signed.error ? null : signed.data.signedUrl;
}

/** For the owner's computer: every finished take of a ready presenter, with download links valid for an hour. */
export async function presenterDownloads(admin: SupabaseClient, owner: string, id: string) {
  const presenter = await loadPresenter(admin, owner, id);
  if (presenter.status !== "READY") throw new Error("PRESENTER_NOT_READY");
  const takes = [];
  for (const take of presenter.takes.filter(t => t.role !== "FACE" && t.path)) {
    const signed = await admin.storage.from(BUCKET).createSignedUrl(take.path!, 3600);
    if (signed.error) throw new Error("PRESENTER_FILES_UNAVAILABLE");
    takes.push({ key: take.key, role: take.role, line: take.line, url: signed.data.signedUrl });
  }
  return { id: presenter.id, name: presenter.name, takes };
}

/** Ready presenters for the computer to list (newest first). */
export async function readyPresenters(admin: SupabaseClient, owner: string) {
  const rows = check(await admin.from("ai_live_presenters").select("id,name,ready_at").eq("owner_id", owner).eq("status", "READY")
    .order("ready_at", { ascending: false }).limit(20), "presenters_unavailable") as Array<{ id: string; name: string; ready_at: string }>;
  return rows;
}

// ---------------------------------------------------------------- Worker poll

export async function tickPresenters(admin: SupabaseClient, owner: string, now = new Date()) {
  const result = await admin.from("ai_live_presenters").select(COLUMNS).eq("owner_id", owner).in("status", ["FACE", "CLIPS"]).limit(5);
  if (result.error) return { presenters: 0 }; // migration not applied yet
  const presenters = (result.data ?? []) as PresenterRow[];
  for (const presenter of presenters) {
    try {
      if (!(await lock(admin, owner, presenter, now))) continue;
      await advance(admin, owner, presenter, now);
    } catch (error) { console.error("[ai-live] presenter tick failed", presenter.id, error); }
  }
  return { presenters: presenters.length };
}

/** One step for one presenter; the rules live in the pure decide() below. */
async function advance(admin: SupabaseClient, owner: string, presenter: PresenterRow, now: Date) {
  const ids = presenter.takes.map(t => t.clipId).filter((v): v is string => Boolean(v));
  const clips = ids.length ? check(await admin.from("flow_clips").select("id,status,error,storage_path,updated_at").eq("owner_id", owner).in("id", ids),
    "flow_clips_unavailable") as ClipRow[] : [];
  const plan = decide(presenter, new Map(clips.map(c => [c.id, c])), now);
  const takes = [...presenter.takes];
  let facePath = presenter.face_still_path, checked = 0;

  for (const step of plan.steps) {
    if (step.kind === "FAIL") {
      await save(admin, owner, presenter.id, { status: "FAILED", takes, error: step.reason.slice(0, 480), updated_at: now.toISOString() });
      return;
    }
    const take = takes[step.index];
    if (step.kind === "DONE") {
      // Checking means downloading and decoding the take: a few per poll keeps the request short.
      if (checked >= CHECKS_PER_TICK) continue;
      checked++;
      let verdict: Awaited<ReturnType<typeof checkTake>>;
      try { verdict = await checkTake(admin, step.storagePath, take.role === "TALK"); }
      catch (error) { console.error("[ai-live] take check unavailable", take.key, error); continue; } // checked again next poll
      if (!verdict.ok) {
        // Not kept: the file goes, the clip is discarded and the slot is made again (counts as a try).
        await discardClip(admin, owner, take.clipId, step.storagePath, verdict.reason, now);
        takes[step.index] = { ...take, status: "PLANNED", clipId: null, path: null, error: `ตรวจไม่ผ่าน: ${verdict.reason}`, check: verdict.reason };
        continue;
      }
      if (take.role === "FACE") {
        try { facePath = await saveFace(admin, owner, presenter.id, step.storagePath); }
        catch {
          takes[step.index] = { ...take, status: "PLANNED", clipId: null, error: "ตรวจไม่ผ่าน: ดึงภาพหน้าจากคลิปไม่ได้" };
          continue;
        }
      }
      takes[step.index] = { ...take, status: "DONE", path: step.storagePath, error: null, check: verdict.note };
      continue;
    }
    // QUEUE: a new Flow take for this slot.
    if (take.role !== "FACE" && !facePath) continue;
    const clipId = crypto.randomUUID();
    check(await admin.from("flow_clips").insert({
      id: clipId, owner_id: owner, tiktok_account_id: presenter.tiktok_account_id, batch_id: presenter.id, product_id: null, kind: "PRESENTER_CLIP",
      // Inserted together they share created_at; 1 ms apart keeps the order on the page and in Flow.
      created_at: new Date(now.getTime() + step.index).toISOString(),
      title: `พรีเซนเตอร์ ${presenter.name} · ${takeLabel(take)}`.slice(0, 200), prompt: promptFor(take, presenter.look, take.attempts).slice(0, 12000),
      caption: `AI LIVE presenter ${presenter.name}`.slice(0, 2200), hashtags: [], reference_image_path: take.role === "FACE" ? null : facePath,
    }), "flow_clips_not_queued");
    takes[step.index] = { ...take, status: "QUEUED", clipId, attempts: take.attempts + (step.countsAsTry ? 1 : 0), error: step.reason ? failureLabel(step.reason) : null };
  }

  const faceDone = takes.find(t => t.role === "FACE")?.status === "DONE";
  const allDone = takes.every(t => t.status === "DONE");
  const status: PresenterStatus = allDone ? "READY" : faceDone ? "CLIPS" : "FACE";
  if (status === "CLIPS" && presenter.status === "FACE") {
    // The face just arrived: queue every talking and idle take now, in this same step.
    const again = { ...presenter, takes, face_still_path: facePath, status };
    await save(admin, owner, presenter.id, { takes, face_still_path: facePath, status, error: null, updated_at: now.toISOString() });
    return advance(admin, owner, again, now);
  }
  await save(admin, owner, presenter.id, { takes, face_still_path: facePath, status, error: null, updated_at: now.toISOString(),
    ...(allDone ? { ready_at: now.toISOString() } : {}) });
}

export type Step =
  | { kind: "QUEUE"; index: number; countsAsTry: boolean; reason?: string }
  | { kind: "DONE"; index: number; storagePath: string }
  | { kind: "FAIL"; reason: string };

/** What to do with each take, from its Flow clip's state. Pure, so the rules are tested without a database. */
export function decide(presenter: Pick<PresenterRow, "status" | "takes">, clips: Map<string, Pick<ClipRow, "status" | "error" | "storage_path" | "updated_at">>, now: Date) {
  const steps: Step[] = [];
  const active = presenter.takes.map((t, index) => ({ t, index })).filter(({ t }) => presenter.status === "FACE" ? t.role === "FACE" : t.role !== "FACE");
  for (const { t, index } of active) {
    if (t.status === "DONE") continue;
    if (t.status === "PLANNED") {
      // Back to PLANNED after a take that came out unusable (no face in it): still limited to MAX_TAKE_ATTEMPTS.
      if (t.attempts >= MAX_TAKE_ATTEMPTS) { steps.push({ kind: "FAIL", reason: `${takeLabel(t)} สร้างไม่สำเร็จ ${t.attempts} ครั้ง (${t.error ?? "ใช้ไม่ได้"})` }); return { steps }; }
      steps.push({ kind: "QUEUE", index, countsAsTry: true });
      continue;
    }
    const clip = t.clipId ? clips.get(t.clipId) : undefined;
    if (clip && ["QUEUED", "GENERATING"].includes(clip.status)) continue;
    if (clip && ["READY", "SCHEDULED"].includes(clip.status) && clip.storage_path) { steps.push({ kind: "DONE", index, storagePath: clip.storage_path }); continue; }
    // Every Google account ran out of credits: wait for tomorrow's credits, then queue it again (not counted as a try).
    const noCredit = clip?.status === "SKIPPED_NO_CREDIT";
    if (noCredit) {
      if (bangkokDate(clip.updated_at) === bangkokDate(now)) continue;
      steps.push({ kind: "QUEUE", index, countsAsTry: false, reason: "เครดิตหมดเมื่อวาน สร้างต่อวันนี้" });
      continue;
    }
    // Failed or discarded: wait 2 minutes, then try again up to MAX_TAKE_ATTEMPTS.
    if (clip && now.getTime() - Date.parse(clip.updated_at) < RETRY_WAIT_MS) continue;
    if (t.attempts >= MAX_TAKE_ATTEMPTS) {
      steps.push({ kind: "FAIL", reason: `${takeLabel(t)} สร้างไม่สำเร็จ ${t.attempts} ครั้ง (${failureLabel(clip?.error) || clip?.status || "ไม่พบคลิป"})` });
      return { steps };
    }
    steps.push({ kind: "QUEUE", index, countsAsTry: true, reason: clip?.error ?? undefined });
  }
  return { steps };
}

export function takeLabel(take: Pick<PresenterTake, "role" | "key">) {
  if (take.role === "FACE") return "หน้า";
  const n = take.key.split("-")[1] ?? "";
  return take.role === "TALK" ? `คลิปพูด ${n}` : `คลิปนิ่ง ${n}`;
}

async function checkTake(admin: SupabaseClient, storagePath: string, needsVoice: boolean) {
  const file = await admin.storage.from(BUCKET).download(storagePath);
  if (file.error || !file.data) return { ok: false as const, reason: "ไม่พบไฟล์วิดีโอ" };
  const { checkPresenterTake } = await import("@/features/drama/media");
  return checkPresenterTake(new Uint8Array(await file.data.arrayBuffer()), needsVoice);
}
async function discardClip(admin: SupabaseClient, owner: string, clipId: string | null, storagePath: string, reason: string, now: Date) {
  await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  if (!clipId) return;
  await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, error: `ตรวจไม่ผ่าน: ${reason}`.slice(0, 300), file_deleted_at: now.toISOString(),
    updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", clipId).in("status", ["READY", "SCHEDULED"]);
}

async function saveFace(admin: SupabaseClient, owner: string, presenterId: string, storagePath: string) {
  const file = await admin.storage.from(BUCKET).download(storagePath);
  if (file.error || !file.data) throw new Error("FACE_VIDEO_MISSING");
  const { lastFrameJpeg } = await import("@/features/drama/media");
  const frame = await lastFrameJpeg(new Uint8Array(await file.data.arrayBuffer()));
  const path = faceStillPath(owner, presenterId);
  const upload = await admin.storage.from(BUCKET).upload(path, frame, { contentType: "image/jpeg", upsert: true });
  if (upload.error) throw new Error("FACE_NOT_SAVED");
  return path;
}

async function loadPresenter(admin: SupabaseClient, owner: string, id: string) {
  const row = check(await admin.from("ai_live_presenters").select(COLUMNS).eq("owner_id", owner).eq("id", id).maybeSingle(), "presenters_unavailable");
  if (!row) throw new Error("PRESENTER_NOT_FOUND");
  return row as PresenterRow;
}
async function lock(admin: SupabaseClient, owner: string, presenter: PresenterRow, now: Date) {
  const rows = check(await admin.from("ai_live_presenters").update({ updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", presenter.id)
    .eq("status", presenter.status).lt("updated_at", new Date(now.getTime() - LOCK_MS).toISOString()).select("id"), "presenters_unavailable") as unknown[] | null;
  return Boolean(rows?.length);
}
async function save(admin: SupabaseClient, owner: string, id: string, patch: Record<string, unknown>) {
  check(await admin.from("ai_live_presenters").update(patch).eq("owner_id", owner).eq("id", id), "presenter_not_saved");
}
