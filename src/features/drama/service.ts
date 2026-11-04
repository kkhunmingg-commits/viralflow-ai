import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { MAX_ASSEMBLE_ATTEMPTS, MAX_SHOT_ATTEMPTS, emptyStoryState, type DramaGenre, type EpisodeStatus, type SeriesBible, type SeriesStatus,
  type StoryState } from "./contracts";
import { ASSEMBLY_STALE_MS, episodeShotsFinished, mayStartEpisode, nextBangkokMorning, nextShotToQueue, promptFor, referencePath, shotOutcome,
  type ShotRow } from "./engine";
import { SHOWRUNNER_WRITER, createBible, planEpisode } from "./showrunner";

const BUCKET = "video-assets";
const SERIES_COLUMNS = "id,tiktok_account_id,genre,title,logline,status,total_episodes,shots_per_episode,episodes_per_day,bible,story_state,writer,key_still_path,next_episode_number,created_at,updated_at";
const EPISODE_COLUMNS = "id,series_id,number,phase,title,summary,cliffhanger,caption,hashtags,status,state_after,started_on,flow_clip_id,assemble_attempts,error,ready_at,created_at,updated_at";
const SHOT_COLUMNS = "id,series_id,episode_id,position,prompt,subtitle,reference_mode,status,flow_clip_id,attempts,retry_after,last_frame_path,video_path,duration_seconds,error,created_at,updated_at";

export interface SeriesRow {
  id: string; tiktok_account_id: string; genre: DramaGenre; title: string; logline: string; status: SeriesStatus; total_episodes: number;
  shots_per_episode: number; episodes_per_day: number; bible: SeriesBible; story_state: StoryState; writer: string; key_still_path: string | null;
  next_episode_number: number; created_at: string; updated_at: string;
}
export interface EpisodeRow {
  id: string; series_id: string; number: number; phase: string; title: string; summary: string; cliffhanger: string; caption: string; hashtags: string[];
  status: EpisodeStatus; state_after: StoryState; started_on: string; flow_clip_id: string | null; assemble_attempts: number; error: string | null;
  ready_at: string | null; created_at: string; updated_at: string;
}
export type DramaShotRow = ShotRow & { series_id: string; created_at: string; updated_at: string };

function check<T>(result: { data: T; error: { message: string; code?: string } | null }, code: string): T {
  if (result.error) throw new Error(code);
  return result.data;
}
const ownerPath = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}`;
};
const framePath = (owner: string, seriesId: string, shotId: string) => `${ownerPath(owner)}/drama/${seriesId}/${shotId}.jpg`;
const episodeVideoPath = (owner: string, clipId: string) => `${ownerPath(owner)}/flow-clips/${clipId}.mp4`;

/** False until the Drama Studio migration is applied, so the page can say so instead of failing. */
export async function dramaAvailable(client: SupabaseClient) {
  const result = await client.from("drama_series").select("id", { head: true, count: "exact" }).limit(1);
  return !result.error;
}

// ---------------------------------------------------------------- Owner actions

export async function createSeries(admin: SupabaseClient, owner: string, input: { tiktokAccountId: string; genre: DramaGenre; totalEpisodes: number;
  shotsPerEpisode: number; episodesPerDay: number }, now = new Date()) {
  const account = check(await admin.from("tiktok_accounts").select("id").eq("owner_id", owner).eq("id", input.tiktokAccountId).is("hidden_at", null).maybeSingle(),
    "accounts_unavailable");
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  // The built-in writer has one story per genre: a second running series of the same genre would repeat it.
  const sameGenre = check(await admin.from("drama_series").select("id").eq("owner_id", owner).eq("genre", input.genre).in("status", ["ACTIVE", "PAUSED"]),
    "drama_unavailable") as Array<{ id: string }>;
  if (sameGenre.length) throw new Error("GENRE_ALREADY_RUNNING");
  const bible = createBible(input.genre, input.totalEpisodes);
  const row = check(await admin.from("drama_series").insert({
    owner_id: owner, tiktok_account_id: input.tiktokAccountId, genre: input.genre, title: bible.title, logline: bible.logline,
    total_episodes: input.totalEpisodes, shots_per_episode: input.shotsPerEpisode, episodes_per_day: input.episodesPerDay,
    bible, story_state: emptyStoryState(), writer: SHOWRUNNER_WRITER,
  }).select("id").single(), "series_not_created") as { id: string };
  await tickSeriesById(admin, owner, row.id, now).catch(() => {});
  return row.id;
}

export async function setSeriesStatus(admin: SupabaseClient, owner: string, id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  const series = await loadSeries(admin, owner, id);
  if (series.status === "COMPLETED" && status !== "ARCHIVED") throw new Error("SERIES_COMPLETED");
  check(await admin.from("drama_series").update({ status, updated_at: new Date().toISOString() }).eq("owner_id", owner).eq("id", id), "series_not_saved");
  if (status === "ACTIVE") await tickSeriesById(admin, owner, id).catch(() => {});
}

/** Owner: try a failed shot again (or the cut, when every shot is done). */
export async function retryEpisode(admin: SupabaseClient, owner: string, seriesId: string) {
  const series = await loadSeries(admin, owner, seriesId);
  const episode = await openEpisode(admin, owner, series.id);
  if (!episode) throw new Error("NO_OPEN_EPISODE");
  const now = new Date().toISOString();
  check(await admin.from("drama_shots").update({ status: "PLANNED", attempts: 0, retry_after: null, error: null, flow_clip_id: null, updated_at: now })
    .eq("owner_id", owner).eq("episode_id", episode.id).eq("status", "FAILED"), "shot_not_saved");
  check(await admin.from("drama_episodes").update({ status: "PRODUCING", error: null, assemble_attempts: 0, updated_at: now })
    .eq("owner_id", owner).eq("id", episode.id), "episode_not_saved");
  await tickSeries(admin, owner, series).catch(() => {});
}

/** Owner: leave a shot out of the episode (it keeps failing, e.g. content policy) and carry on with the next one. */
export async function skipShot(admin: SupabaseClient, owner: string, seriesId: string, shotId: string) {
  const series = await loadSeries(admin, owner, seriesId);
  const rows = check(await admin.from("drama_shots").update({ status: "SKIPPED", updated_at: new Date().toISOString() })
    .eq("owner_id", owner).eq("series_id", series.id).eq("id", shotId).in("status", ["FAILED", "PLANNED"]).select("episode_id"), "shot_not_saved") as Array<{ episode_id: string }>;
  if (!rows.length) throw new Error("SHOT_NOT_SKIPPABLE");
  check(await admin.from("drama_episodes").update({ status: "PRODUCING", error: null, updated_at: new Date().toISOString() })
    .eq("owner_id", owner).eq("id", rows[0].episode_id).eq("status", "FAILED"), "episode_not_saved");
  await tickSeries(admin, owner, series).catch(() => {});
}

// ---------------------------------------------------------------- Reads for the pages

export async function listSeries(client: SupabaseClient, owner: string) {
  const series = check(await client.from("drama_series").select(SERIES_COLUMNS).eq("owner_id", owner).neq("status", "ARCHIVED")
    .order("created_at", { ascending: true }), "drama_unavailable") as SeriesRow[];
  if (!series.length) return [];
  const ids = series.map(s => s.id);
  const [episodes, shots] = await Promise.all([
    client.from("drama_episodes").select("id,series_id,number,title,status,error,ready_at,started_on").eq("owner_id", owner).in("series_id", ids).order("number", { ascending: false }).limit(400),
    client.from("drama_shots").select("series_id,episode_id,position,status").eq("owner_id", owner).in("series_id", ids).in("status", ["PLANNED", "QUEUED", "DONE", "FAILED", "SKIPPED"]).limit(2000),
  ]);
  const episodeRows = (check(episodes, "drama_unavailable") ?? []) as Array<Pick<EpisodeRow, "id" | "series_id" | "number" | "title" | "status" | "error" | "ready_at" | "started_on">>;
  const shotRows = (check(shots, "drama_unavailable") ?? []) as Array<{ series_id: string; episode_id: string; position: number; status: string }>;
  return series.map(s => {
    const own = episodeRows.filter(e => e.series_id === s.id);
    const current = own.find(e => e.status !== "READY") ?? null;
    const currentShots = current ? shotRows.filter(r => r.episode_id === current.id) : [];
    return { series: s, readyEpisodes: own.filter(e => e.status === "READY").length, current,
      shotsDone: currentShots.filter(r => r.status === "DONE" || r.status === "SKIPPED").length, shotsTotal: currentShots.length,
      queued: currentShots.some(r => r.status === "QUEUED"), latestReady: own.find(e => e.status === "READY") ?? null };
  });
}
export type SeriesSummary = Awaited<ReturnType<typeof listSeries>>[number];

export async function seriesDetail(client: SupabaseClient, owner: string, id: string) {
  const series = check(await client.from("drama_series").select(SERIES_COLUMNS).eq("owner_id", owner).eq("id", id).maybeSingle(), "drama_unavailable") as SeriesRow | null;
  if (!series) return null;
  const [episodes, shots] = await Promise.all([
    client.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", id).order("number", { ascending: true }),
    client.from("drama_shots").select(SHOT_COLUMNS).eq("owner_id", owner).eq("series_id", id).order("position", { ascending: true }),
  ]);
  return { series, episodes: (check(episodes, "drama_unavailable") ?? []) as EpisodeRow[], shots: (check(shots, "drama_unavailable") ?? []) as DramaShotRow[] };
}

// ---------------------------------------------------------------- Production loop (service role)

async function loadSeries(admin: SupabaseClient, owner: string, id: string) {
  const series = check(await admin.from("drama_series").select(SERIES_COLUMNS).eq("owner_id", owner).eq("id", id).maybeSingle(), "drama_unavailable") as SeriesRow | null;
  if (!series) throw new Error("SERIES_NOT_FOUND");
  return series;
}
async function openEpisode(admin: SupabaseClient, owner: string, seriesId: string) {
  const rows = check(await admin.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", seriesId)
    .in("status", ["PRODUCING", "ASSEMBLING", "FAILED"]).order("number", { ascending: true }).limit(1), "drama_unavailable") as EpisodeRow[];
  return rows[0] ?? null;
}
async function episodeShots(admin: SupabaseClient, owner: string, episodeId: string) {
  return check(await admin.from("drama_shots").select(SHOT_COLUMNS).eq("owner_id", owner).eq("episode_id", episodeId).order("position", { ascending: true }),
    "drama_unavailable") as DramaShotRow[];
}

/**
 * One step of every active series of the owner. Called each minute by the Flow worker's poll and after each finished
 * clip, so production needs nobody to press anything. Each step is idempotent and guarded by status updates.
 */
export async function tickOwner(admin: SupabaseClient, owner: string, now = new Date()) {
  const result = await admin.from("drama_series").select(SERIES_COLUMNS).eq("owner_id", owner).eq("status", "ACTIVE");
  if (result.error) return { series: 0 }; // migration not applied yet
  const series = (result.data ?? []) as SeriesRow[];
  for (const s of series) {
    try { await tickSeries(admin, owner, s, now); } catch { /* one series never stops the others */ }
  }
  return { series: series.length };
}
async function tickSeriesById(admin: SupabaseClient, owner: string, id: string, now = new Date()) {
  const series = await loadSeries(admin, owner, id);
  if (series.status === "ACTIVE") await tickSeries(admin, owner, series, now);
}

export async function tickSeries(admin: SupabaseClient, owner: string, series: SeriesRow, now = new Date()) {
  let episode: EpisodeRow | null = await openEpisode(admin, owner, series.id);
  if (!episode) {
    const today = bangkokDate(now);
    const started = await admin.from("drama_episodes").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("series_id", series.id).eq("started_on", today);
    if (started.error) throw new Error("drama_unavailable");
    const count = started.count ?? 0;
    if (series.next_episode_number > series.total_episodes) {
      await admin.from("drama_series").update({ status: "COMPLETED", updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id).eq("status", "ACTIVE");
      return;
    }
    if (!mayStartEpisode(series, count, 0)) return;
    episode = await startEpisode(admin, owner, series, now);
    if (!episode) return;
  }
  if (episode.status === "FAILED") return; // waits for the owner
  if (episode.status === "ASSEMBLING") {
    if (now.getTime() - new Date(episode.updated_at).getTime() < ASSEMBLY_STALE_MS) return;
    await admin.from("drama_episodes").update({ status: "PRODUCING", updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", episode.id).eq("status", "ASSEMBLING");
    episode = { ...episode, status: "PRODUCING" };
  }

  let shots = await episodeShots(admin, owner, episode.id);
  // 1. A queued shot whose Flow clip finished, failed or was skipped.
  const queued = shots.find(shot => shot.status === "QUEUED");
  if (queued) {
    const clip = queued.flow_clip_id ? check(await admin.from("flow_clips").select("id,status,storage_path,duration_seconds,error").eq("owner_id", owner)
      .eq("id", queued.flow_clip_id).maybeSingle(), "flow_clips_unavailable") as { id: string; status: string; storage_path: string | null; duration_seconds: number | null; error: string | null } | null : null;
    const outcome = shotOutcome(clip?.status ?? null, queued.attempts);
    if (outcome === "WAIT") return;
    if (outcome === "ABSORB" && clip?.storage_path) await absorbShot(admin, owner, series, episode, queued, clip as { id: string; storage_path: string; duration_seconds: number | null }, now);
    else if (outcome === "RETRY_TOMORROW") await updateShot(admin, owner, queued.id, "QUEUED", { status: "PLANNED", flow_clip_id: null, retry_after: nextBangkokMorning(now), error: "NO_CREDIT" }, now);
    else if (outcome === "GIVE_UP" || (outcome === "ABSORB" && !clip?.storage_path)) {
      await updateShot(admin, owner, queued.id, "QUEUED", { status: "FAILED", attempts: queued.attempts + 1, error: (clip?.error ?? "CLIP_MISSING").slice(0, 400) }, now);
      await admin.from("drama_episodes").update({ status: "FAILED", error: `ช็อต ${queued.position} สร้างไม่สำเร็จ ${MAX_SHOT_ATTEMPTS} ครั้ง`, updated_at: now.toISOString() })
        .eq("owner_id", owner).eq("id", episode.id).eq("status", "PRODUCING");
      return;
    } else await updateShot(admin, owner, queued.id, "QUEUED", { status: "PLANNED", flow_clip_id: null, attempts: queued.attempts + 1, error: (clip?.error ?? "CLIP_MISSING").slice(0, 400) }, now);
    shots = await episodeShots(admin, owner, episode.id);
    series = await loadSeries(admin, owner, series.id);
  }
  // 2. All shots made: cut the episode.
  if (episodeShotsFinished(shots)) return void await assemble(admin, owner, series, episode, shots, now);
  // 3. Otherwise queue the next shot.
  const next = nextShotToQueue(shots, now);
  if (next) await queueShot(admin, owner, series, episode, next, shots, now);
}

async function updateShot(admin: SupabaseClient, owner: string, id: string, from: string, patch: Record<string, unknown>, now: Date) {
  check(await admin.from("drama_shots").update({ ...patch, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", id).eq("status", from), "shot_not_saved");
}

async function startEpisode(admin: SupabaseClient, owner: string, series: SeriesRow, now: Date) {
  const number = series.next_episode_number;
  const plan = planEpisode({ bible: series.bible, state: series.story_state?.episode != null ? series.story_state : emptyStoryState(), number,
    shotsPerEpisode: series.shots_per_episode, seed: series.id });
  const inserted = await admin.from("drama_episodes").insert({
    owner_id: owner, series_id: series.id, number, phase: plan.phase, title: plan.title, summary: plan.summary, cliffhanger: plan.cliffhanger,
    caption: plan.caption, hashtags: plan.hashtags, status: "PRODUCING", state_after: plan.stateAfter, started_on: bangkokDate(now),
  }).select(EPISODE_COLUMNS).single();
  if (inserted.error) {
    if (inserted.error.code === "23505") return null; // another step started it a moment ago
    throw new Error("episode_not_created");
  }
  const episode = inserted.data as EpisodeRow;
  check(await admin.from("drama_shots").insert(plan.shots.map(shot => ({
    owner_id: owner, series_id: series.id, episode_id: episode.id, position: shot.position, prompt: shot.prompt, subtitle: shot.subtitle,
    reference_mode: shot.referenceMode, status: "PLANNED",
  }))), "shots_not_created");
  return episode;
}

async function queueShot(admin: SupabaseClient, owner: string, series: SeriesRow, episode: EpisodeRow, shot: DramaShotRow, shots: DramaShotRow[], now: Date) {
  // Claim the shot first; the unique index allows one queued shot per series, so a parallel step cannot queue twice.
  const claimed = await admin.from("drama_shots").update({ status: "QUEUED", retry_after: null, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", shot.id).eq("status", "PLANNED").select("id");
  if (claimed.error || !claimed.data?.length) return;
  const image = referencePath(shot, shots, series.key_still_path);
  const title = `ละคร ${series.title} EP.${episode.number} ช็อต ${shot.position}/${shots.length}`.slice(0, 200);
  const clip = await admin.from("flow_clips").insert({
    owner_id: owner, tiktok_account_id: series.tiktok_account_id, batch_id: episode.id, kind: "DRAMA_SHOT", title,
    prompt: promptFor(shot.prompt, image).slice(0, 12000), caption: title, hashtags: [], reference_image_path: image,
  }).select("id").single();
  if (clip.error || !clip.data) {
    await admin.from("drama_shots").update({ status: "PLANNED", updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", shot.id).eq("status", "QUEUED");
    throw new Error("shot_not_queued");
  }
  check(await admin.from("drama_shots").update({ flow_clip_id: clip.data.id, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", shot.id), "shot_not_saved");
}

async function absorbShot(admin: SupabaseClient, owner: string, series: SeriesRow, episode: EpisodeRow, shot: DramaShotRow,
  clip: { id: string; storage_path: string; duration_seconds: number | null }, now: Date) {
  const file = await admin.storage.from(BUCKET).download(clip.storage_path);
  if (file.error || !file.data) throw new Error("SHOT_VIDEO_MISSING");
  const { lastFrameJpeg } = await import("./media");
  const frame = await lastFrameJpeg(new Uint8Array(await file.data.arrayBuffer()));
  const path = framePath(owner, series.id, shot.id);
  const upload = await admin.storage.from(BUCKET).upload(path, frame, { contentType: "image/jpeg", upsert: true });
  if (upload.error) throw new Error("FRAME_NOT_SAVED");
  await updateShot(admin, owner, shot.id, "QUEUED", { status: "DONE", last_frame_path: path, video_path: clip.storage_path,
    duration_seconds: clip.duration_seconds, error: null }, now);
  // Episode 1's opening shot shows the whole cast: its last frame anchors every later episode.
  if (episode.number === 1 && shot.position === 1 && !series.key_still_path) {
    await admin.from("drama_series").update({ key_still_path: path, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id).is("key_still_path", null);
  }
}

async function assemble(admin: SupabaseClient, owner: string, series: SeriesRow, episode: EpisodeRow, shots: DramaShotRow[], now: Date) {
  const attempts = episode.assemble_attempts + 1;
  const claimed = await admin.from("drama_episodes").update({ status: "ASSEMBLING", assemble_attempts: attempts, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", episode.id).eq("status", "PRODUCING").select("id");
  if (claimed.error || !claimed.data?.length) return;
  const done = shots.filter(shot => shot.status === "DONE" && shot.video_path).toSorted((a, b) => a.position - b.position);
  const clipId = crypto.randomUUID(), path = episodeVideoPath(owner, clipId);
  try {
    const inputs = [];
    for (const shot of done) {
      const file = await admin.storage.from(BUCKET).download(shot.video_path as string);
      if (file.error || !file.data) throw new Error("SHOT_VIDEO_MISSING");
      inputs.push({ bytes: new Uint8Array(await file.data.arrayBuffer()), durationSeconds: Number(shot.duration_seconds ?? 8), subtitle: shot.subtitle });
    }
    const { assembleEpisode } = await import("./media");
    const video = await assembleEpisode({ shots: inputs, cut: { seriesTitle: series.title, episodeNumber: episode.number, totalEpisodes: series.total_episodes,
      episodeTitle: episode.title, finale: episode.number >= series.total_episodes } });
    const sha256 = createHash("sha256").update(video.bytes).digest("hex");
    const upload = await admin.storage.from(BUCKET).upload(path, video.bytes, { contentType: "video/mp4", upsert: true });
    if (upload.error) throw new Error("EPISODE_NOT_SAVED");
    const caption = episode.caption;
    check(await admin.from("flow_clips").insert({
      id: clipId, owner_id: owner, tiktok_account_id: series.tiktok_account_id, batch_id: episode.id, kind: "DRAMA",
      title: `${series.title} EP.${episode.number} ${episode.title}`.slice(0, 200), prompt: `Drama Studio episode ${episode.number} cut from ${done.length} Flow shots`,
      caption, hashtags: episode.hashtags ?? [], status: "READY", storage_path: path, video_sha256: sha256, video_bytes: video.bytes.length,
      duration_seconds: video.durationSeconds, width: video.width, height: video.height, ready_at: now.toISOString(),
    }), "episode_clip_not_saved");
    check(await admin.from("drama_episodes").update({ status: "READY", flow_clip_id: clipId, ready_at: now.toISOString(), error: null, updated_at: now.toISOString() })
      .eq("owner_id", owner).eq("id", episode.id), "episode_not_saved");
    const finished = episode.number >= series.total_episodes;
    check(await admin.from("drama_series").update({ story_state: episode.state_after, next_episode_number: episode.number + 1,
      ...(finished ? { status: "COMPLETED" } : {}), updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id), "series_not_saved");
    await cleanupShots(admin, owner, series, shots, now).catch(() => {});
  } catch (error) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    const reason = error instanceof Error ? error.message.slice(0, 300) : "ASSEMBLY_FAILED";
    await admin.from("drama_episodes").update({ status: attempts >= MAX_ASSEMBLE_ATTEMPTS ? "FAILED" : "PRODUCING", error: `ตัดต่อไม่สำเร็จ: ${reason}`, updated_at: now.toISOString() })
      .eq("owner_id", owner).eq("id", episode.id).eq("status", "ASSEMBLING");
  }
}

/** The cut episode holds everything now: shot MP4s and frames are deleted (the series key still stays). */
async function cleanupShots(admin: SupabaseClient, owner: string, series: SeriesRow, shots: DramaShotRow[], now: Date) {
  const keyStill = (await loadSeries(admin, owner, series.id)).key_still_path;
  const files = [...shots.map(s => s.video_path), ...shots.map(s => s.last_frame_path)].filter((p): p is string => Boolean(p) && p !== keyStill);
  if (files.length) await admin.storage.from(BUCKET).remove(files);
  const clipIds = shots.map(s => s.flow_clip_id).filter((id): id is string => Boolean(id));
  if (clipIds.length) await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, file_deleted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("kind", "DRAMA_SHOT").in("id", clipIds).in("status", ["READY", "SCHEDULED"]);
  const episodeId = shots[0]?.episode_id;
  if (!episodeId) return;
  await admin.from("drama_shots").update({ video_path: null, updated_at: now.toISOString() }).eq("owner_id", owner).eq("episode_id", episodeId);
  await admin.from("drama_shots").update({ last_frame_path: null }).eq("owner_id", owner).eq("episode_id", episodeId).neq("last_frame_path", keyStill ?? "");
}

/** A small signed link to the key still or an episode, for the series page. */
export async function signedImage(admin: SupabaseClient, path: string | null) {
  if (!path) return null;
  const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return signed.error ? null : signed.data.signedUrl;
}
