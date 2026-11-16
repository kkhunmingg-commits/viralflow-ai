import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pictureType, readStateFile, saveStateFile } from "@/features/flow-farm/service";
import { FACE_PICTURE_MARK } from "./marks";
import {
  characterStatus, decideFaces, emptyGirlState, facePrompt, MAX_FACE_ATTEMPTS, MAX_FACES_SHOWN, newCandidate, planGirlClips, type FaceCandidate, type GirlCharacter,
  type GirlGuide, type GirlState,
} from "./plan";

/**
 * The "สาวไทย AI" channel: one small state file per owner (no migration), face candidates made as Flow clips of kind
 * PRESENTER_CLIP (kept out of the clip library), and the chosen face attached to every new warm-up clip.
 */
const BUCKET = "video-assets";
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
function statePath(owner: string) {
  if (!isUuid(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/channel-girl.json`;
}
function stillPath(owner: string, characterId: string, key: string) {
  if (!isUuid(owner) || !isUuid(characterId) || !/^face-\d+$/.test(key)) throw new Error("INVALID_FACE_PATH");
  return `owner/${owner}/channel-girl/${characterId}/${key}.jpg`;
}

export async function readGirl(admin: SupabaseClient, owner: string): Promise<GirlState> {
  const file = await readStateFile<GirlState>(admin, statePath(owner)).catch(() => null);
  return file?.version === 1 ? { ...emptyGirlState(), ...file } : emptyGirlState();
}
async function saveGirl(admin: SupabaseClient, owner: string, state: GirlState) {
  await saveStateFile(admin, statePath(owner), state, "girl_not_saved");
}

/** The picture every new warm-up clip attaches, once the owner picked a face. */
export async function readyCharacter(admin: SupabaseClient, owner: string) {
  const { character } = await readGirl(admin, owner);
  return character?.status === "READY" && character.facePath ? { name: character.name, facePath: character.facePath } : null;
}

async function firstAccount(admin: SupabaseClient, owner: string) {
  const result = await admin.from("tiktok_accounts").select("id,is_mock,authorization_status").eq("owner_id", owner).is("hidden_at", null).order("created_at");
  const accounts = (result.data ?? []) as Array<{ id: string; is_mock: boolean | null; authorization_status: string | null }>;
  const account = accounts.find(a => !a.is_mock && a.authorization_status === "authorized") ?? accounts[0];
  if (!account) throw new Error("account_not_found");
  return account.id;
}

/**
 * One id per face try. The worker's poll and its "clip done" call both run this tick at the same moment, and with random
 * ids both queued a new take for the same face (16 Nov: two takes, 20 credits, for one face). The same id for the same
 * try makes the second insert a no-op.
 */
async function faceClipId(characterId: string, key: string, attempt: number) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`channel-girl:${characterId}:${key}:${attempt}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function queueFace(admin: SupabaseClient, owner: string, character: GirlCharacter, candidate: FaceCandidate, index: number, now: Date) {
  const clipId = await faceClipId(character.id, candidate.key, candidate.attempts + 1);
  const insert = await admin.from("flow_clips").insert({
    id: clipId, owner_id: owner, tiktok_account_id: await firstAccount(admin, owner), batch_id: character.id, product_id: null, kind: "PRESENTER_CLIP",
    created_at: new Date(now.getTime() + index).toISOString(),
    title: `สาว AI ${character.name} ${FACE_PICTURE_MARK} แบบที่ ${index + 1}`.slice(0, 200), prompt: facePrompt(character.look, index, candidate.attempts).slice(0, 12000),
    caption: `สาว AI ${character.name}`.slice(0, 2200), hashtags: [], reference_image_path: null,
  });
  // 23505: this very try was already queued by a tick running at the same time.
  if (insert.error && insert.error.code !== "23505") throw new Error("flow_clips_not_queued");
  return { ...candidate, clipId, attempts: candidate.attempts + 1, status: "QUEUED" as const, error: null };
}

/**
 * One new candidate face (10 credits; 16 Nov owner: "make one at a time, press again if I don't like it"). Earlier
 * faces stay on the page to pick from, and a face already picked keeps being used until another is picked.
 */
export async function addFace(admin: SupabaseClient, owner: string, input: { name: string; look: string }, now = new Date()) {
  await import("@/features/flow-farm/service").then(m => m.shareFlowAccounts(admin, owner)).catch(() => {});
  const state = await readGirl(admin, owner);
  if (state.character?.candidates.some(c => c.status === "QUEUED")) throw new Error("FACE_IN_PROGRESS");
  const base: GirlCharacter = state.character ?? {
    id: crypto.randomUUID(), name: input.name, look: input.look, status: "FACES", candidates: [], facePath: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  const character: GirlCharacter = { ...base, name: input.name, look: input.look };
  const index = character.candidates.length ? Math.max(...character.candidates.map(c => Number(c.key.split("-")[1]) || 0)) : 0;
  const queued = await queueFace(admin, owner, character, newCandidate(index), index, now);
  const candidates = [...character.candidates, queued];
  await saveGirl(admin, owner, { ...state, character: { ...character, candidates, status: characterStatus(candidates, character.facePath), updatedAt: now.toISOString() } });
}

/** Renames the girl without making a new face. */
export async function renameGirl(admin: SupabaseClient, owner: string, name: string) {
  const state = await readGirl(admin, owner);
  if (!state.character) throw new Error("FACE_NOT_FOUND");
  await saveGirl(admin, owner, { ...state, character: { ...state.character, name } });
}

/**
 * Called on the Flow worker's minute poll: keeps finished faces (as a still), retries failed ones, and keeps any face
 * take that finished after a newer try was queued for it (it cost credits too, so it becomes one more face to pick).
 */
export async function tickGirl(admin: SupabaseClient, owner: string, now = new Date()) {
  const state = await readGirl(admin, owner);
  const character = state.character;
  if (!character) return;
  const known = new Set(character.candidates.map(c => c.clipId).filter((v): v is string => Boolean(v)));
  const result = await admin.from("flow_clips").select("id,status,error,storage_path,updated_at").eq("owner_id", owner).eq("batch_id", character.id)
    .eq("kind", "PRESENTER_CLIP").order("created_at");
  if (result.error) return;
  const rows = (result.data ?? []) as Array<{ id: string; status: string; error: string | null; storage_path: string | null; updated_at: string | null }>;
  const clips = new Map(rows.map(c => [c.id, c]));
  const orphans = rows.filter(c => !known.has(c.id) && c.status === "READY" && c.storage_path);
  if (!orphans.length && !character.candidates.some(c => c.status === "QUEUED")) return;
  const candidates = [...character.candidates];
  const added: FaceCandidate[] = [];
  let changed = false;
  const touched = new Set<string>();
  for (const step of decideFaces(candidates, clips, now.getTime())) {
    const candidate = candidates[step.index];
    changed = true;
    touched.add(candidate.key);
    if (step.kind === "GIVE_UP") { candidates[step.index] = { ...candidate, status: "FAILED", error: step.reason.slice(0, 200) }; continue; }
    if (step.kind === "QUEUE") { candidates[step.index] = await queueFace(admin, owner, character, candidate, step.index, now); continue; }
    try {
      const path = await keepFace(admin, owner, character.id, candidate.key, candidate.clipId!, step.storagePath, now);
      candidates[step.index] = { ...candidate, status: "DONE", stillPath: path, error: null };
    } catch {
      candidates[step.index] = { ...candidate, status: candidate.attempts >= MAX_FACE_ATTEMPTS ? "FAILED" : "QUEUED", clipId: candidate.attempts >= MAX_FACE_ATTEMPTS ? candidate.clipId : null,
        error: "ดึงภาพหน้าจากคลิปไม่ได้" };
    }
  }
  let next = Math.max(0, ...candidates.map(c => Number(c.key.split("-")[1]) || 0));
  for (const orphan of orphans) {
    const key = `face-${++next}`;
    try {
      const path = await keepFace(admin, owner, character.id, key, orphan.id, orphan.storage_path!, now);
      added.push({ key, clipId: orphan.id, attempts: 1, status: "DONE", stillPath: path, error: null });
      changed = true;
    } catch { /* tried again on the next poll */ }
  }
  if (!changed) return;
  // Re-read just before saving: the owner may have replaced or picked meanwhile.
  const latest = await readGirl(admin, owner);
  if (latest.character?.id !== character.id) return;
  // Keep any face the owner added meanwhile; only the ones this tick looked at are replaced.
  const byKey = new Map(candidates.filter(c => touched.has(c.key)).map(c => [c.key, c]));
  const taken = new Set(latest.character.candidates.map(c => c.key));
  const merged = [...latest.character.candidates.map(c => byKey.get(c.key) ?? c), ...added.filter(c => !taken.has(c.key))];
  await saveGirl(admin, owner, { ...latest, character: { ...latest.character, candidates: merged,
    status: characterStatus(merged, latest.character.facePath), updatedAt: now.toISOString() } });
}

/** The take's last frame becomes the face picture; the take itself is not a post, so only the picture is kept. */
async function keepFace(admin: SupabaseClient, owner: string, characterId: string, key: string, clipId: string, storagePath: string, now: Date) {
  const path = await saveStill(admin, owner, characterId, key, storagePath);
  await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, file_deleted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", clipId);
  return path;
}

async function saveStill(admin: SupabaseClient, owner: string, characterId: string, key: string, storagePath: string) {
  const file = await admin.storage.from(BUCKET).download(storagePath);
  if (file.error || !file.data) throw new Error("FACE_VIDEO_MISSING");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  // A picture from Flow's image mode is the face as it is; an older worker's video gives its last frame.
  const type = pictureType(bytes);
  const frame = type ? bytes : await import("@/features/drama/media").then(m => m.lastFrameJpeg(bytes));
  const path = stillPath(owner, characterId, key);
  const upload = await admin.storage.from(BUCKET).upload(path, frame, { contentType: type ?? "image/jpeg", upsert: true });
  if (upload.error) throw new Error("FACE_NOT_SAVED");
  return path;
}

/** The owner picks one face: from now on every warm-up clip is this girl. */
export async function pickFace(admin: SupabaseClient, owner: string, key: string, now = new Date()) {
  const state = await readGirl(admin, owner);
  const character = state.character;
  const candidate = character?.candidates.find(c => c.key === key && c.status === "DONE" && c.stillPath);
  if (!character || !candidate) throw new Error("FACE_NOT_FOUND");
  await saveGirl(admin, owner, { ...state, character: { ...character, status: "READY", facePath: candidate.stillPath, updatedAt: now.toISOString() } });
}

/** The owner removes a face they do not want (16 Nov). The face in use and one still being made stay. */
export async function deleteFace(admin: SupabaseClient, owner: string, key: string, now = new Date()) {
  const state = await readGirl(admin, owner);
  const character = state.character;
  const candidate = character?.candidates.find(c => c.key === key && (c.status === "DONE" || c.status === "FAILED"));
  if (!character || !candidate) throw new Error("FACE_NOT_FOUND");
  if (candidate.stillPath && candidate.stillPath === character.facePath) throw new Error("FACE_IN_USE");
  if (candidate.stillPath) await admin.storage.from(BUCKET).remove([candidate.stillPath]).catch(() => {});
  const candidates = character.candidates.map(c => c.key === key ? { ...c, status: "DELETED" as const, stillPath: null } : c);
  await saveGirl(admin, owner, { ...state, character: { ...character, candidates, status: characterStatus(candidates, character.facePath), updatedAt: now.toISOString() } });
}

/** Signed links for the page: every candidate still and the chosen face. */
export async function faceLinks(admin: SupabaseClient, character: GirlCharacter | null) {
  const shown = (character?.candidates ?? []).filter(c => c.status === "DONE").slice(-MAX_FACES_SHOWN);
  const paths = [...new Set([...shown.map(c => c.stillPath), character?.facePath ?? null].filter((p): p is string => Boolean(p)))];
  const links: Record<string, string> = {};
  if (!paths.length) return links;
  const signed = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
  for (const item of signed.data ?? []) if (item.path && item.signedUrl) links[item.path] = item.signedUrl;
  return links;
}

/**
 * "โละของเก่า" (16 Nov, owner): old warm-up and product clips leave the queue and library, and the learning loop
 * starts over. Nothing is erased: the clip ids and the old stats file are saved to a backup file first, so it can
 * be undone, and posted clips stay posted on TikTok.
 */
export async function resetOldClips(admin: SupabaseClient, owner: string, now = new Date()) {
  const old = await admin.from("flow_clips").select("id,status").eq("owner_id", owner).in("kind", ["GROWTH", "AFFILIATE"])
    .in("status", ["QUEUED", "READY", "SCHEDULED"]).lt("created_at", now.toISOString()).limit(2000);
  if (old.error) throw new Error("flow_clips_unavailable");
  const rows = (old.data ?? []) as Array<{ id: string; status: string }>;
  const { backupAndClearStats } = await import("@/features/flow-farm/learning-store");
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const statsBackup = await backupAndClearStats(admin, owner, stamp);
  // The state bucket takes files up to 64 KB: ids are saved 1,000 to a file.
  for (let i = 0, part = 1; i < Math.max(rows.length, 1); i += 1000, part++) {
    await saveStateFile(admin, `owner/${owner}/clip-reset-${stamp}-${part}.json`,
      { at: now.toISOString(), statsBackup, status: rows.slice(i, i + 1000).map(r => `${r.id}:${r.status}`) }, "reset_backup_not_saved");
  }
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map(r => r.id);
    const update = await admin.from("flow_clips").update({ status: "DISCARDED", error: "ล้างระบบคลิปเดิม", updated_at: now.toISOString() })
      .eq("owner_id", owner).in("id", ids).in("status", ["QUEUED", "READY", "SCHEDULED"]);
    if (update.error) throw new Error("flow_clips_unavailable");
  }
  const state = await readGirl(admin, owner);
  await saveGirl(admin, owner, { ...state, resetAt: now.toISOString() });
  return { clips: rows.length };
}

/**
 * The next `count` clips of the girl for one channel, continuing the current story arc; the arc and the titles made
 * are saved so tomorrow picks up where today stopped. Null when no face is picked yet.
 */
export async function planGirlBatch(admin: SupabaseClient, owner: string, count: number, guide?: GirlGuide) {
  const state = await readGirl(admin, owner);
  const character = state.character;
  if (!character?.facePath || character.status !== "READY") return null;
  const plan = planGirlClips(count, character.name, { guide, arc: state.arc, made: state.made });
  await saveGirl(admin, owner, { ...state, arc: plan.arc, made: plan.made });
  return plan.clips.map(clip => ({ kind: "GROWTH" as const, productId: null, title: clip.title, prompt: clip.prompt, caption: clip.caption,
    hashtags: clip.hashtags, referenceImagePath: character.facePath }));
}
