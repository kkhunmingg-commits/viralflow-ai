import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { MAX_ASSEMBLE_ATTEMPTS, emptyStoryState, type DramaGenre, type EpisodeStatus, type SeriesBible, type SeriesStatus,
  type ShotStatus, type StoryState } from "./contracts";
import { ASSEMBLY_STALE_MS, clipVerdict, episodeShotsFinished, mayStartEpisode, nextBangkokMorning, nextShotToQueue, pickRepairAccount, planRetry, promptFor, referencePath,
  repairAccounts, repairShotsLeft, isCreditReason, SET_ASIDE_MS, setAsideNow, type RepairAccountRow, type ShotRow } from "./engine";
import { flowLogins, readStateFile, saveStateFile } from "@/features/flow-farm/service";
import { SHOWRUNNER_WRITER, createBible, pickStory, planEpisode } from "./showrunner";

const BUCKET = "video-assets";
const SERIES_COLUMNS = "id,tiktok_account_id,genre,title,logline,status,total_episodes,shots_per_episode,episodes_per_day,bible,story_state,writer,key_still_path,next_episode_number,flow_account_id,repair_flow_account_id,previous_series_id,auto_next,redo_on,created_at,updated_at";
const EPISODE_COLUMNS = "id,series_id,number,phase,title,summary,cliffhanger,caption,hashtags,status,state_after,started_on,flow_clip_id,assemble_attempts,error,ready_at,review,reviewed_at,take,key_still_path,created_at,updated_at";
const SHOT_COLUMNS = "id,series_id,episode_id,position,prompt,subtitle,reference_mode,status,flow_clip_id,attempts,retry_after,last_frame_path,video_path,duration_seconds,error,route,created_at,updated_at";

export interface SeriesRow {
  id: string; tiktok_account_id: string; genre: DramaGenre; title: string; logline: string; status: SeriesStatus; total_episodes: number;
  shots_per_episode: number; episodes_per_day: number; bible: SeriesBible; story_state: StoryState; writer: string; key_still_path: string | null;
  next_episode_number: number; flow_account_id: string | null; repair_flow_account_id: string | null; previous_series_id: string | null;
  auto_next: boolean; redo_on: string | null; created_at: string; updated_at: string;
}
export interface EpisodeRow {
  id: string; series_id: string; number: number; phase: string; title: string; summary: string; cliffhanger: string; caption: string; hashtags: string[];
  status: EpisodeStatus; state_after: StoryState; started_on: string; flow_clip_id: string | null; assemble_attempts: number; error: string | null;
  ready_at: string | null; review: EpisodeReview; reviewed_at: string | null; take: number; key_still_path: string | null; created_at: string; updated_at: string;
}
export type EpisodeReview = "PENDING" | "APPROVED" | "REJECTED";
/** Takes of one episode kept for comparison; a remake past this many waits until the owner deletes one. */
export const MAX_TAKES = 10;
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

export interface NewSeries {
  tiktokAccountId: string; flowAccountId: string; repairFlowAccountId?: string; genre: DramaGenre; totalEpisodes: number; shotsPerEpisode: number;
  episodesPerDay: number;
}
/** The stories of this genre the owner already made, oldest first, so the next one is new. */
async function usedStories(admin: SupabaseClient, owner: string, genre: DramaGenre) {
  const rows = check(await admin.from("drama_series").select("bible").eq("owner_id", owner).eq("genre", genre).order("created_at", { ascending: true }),
    "drama_unavailable") as Array<{ bible: SeriesBible }>;
  return rows.map(row => row.bible?.premiseKey).filter((key): key is string => Boolean(key));
}

export async function createSeries(admin: SupabaseClient, owner: string, input: NewSeries, now = new Date(), previousSeriesId: string | null = null) {
  const account = check(await admin.from("tiktok_accounts").select("id").eq("owner_id", owner).eq("id", input.tiktokAccountId).is("hidden_at", null).maybeSingle(),
    "accounts_unavailable");
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  const ids = [input.flowAccountId, input.repairFlowAccountId].filter((id): id is string => Boolean(id));
  const google = check(await admin.from("flow_accounts").select("id,tiktok_account_id,active,purpose").eq("owner_id", owner).in("id", ids), "flow_accounts_unavailable") as
    Array<{ id: string; tiktok_account_id: string | null; active: boolean; purpose: string }>;
  const main = google.find(g => g.id === input.flowAccountId);
  if (!main?.active || main.purpose === "REPAIR") throw new Error("FLOW_ACCOUNT_NOT_FOUND");
  if (main.tiktok_account_id && main.tiktok_account_id !== input.tiktokAccountId) throw new Error("FLOW_ACCOUNT_OTHER_CHANNEL");
  if (input.repairFlowAccountId && !google.find(g => g.id === input.repairFlowAccountId)?.active) throw new Error("REPAIR_ACCOUNT_NOT_FOUND");
  const story = pickStory(input.genre, await usedStories(admin, owner, input.genre));
  const bible = createBible(input.genre, input.totalEpisodes, story);
  const inserted = await admin.from("drama_series").insert({
    owner_id: owner, tiktok_account_id: input.tiktokAccountId, genre: input.genre, title: bible.title, logline: bible.logline,
    total_episodes: input.totalEpisodes, shots_per_episode: input.shotsPerEpisode, episodes_per_day: input.episodesPerDay,
    bible, story_state: emptyStoryState(), writer: SHOWRUNNER_WRITER, flow_account_id: input.flowAccountId,
    repair_flow_account_id: input.repairFlowAccountId ?? null, previous_series_id: previousSeriesId,
  }).select("id").single();
  // One running story per Google account (unique index): its daily credits are one episode.
  if (inserted.error?.code === "23505") throw new Error("FLOW_ACCOUNT_BUSY");
  const row = check(inserted, "series_not_created") as { id: string };
  await tickSeriesById(admin, owner, row.id, now).catch(() => {});
  return row.id;
}

/** Owner, on a finished season's card: a new story of the same genre on the same accounts and settings. */
export async function startNextStory(admin: SupabaseClient, owner: string, seriesId: string, now = new Date()) {
  const series = await loadSeries(admin, owner, seriesId);
  if (series.status !== "COMPLETED") throw new Error("SERIES_NOT_FINISHED");
  if (!series.flow_account_id) throw new Error("FLOW_ACCOUNT_NOT_FOUND");
  const next = check(await admin.from("drama_series").select("id").eq("owner_id", owner).eq("previous_series_id", series.id).neq("status", "ARCHIVED").limit(1),
    "drama_unavailable") as Array<{ id: string }>;
  if (next.length) throw new Error("NEXT_STORY_EXISTS");
  return createSeries(admin, owner, { tiktokAccountId: series.tiktok_account_id, flowAccountId: series.flow_account_id,
    repairFlowAccountId: series.repair_flow_account_id ?? undefined, genre: series.genre, totalEpisodes: series.total_episodes,
    shotsPerEpisode: series.shots_per_episode, episodesPerDay: series.episodes_per_day }, now, series.id);
}

/**
 * Owner's review of a finished episode. Approved: the story moves on and the next episode starts on its day.
 * Not approved: the cut leaves the library and the same episode is shot again from tomorrow.
 */
/**
 * The owner's verdict on the episode waiting for review. "ผ่าน" picks this take. "ไม่ผ่าน" keeps the cut as a rejected
 * take for comparison and shoots a new take of the same episode from the next day.
 */
export async function reviewEpisode(admin: SupabaseClient, owner: string, seriesId: string, episodeId: string, approved: boolean, now = new Date()) {
  if (approved) return chooseTake(admin, owner, seriesId, episodeId, now);
  const series = await loadSeries(admin, owner, seriesId);
  const episode = check(await admin.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", series.id).eq("id", episodeId)
    .eq("status", "READY").eq("review", "PENDING").maybeSingle(), "drama_unavailable") as EpisodeRow | null;
  if (!episode) throw new Error("EPISODE_NOT_REVIEWABLE");
  const rejected = await admin.from("drama_episodes").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("series_id", series.id)
    .eq("number", episode.number).eq("review", "REJECTED");
  if (rejected.error) throw new Error("drama_unavailable");
  if ((rejected.count ?? 0) + 1 >= MAX_TAKES) throw new Error("TOO_MANY_TAKES");
  // Episode 1's key still (the faces of the season) goes with its take; the remake makes its own.
  const ownsStill = episode.number === 1 && series.key_still_path;
  const marked = check(await admin.from("drama_episodes").update({ review: "REJECTED", reviewed_at: now.toISOString(), updated_at: now.toISOString(),
    ...(ownsStill ? { key_still_path: series.key_still_path } : {}) }).eq("owner_id", owner).eq("id", episode.id).eq("review", "PENDING").select("id"), "episode_not_saved") as Array<{ id: string }>;
  if (!marked.length) throw new Error("EPISODE_NOT_REVIEWABLE");
  // A rejected take is only kept to compare its cut: its shot files can go now (episode 1's key still stays).
  await cleanupShots(admin, owner, series, await episodeShots(admin, owner, episode.id), now).catch(() => {});
  // The new take starts right away (the worker's next poll), not the next day.
  check(await admin.from("drama_series").update({ redo_on: null, ...(ownsStill ? { key_still_path: null } : {}), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", series.id), "series_not_saved");
  await tickSeriesById(admin, owner, series.id, now).catch(() => {});
  return { approved: false, finished: false };
}

/** Every finished take of the episode the series is on (rejected ones and the one waiting for review), oldest first. */
export async function episodeTakes(client: SupabaseClient, owner: string, seriesId: string, number: number) {
  return check(await client.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", seriesId).eq("number", number)
    .in("review", ["PENDING", "REJECTED"]).eq("status", "READY").order("take", { ascending: true }).order("created_at", { ascending: true }), "drama_unavailable") as EpisodeRow[];
}

/** Deletes one take: its cut in the library, its shots' files and, for episode 1, its key still. */
/** Removes an episode's cut from storage and the library. */
async function discardCut(admin: SupabaseClient, owner: string, clipId: string | null, now: Date) {
  if (!clipId) return;
  const clip = (await admin.from("flow_clips").select("id,storage_path").eq("owner_id", owner).eq("id", clipId).maybeSingle()).data as
    { id: string; storage_path: string | null } | null;
  if (clip?.storage_path) await admin.storage.from(BUCKET).remove([clip.storage_path]).catch(() => {});
  if (clip) await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, file_deleted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", clip.id).in("status", ["READY", "SCHEDULED"]);
}

async function deleteTake(admin: SupabaseClient, owner: string, episode: EpisodeRow, keepPath: string | null, now: Date) {
  await discardCut(admin, owner, episode.flow_clip_id, now);
  const shots = await episodeShots(admin, owner, episode.id);
  const files = [...shots.map(s => s.video_path), ...shots.map(s => s.last_frame_path), episode.key_still_path]
    .filter((p): p is string => Boolean(p) && p !== keepPath);
  if (files.length) await admin.storage.from(BUCKET).remove(files).catch(() => {});
  const shotClips = shots.map(s => s.flow_clip_id).filter((id): id is string => Boolean(id));
  if (shotClips.length) await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, file_deleted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("kind", "DRAMA_SHOT").in("id", shotClips).in("status", ["QUEUED", "READY", "SCHEDULED", "FAILED"]);
  check(await admin.from("drama_episodes").delete().eq("owner_id", owner).eq("id", episode.id), "episode_not_saved");
}

/**
 * The owner picks the take to keep, out of every take of the episode. It counts as approved, the story moves on from
 * it, and every other take of that episode is deleted, including a remake still being shot (unless a shot is in Flow
 * right now: then the owner waits for that shot).
 */
export async function chooseTake(admin: SupabaseClient, owner: string, seriesId: string, episodeId: string, now = new Date()) {
  const series = await loadSeries(admin, owner, seriesId);
  const chosen = check(await admin.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", series.id).eq("id", episodeId)
    .eq("status", "READY").in("review", ["PENDING", "REJECTED"]).maybeSingle(), "drama_unavailable") as EpisodeRow | null;
  if (!chosen || chosen.number !== series.next_episode_number) throw new Error("EPISODE_NOT_REVIEWABLE");
  const others = (check(await admin.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", series.id).eq("number", chosen.number)
    .neq("id", chosen.id), "drama_unavailable") as EpisodeRow[]).filter(e => e.review !== "APPROVED");
  const open = others.filter(e => e.status !== "READY");
  if (open.length) {
    const busy = await admin.from("drama_shots").select("id", { count: "exact", head: true }).eq("owner_id", owner).in("episode_id", open.map(e => e.id))
      .eq("status", "QUEUED");
    if (busy.error) throw new Error("drama_unavailable");
    if ((busy.count ?? 0) > 0) throw new Error("TAKE_IN_PRODUCTION");
  }
  // Episode 1: the chosen take's key still becomes the season's faces again.
  const keyStill = chosen.number === 1 ? (chosen.key_still_path ?? series.key_still_path) : series.key_still_path;
  // An open remake goes first, so the unique "one open take" slot is free before the chosen take leaves REJECTED.
  for (const take of [...open, ...others.filter(e => e.status === "READY")]) await deleteTake(admin, owner, take, keyStill, now);
  if (chosen.number === 1 && series.key_still_path && series.key_still_path !== keyStill) await admin.storage.from(BUCKET).remove([series.key_still_path]).catch(() => {});
  const marked = check(await admin.from("drama_episodes").update({ review: "APPROVED", reviewed_at: now.toISOString(), key_still_path: null, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", chosen.id).in("review", ["PENDING", "REJECTED"]).select("id"), "episode_not_saved") as Array<{ id: string }>;
  if (!marked.length) throw new Error("EPISODE_NOT_REVIEWABLE");
  const finished = chosen.number >= series.total_episodes;
  check(await admin.from("drama_series").update({ story_state: chosen.state_after, next_episode_number: chosen.number + 1, redo_on: null,
    ...(chosen.number === 1 ? { key_still_path: keyStill } : {}),
    ...(finished && series.status === "ACTIVE" ? { status: "COMPLETED" } : {}), updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id), "series_not_saved");
  await cleanupShots(admin, owner, series, await episodeShots(admin, owner, chosen.id), now).catch(() => {});
  await tickSeriesById(admin, owner, series.id, now).catch(() => {});
  return { approved: true, finished, deleted: others.length };
}

/** The owner throws one rejected take away without picking yet. */
export async function deleteRejectedTake(admin: SupabaseClient, owner: string, seriesId: string, episodeId: string, now = new Date()) {
  const series = await loadSeries(admin, owner, seriesId);
  const take = check(await admin.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("series_id", series.id).eq("id", episodeId)
    .eq("review", "REJECTED").maybeSingle(), "drama_unavailable") as EpisodeRow | null;
  if (!take) throw new Error("EPISODE_NOT_REVIEWABLE");
  await deleteTake(admin, owner, take, series.key_still_path, now);
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
  check(await admin.from("drama_shots").update({ status: "PLANNED", attempts: 0, route: "PRIMARY", retry_after: null, error: null, flow_clip_id: null, updated_at: now })
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

/**
 * Owner: make one shot of the episode being made (or waiting for review) again, without touching the others. A cut
 * already made from the old shot leaves the library; the episode is cut again once the new shot is in.
 */
export async function redoShot(admin: SupabaseClient, owner: string, seriesId: string, shotId: string, now = new Date()) {
  const series = await loadSeries(admin, owner, seriesId);
  const shot = check(await admin.from("drama_shots").select(SHOT_COLUMNS).eq("owner_id", owner).eq("series_id", series.id).eq("id", shotId).maybeSingle(),
    "drama_unavailable") as DramaShotRow | null;
  if (!shot || !["DONE", "FAILED", "SKIPPED"].includes(shot.status)) throw new Error("SHOT_NOT_REDOABLE");
  const episode = check(await admin.from("drama_episodes").select(EPISODE_COLUMNS).eq("owner_id", owner).eq("id", shot.episode_id).maybeSingle(),
    "drama_unavailable") as EpisodeRow | null;
  if (!episode || episode.review !== "PENDING" || episode.number !== series.next_episode_number || episode.status === "ASSEMBLING") throw new Error("SHOT_NOT_REDOABLE");
  // Re-cutting needs every other shot's file; takes cut before shot files were kept cannot be redone shot by shot.
  if ((await episodeShots(admin, owner, episode.id)).some(s => s.status === "DONE" && !s.video_path)) throw new Error("SHOT_FILES_GONE");
  const reset = check(await admin.from("drama_shots").update({ status: "PLANNED", attempts: 0, route: "PRIMARY", retry_after: null, error: null, flow_clip_id: null,
    video_path: null, duration_seconds: null, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", shot.id).eq("status", shot.status).select("id"), "shot_not_saved") as Array<{ id: string }>;
  if (!reset.length) throw new Error("SHOT_NOT_REDOABLE");
  // The old take's file goes; its last frame is overwritten by the new one (it may also be episode 1's key still).
  if (shot.video_path) await admin.storage.from(BUCKET).remove([shot.video_path]).catch(() => {});
  if (shot.flow_clip_id) await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, file_deleted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("kind", "DRAMA_SHOT").eq("id", shot.flow_clip_id).in("status", ["READY", "SCHEDULED"]);
  if (episode.status !== "PRODUCING") {
    if (episode.status === "READY") await discardCut(admin, owner, episode.flow_clip_id, now);
    check(await admin.from("drama_episodes").update({ status: "PRODUCING", flow_clip_id: null, ready_at: null, error: null, assemble_attempts: 0, updated_at: now.toISOString() })
      .eq("owner_id", owner).eq("id", episode.id).eq("status", episode.status), "episode_not_saved");
  }
  await tickSeriesById(admin, owner, series.id, now).catch(() => {});
}

/**
 * Owner: throw away the version being made (not cut yet) and start the episode again from shot 1 as a new version.
 * Waits while one of its shots is in Flow right now, so nothing already paid for is lost mid-generation.
 */
export async function remakeOpenTake(admin: SupabaseClient, owner: string, seriesId: string, now = new Date()) {
  const series = await loadSeries(admin, owner, seriesId);
  const episode = await openEpisode(admin, owner, series.id);
  if (!episode || episode.number !== series.next_episode_number || episode.status === "ASSEMBLING") throw new Error("NO_OPEN_EPISODE");
  const shots = await episodeShots(admin, owner, episode.id);
  if (shots.some(shot => shot.status === "QUEUED")) throw new Error("TAKE_IN_PRODUCTION");
  // Episode 1's key still came from this version's shot 1: the new version makes its own.
  const ownStill = episode.number === 1 && series.key_still_path && shots.some(shot => shot.last_frame_path === series.key_still_path) ? series.key_still_path : null;
  await deleteTake(admin, owner, episode, null, now);
  if (ownStill) check(await admin.from("drama_series").update({ key_still_path: null, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id), "series_not_saved");
  await tickSeriesById(admin, owner, series.id, now).catch(() => {});
}

/**
 * Owner: the episode is waiting for tomorrow's credits, but the owner knows an account has credits again (Flow renews
 * on its own clock). Clears "out of credits today" on the series' accounts and lets the waiting shot go now. If Flow
 * really is still out, the worker says so before clicking Generate, so this never costs credits by itself.
 */
export async function continueAfterCredits(admin: SupabaseClient, owner: string, seriesId: string, now = new Date()) {
  const series = await loadSeries(admin, owner, seriesId);
  const episode = await openEpisode(admin, owner, series.id);
  if (!episode) throw new Error("NO_OPEN_EPISODE");
  const waiting = check(await admin.from("drama_shots").update({ retry_after: null, route: "PRIMARY", updated_at: now.toISOString() }).eq("owner_id", owner)
    .eq("episode_id", episode.id).eq("status", "PLANNED").not("retry_after", "is", null).select("id"), "shot_not_saved") as Array<{ id: string }>;
  if (!waiting.length) throw new Error("NOTHING_WAITING_FOR_CREDITS");
  await clearSetAside(admin, owner);
  // Only the main account: if it is in fact still empty, the worker says so before Generate and the shot moves on to
  // the repair pool by itself. Pool accounts each have their own "เติมเครดิตแล้ว" button.
  const accounts = [series.flow_account_id].filter((id): id is string => Boolean(id));
  if (accounts.length) check(await admin.from("flow_accounts").update({ exhausted_on: null, updated_at: now.toISOString() }).eq("owner_id", owner).in("id", accounts),
    "flow_accounts_unavailable");
  await tickSeriesById(admin, owner, series.id, now).catch(() => {});
}

/** A short private link to one finished shot's MP4, for watching it before the episode is cut. */
export async function shotVideoUrl(admin: SupabaseClient, owner: string, shotId: string) {
  const shot = (await admin.from("drama_shots").select("video_path").eq("owner_id", owner).eq("id", shotId).maybeSingle()).data as { video_path: string | null } | null;
  if (!shot?.video_path) throw new Error("SHOT_VIDEO_MISSING");
  const signed = await admin.storage.from(BUCKET).createSignedUrl(shot.video_path, 600);
  if (signed.error || !signed.data) throw new Error("SHOT_VIDEO_MISSING");
  return signed.data.signedUrl;
}

// ---------------------------------------------------------------- Reads for the pages

export async function listSeries(client: SupabaseClient, owner: string) {
  const series = check(await client.from("drama_series").select(SERIES_COLUMNS).eq("owner_id", owner).neq("status", "ARCHIVED")
    .order("created_at", { ascending: true }), "drama_unavailable") as SeriesRow[];
  if (!series.length) return [];
  const ids = series.map(s => s.id);
  const [episodes, shots] = await Promise.all([
    client.from("drama_episodes").select("id,series_id,number,title,status,error,ready_at,started_on,review,flow_clip_id,take").eq("owner_id", owner).in("series_id", ids).order("number", { ascending: false }).limit(400),
    client.from("drama_shots").select("id,series_id,episode_id,position,status,route,flow_clip_id,video_path,retry_after").eq("owner_id", owner).in("series_id", ids).in("status", ["PLANNED", "QUEUED", "DONE", "FAILED", "SKIPPED"]).limit(2000),
  ]);
  const episodeRows = (check(episodes, "drama_unavailable") ?? []) as Array<Pick<EpisodeRow, "id" | "series_id" | "number" | "title" | "status" | "error" | "ready_at" | "started_on" | "review" | "flow_clip_id" | "take">>;
  const shotRows = (check(shots, "drama_unavailable") ?? []) as Array<{ id: string; series_id: string; episode_id: string; position: number; status: ShotStatus;
    route: string | null; flow_clip_id: string | null; video_path: string | null; retry_after: string | null }>;
  // A queued shot is either waiting in Flow's queue or being generated right now: the clip says which.
  const clipIds = shotRows.filter(r => r.status === "QUEUED" && r.flow_clip_id).map(r => r.flow_clip_id as string);
  const generating = new Set(clipIds.length ? ((await client.from("flow_clips").select("id,status").eq("owner_id", owner).in("id", clipIds)).data ?? [])
    .filter(c => c.status === "GENERATING").map(c => c.id as string) : []);
  return series.map(s => {
    const own = episodeRows.filter(e => e.series_id === s.id);
    const current = own.find(e => e.status !== "READY") ?? null;
    const toReview = own.find(e => e.status === "READY" && e.review === "PENDING") ?? null;
    // The shots shown on the card: the episode being made, else the cut waiting for review (each shot can be made again).
    const working = current ?? toReview;
    const currentShots = working ? shotRows.filter(r => r.episode_id === working.id) : [];
    return { series: s, readyEpisodes: own.filter(e => e.status === "READY" && e.review === "APPROVED").length, current,
      toReview, shotsOf: working, hasNextStory: series.some(n => n.previous_series_id === s.id),
      shotsDone: currentShots.filter(r => r.status === "DONE" || r.status === "SKIPPED").length, shotsTotal: currentShots.length,
      queued: currentShots.some(r => r.status === "QUEUED"),
      // Finished takes of the episode the series is on (rejected ones and the one to review), to compare side by side.
      takes: own.filter(e => e.number === s.next_episode_number && e.status === "READY" && e.review !== "APPROVED").toSorted((a, b) => a.take - b.take),
      shots: currentShots.toSorted((a, b) => a.position - b.position).map(r => ({ id: r.id, position: r.position, status: r.status, repair: r.route === "REPAIR",
        generating: Boolean(r.flow_clip_id && generating.has(r.flow_clip_id)), hasVideo: Boolean(r.video_path),
        waitingCredits: r.status === "PLANNED" && Boolean(r.retry_after) })),
      latestReady: own.find(e => e.status === "READY" && e.review === "APPROVED") ?? null };
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
    try { await tickSeries(admin, owner, s, now); } catch (error) { console.error("[drama] tick failed", s.id, error); /* one series never stops the others */ }
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
    // A rejected take does not use up the day: its remake may start the same day.
    const started = await admin.from("drama_episodes").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("series_id", series.id).eq("started_on", today)
      .neq("review", "REJECTED");
    if (started.error) throw new Error("drama_unavailable");
    const count = started.count ?? 0;
    if (series.next_episode_number > series.total_episodes) {
      await admin.from("drama_series").update({ status: "COMPLETED", updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id).eq("status", "ACTIVE");
      return;
    }
    const waiting = await admin.from("drama_episodes").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("series_id", series.id)
      .eq("status", "READY").eq("review", "PENDING");
    if (waiting.error) throw new Error("drama_unavailable");
    if ((waiting.count ?? 0) > 0) return; // the owner has not reviewed the last episode yet
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
  // 1. A queued shot whose Flow clip finished, failed or ran out of credits.
  const queued = shots.find(shot => shot.status === "QUEUED");
  if (queued) {
    const clip = queued.flow_clip_id ? check(await admin.from("flow_clips").select("id,status,storage_path,duration_seconds,error").eq("owner_id", owner)
      .eq("id", queued.flow_clip_id).maybeSingle(), "flow_clips_unavailable") as { id: string; status: string; storage_path: string | null; duration_seconds: number | null; error: string | null } | null : null;
    const verdict = clipVerdict(clip?.status ?? null);
    if (verdict === "WAIT") return;
    let broken: string | null = null;
    if (verdict === "CHECK") {
      try {
        broken = clip?.storage_path ? await absorbShot(admin, owner, series, episode, queued, clip as { id: string; storage_path: string; duration_seconds: number | null }, now) : "ไม่พบไฟล์วิดีโอ";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith("SHOT_CHECK_UNAVAILABLE")) throw error;
        // The server could not run its check: the take is kept as it is and checked again on the next round.
        console.error("[drama] shot check unavailable", message);
        await updateShot(admin, owner, queued.id, "QUEUED", { error: `เซิร์ฟเวอร์ยังตรวจช็อตนี้ไม่ได้ จะตรวจใหม่เอง ไม่เสียเครดิตเพิ่ม (${message})`.slice(0, 400) }, now);
        return;
      }
    }
    if (verdict === "BROKEN") broken = (clip?.error ?? "CLIP_MISSING").slice(0, 300);
    if (broken !== null || verdict === "NO_CREDIT") {
      const repair = await repairState(admin, owner, series, now);
      const plan = planRetry(queued, verdict === "NO_CREDIT" ? "NO_CREDIT" : "BROKEN", repair, now);
      await updateShot(admin, owner, queued.id, "QUEUED", { status: plan.status, route: plan.route, attempts: plan.attempts, retry_after: plan.retryAfter,
        flow_clip_id: plan.status === "FAILED" ? queued.flow_clip_id : null, error: verdict === "NO_CREDIT" ? "NO_CREDIT" : `${broken}`.slice(0, 400) }, now, queued.flow_clip_id);
      if (plan.status === "FAILED") {
        await admin.from("drama_episodes").update({ status: "FAILED", error: `ช็อต ${queued.position} ใช้ไม่ได้ ${plan.attempts} ครั้ง (${broken})`.slice(0, 480), updated_at: now.toISOString() })
          .eq("owner_id", owner).eq("id", episode.id).eq("status", "PRODUCING");
        return;
      }
    }
    shots = await episodeShots(admin, owner, episode.id);
    series = await loadSeries(admin, owner, series.id);
  }
  // 2. All shots made: cut the episode.
  if (episodeShotsFinished(shots)) return void await assemble(admin, owner, series, episode, shots, now);
  // 3. Otherwise queue the next shot.
  const next = nextShotToQueue(shots, now);
  if (next) await queueShot(admin, owner, series, episode, next, shots, now);
}

/**
 * The owner's repair accounts, as one shared pool for every series (Lucky, 7 Nov: five accounts = 25 repair shots).
 * Only accounts that are switched on, signed in on the worker, not reported empty by Flow today, and under their daily
 * allowance can take a shot.
 */
export async function repairPool(admin: SupabaseClient, owner: string, now = new Date()) {
  const rows = check(await admin.from("flow_accounts").select("id,label,active,exhausted_on,clips_today,clips_today_on,clips_per_day_estimate,priority,created_at")
    .eq("owner_id", owner).eq("purpose", "REPAIR"), "flow_accounts_unavailable") as RepairAccountRow[] | null;
  if (!rows?.length) return [];
  const logins = await flowLogins(admin, owner).catch(() => ({} as Awaited<ReturnType<typeof flowLogins>>));
  const aside = await accountsSetAside(admin, owner, now);
  return repairAccounts(rows, id => logins[id]?.state === "READY", bangkokDate(now), id => aside[id]?.reason ?? null);
}

type SetAside = Record<string, { until: string; reason: string }>;
const setAsidePath = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/drama-set-aside.json`;
};
/** Google accounts skipped for drama shots for a while because they could not start one (not a credit problem). */
export async function accountsSetAside(admin: SupabaseClient, owner: string, now = new Date()): Promise<SetAside> {
  return setAsideNow(await readStateFile<SetAside>(admin, setAsidePath(owner)).catch(() => null), now);
}
async function setAccountAside(admin: SupabaseClient, owner: string, id: string, reason: string, now: Date) {
  const aside = await accountsSetAside(admin, owner, now);
  aside[id] = { until: new Date(now.getTime() + SET_ASIDE_MS).toISOString(), reason: reason.slice(0, 120) };
  await saveStateFile(admin, setAsidePath(owner), aside, "set_aside_not_saved").catch(() => {});
}
async function clearSetAside(admin: SupabaseClient, owner: string) {
  await saveStateFile(admin, setAsidePath(owner), {}, "set_aside_not_saved").catch(() => {});
}

/** Whether the main account can take a shot now: switched on, not out of credits today, not set aside. */
async function mainUsable(admin: SupabaseClient, owner: string, mainId: string | null, now: Date) {
  if (!mainId) return false;
  const row = (await admin.from("flow_accounts").select("active,exhausted_on").eq("owner_id", owner).eq("id", mainId).maybeSingle()).data as
    { active: boolean; exhausted_on: string | null } | null;
  if (!row?.active || row.exhausted_on === bangkokDate(now)) return false;
  return !(await accountsSetAside(admin, owner, now))[mainId];
}

/** Whether the owner has any repair account in use, and whether every one of them is out of credits today. */
async function repairState(admin: SupabaseClient, owner: string, _series: SeriesRow, now: Date) {
  const pool = (await repairPool(admin, owner, now)).filter(a => a.active && a.loggedIn);
  return { exists: pool.length > 0, outOfCreditsToday: !pool.some(a => repairShotsLeft(a) > 0) };
}

/**
 * Moves a shot on only if it is still where this step saw it. `clip` pins the Flow clip too: two overlapping rounds
 * could otherwise both act on one result, and the late one would re-queue a shot the first had already sent to Flow,
 * paying for the same shot twice.
 */
async function updateShot(admin: SupabaseClient, owner: string, id: string, from: string, patch: Record<string, unknown>, now: Date, clip?: string | null) {
  let query = admin.from("drama_shots").update({ ...patch, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", id).eq("status", from);
  if (clip !== undefined) query = clip === null ? query.is("flow_clip_id", null) : query.eq("flow_clip_id", clip);
  check(await query, "shot_not_saved");
}

async function startEpisode(admin: SupabaseClient, owner: string, series: SeriesRow, now: Date) {
  const number = series.next_episode_number;
  const earlier = await admin.from("drama_episodes").select("take").eq("owner_id", owner).eq("series_id", series.id).eq("number", number)
    .order("take", { ascending: false }).limit(1);
  const take = ((earlier.data ?? [])[0]?.take as number | undefined ?? 0) + 1;
  const plan = planEpisode({ bible: series.bible, state: series.story_state?.episode != null ? series.story_state : emptyStoryState(), number,
    shotsPerEpisode: series.shots_per_episode, seed: series.id });
  const inserted = await admin.from("drama_episodes").insert({
    owner_id: owner, series_id: series.id, number, phase: plan.phase, title: plan.title, summary: plan.summary, cliffhanger: plan.cliffhanger,
    caption: plan.caption, hashtags: plan.hashtags, status: "PRODUCING", state_after: plan.stateAfter, started_on: bangkokDate(now), take,
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
  // The owner's rule: one version of an episode may spend at most 100 credits (10 Flow clips at 10 credits each).
  // Past that it stops and waits for the owner instead of spending more.
  const spent = await admin.from("flow_clips").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("batch_id", episode.id)
    .eq("kind", "DRAMA_SHOT").in("status", SPENDING_STATUSES);
  if (spent.error) throw new Error("flow_clips_unavailable");
  if ((spent.count ?? 0) * CREDITS_PER_SHOT >= TAKE_CREDIT_BUDGET) {
    await admin.from("drama_episodes").update({ status: "FAILED", updated_at: now.toISOString(),
      error: `เวอร์ชันนี้ใช้ครบ ${TAKE_CREDIT_BUDGET} เครดิตแล้ว (${spent.count} คลิป) แต่ยังไม่ครบทุกช็อต จึงหยุดไว้ก่อน ไม่ใช้เครดิตเพิ่ม` })
      .eq("owner_id", owner).eq("id", episode.id).eq("status", "PRODUCING");
    return;
  }
  // Claim the shot first; the unique index allows one queued shot per series, so a parallel step cannot queue twice.
  // Flow already said the main account is out of credits today: go straight to the repair account instead of
  // asking the main one again for every shot.
  if ((shot.route ?? "PRIMARY") === "PRIMARY" && !await mainUsable(admin, owner, series.flow_account_id, now)) {
    const repair = await repairState(admin, owner, series, now);
    if (repair.exists && !repair.outOfCreditsToday) shot = { ...shot, route: "REPAIR" };
  }
  // A repair shot goes to whichever pool account has the most shots left today.
  let account = series.flow_account_id;
  if (shot.route === "REPAIR") {
    const picked = pickRepairAccount(await repairPool(admin, owner, now));
    if (picked) account = picked.id;
    else if (!await mainUsable(admin, owner, series.flow_account_id, now)) {
      // Every account is out today: the shot waits for new credits instead of asking empty accounts again.
      await updateShot(admin, owner, shot.id, "PLANNED", { route: "PRIMARY", retry_after: nextBangkokMorning(now),
        error: "เครดิตหมดทั้งบัญชีหลักและบัญชีซ่อมทุกบัญชี รอเครดิตรอบใหม่" }, now, null);
      return;
    } else shot = { ...shot, route: "PRIMARY" };
  }
  const claimed = await admin.from("drama_shots").update({ status: "QUEUED", route: shot.route ?? "PRIMARY", retry_after: null, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", shot.id).eq("status", "PLANNED").is("flow_clip_id", null).select("id");
  if (claimed.error || !claimed.data?.length) return;
  const image = referencePath(shot, shots, series.key_still_path);
  const title = `ละคร ${series.title} EP.${episode.number} ช็อต ${shot.position}/${shots.length}${shot.route === "REPAIR" ? " (ซ่อม)" : ""}`.slice(0, 200);
  const clip = await admin.from("flow_clips").insert({
    owner_id: owner, tiktok_account_id: series.tiktok_account_id, batch_id: episode.id, kind: "DRAMA_SHOT", title,
    prompt: promptFor(shot.prompt, image).slice(0, 12000), caption: title, hashtags: [], reference_image_path: image,
    required_flow_account_id: account,
  }).select("id").single();
  if (clip.error || !clip.data) {
    await admin.from("drama_shots").update({ status: "PLANNED", updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", shot.id).eq("status", "QUEUED");
    throw new Error("shot_not_queued");
  }
  check(await admin.from("drama_shots").update({ flow_clip_id: clip.data.id, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", shot.id), "shot_not_saved");
}

/** Flow clips that reached Flow's Generate button and so may have cost credits (a refused-for-credit clip did not). */
const SPENDING_STATUSES = ["GENERATING", "READY", "SCHEDULED", "POSTED", "FAILED", "DISCARDED"];
const CREDITS_PER_SHOT = 10;
export const TAKE_CREDIT_BUDGET = 100;

/** Checks the finished take; a good one becomes part of the episode, a bad one is thrown away. Returns why it was bad. */
async function absorbShot(admin: SupabaseClient, owner: string, series: SeriesRow, episode: EpisodeRow, shot: DramaShotRow,
  clip: { id: string; storage_path: string; duration_seconds: number | null }, now: Date): Promise<string | null> {
  const file = await admin.storage.from(BUCKET).download(clip.storage_path);
  if (file.error || !file.data) return "ไม่พบไฟล์วิดีโอ";
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const { checkShot, lastFrameJpeg } = await import("./media");
  const verdict = await checkShot(bytes);
  if (!verdict.ok) {
    // Not kept: its file is removed and the clip leaves the queue's records as discarded.
    await admin.storage.from(BUCKET).remove([clip.storage_path]).catch(() => {});
    await admin.from("flow_clips").update({ status: "DISCARDED", storage_path: null, error: `ตรวจไม่ผ่าน: ${verdict.reason}`.slice(0, 300),
      file_deleted_at: now.toISOString(), updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", clip.id).in("status", ["READY", "SCHEDULED"]);
    return `ตรวจไม่ผ่าน: ${verdict.reason}`;
  }
  const frame = await lastFrameJpeg(bytes);
  const path = framePath(owner, series.id, shot.id);
  const upload = await admin.storage.from(BUCKET).upload(path, frame, { contentType: "image/jpeg", upsert: true });
  if (upload.error) throw new Error("FRAME_NOT_SAVED");
  await updateShot(admin, owner, shot.id, "QUEUED", { status: "DONE", last_frame_path: path, video_path: clip.storage_path,
    duration_seconds: clip.duration_seconds ?? verdict.durationSeconds, error: null }, now, clip.id);
  // Episode 1's opening shot shows the whole cast: its last frame anchors every later episode.
  if (episode.number === 1 && shot.position === 1 && !series.key_still_path) {
    await admin.from("drama_series").update({ key_still_path: path, updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", series.id).is("key_still_path", null);
  }
  return null;
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
      episodeTitle: episode.title, finale: episode.number >= series.total_episodes, speakers: series.bible.cast.map(c => c.name) } });
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
    // The story moves on only once the owner approves this cut (reviewEpisode).
    check(await admin.from("drama_episodes").update({ status: "READY", review: "PENDING", flow_clip_id: clipId, ready_at: now.toISOString(), error: null,
      updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", episode.id), "episode_not_saved");
    // Shot files stay until the owner approves this take, so one bad shot can be made again and the episode re-cut.
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

/**
 * The worker gave a drama shot back without pressing Generate (nothing was spent): no credits, no Generate button,
 * the picture box or prompt box missing, signed out, browser trouble... Whatever the reason, the shot moves on to the
 * next account by itself (Lucky, 7 Nov: "มันต้องย้ายเองออโต้"): the account that failed is marked out of credits for
 * today (credit reasons) or set aside for two hours (anything else), and the shot goes to the repair-pool account with
 * the most shots left, else back to the main account, else it waits; it never bounces between the same accounts.
 */
export async function fallBackToMainAccount(admin: SupabaseClient, owner: string, clipId: string, reason: string, now = new Date()) {
  if (reason === "DRY_RUN") return false;
  const shot = (await admin.from("drama_shots").select("id,episode_id,route,status").eq("owner_id", owner).eq("flow_clip_id", clipId).maybeSingle()).data as
    { id: string; episode_id: string; route: string; status: string } | null;
  if (!shot || shot.status !== "QUEUED") return false;
  const clip = (await admin.from("flow_clips").select("required_flow_account_id").eq("owner_id", owner).eq("id", clipId).eq("status", "QUEUED").maybeSingle()).data as
    { required_flow_account_id: string | null } | null;
  const failed = clip?.required_flow_account_id ?? null;
  if (!failed) return false;
  const episode = (await admin.from("drama_episodes").select("series_id").eq("owner_id", owner).eq("id", shot.episode_id).maybeSingle()).data as { series_id: string } | null;
  const series = episode ? (await admin.from("drama_series").select("flow_account_id").eq("owner_id", owner).eq("id", episode.series_id).maybeSingle()).data as
    { flow_account_id: string | null } | null : null;
  const main = series?.flow_account_id ?? null;
  const credit = isCreditReason(reason);
  if (credit) await admin.from("flow_accounts").update({ exhausted_on: bangkokDate(now), updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", failed);
  else await setAccountAside(admin, owner, failed, reason, now);

  const next = pickRepairAccount(await repairPool(admin, owner, now), [failed]);
  const target = next?.id ?? (main && main !== failed && await mainUsable(admin, owner, main, now) ? main : null);
  if (target) {
    check(await admin.from("flow_clips").update({ required_flow_account_id: target, error: null, updated_at: now.toISOString() })
      .eq("owner_id", owner).eq("id", clipId).eq("status", "QUEUED"), "flow_clip_not_saved");
    const who = next ? `บัญชีซ่อม ${next.label}` : "บัญชีหลัก";
    await updateShot(admin, owner, shot.id, "QUEUED", { route: next ? "REPAIR" : "PRIMARY",
      error: `บัญชีก่อนหน้าทำไม่ได้ (${credit ? "เครดิตหมด" : reason}) ย้ายให้${who}ทำแทนอัตโนมัติ ไม่เสียเครดิต`.slice(0, 400) }, now, clipId);
    return true;
  }
  // No account can take it now: it waits (for new credits, or for the set-aside accounts to come back) instead of
  // asking the same accounts again every two minutes.
  const retryAt = credit ? nextBangkokMorning(now) : new Date(now.getTime() + SET_ASIDE_MS).toISOString();
  await admin.from("flow_clips").update({ status: "SKIPPED_NO_CREDIT", updated_at: now.toISOString() }).eq("owner_id", owner).eq("id", clipId).eq("status", "QUEUED");
  await updateShot(admin, owner, shot.id, "QUEUED", { status: "PLANNED", route: "PRIMARY", flow_clip_id: null, retry_after: retryAt,
    error: (credit ? "เครดิตหมดทั้งบัญชีหลักและบัญชีซ่อมทุกบัญชี รอเครดิตรอบใหม่" : `ทุกบัญชีทำช็อตนี้ไม่ได้ตอนนี้ (${reason}) จะลองใหม่เองใน 2 ชั่วโมง`).slice(0, 400) }, now, clipId);
  return true;
}

type ClipForRestore = { id: string; kind: string; status: string; storage_path: string | null; video_sha256: string | null; video_bytes: number | null };
async function postedCutWithoutFile(admin: SupabaseClient, owner: string, clipId: string) {
  const clip = (await admin.from("flow_clips").select("id,kind,status,storage_path,video_sha256,video_bytes").eq("owner_id", owner).eq("id", clipId).maybeSingle()).data as ClipForRestore | null;
  if (!clip || clip.kind !== "DRAMA" || clip.status !== "POSTED" || clip.storage_path || !clip.video_sha256) throw new Error("CUT_NOT_RESTORABLE");
  return clip;
}

/** A one-time upload slot for putting back a posted episode's own MP4 (the owner's saved copy). */
export async function beginCutRestore(admin: SupabaseClient, owner: string, clipId: string, bytes: number) {
  const clip = await postedCutWithoutFile(admin, owner, clipId);
  if (clip.video_bytes && bytes !== clip.video_bytes) throw new Error("CUT_NOT_THE_SAME");
  const path = episodeVideoPath(owner, clip.id);
  const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) throw new Error("UPLOAD_UNAVAILABLE");
  return { path, token: signed.data.token };
}

/** Keeps the uploaded file only when it is byte-for-byte the cut that was posted (same SHA-256); anything else is removed. */
export async function finishCutRestore(admin: SupabaseClient, owner: string, clipId: string, now = new Date()) {
  const clip = await postedCutWithoutFile(admin, owner, clipId);
  const path = episodeVideoPath(owner, clip.id);
  const file = await admin.storage.from(BUCKET).download(path);
  if (file.error || !file.data) throw new Error("CUT_NOT_UPLOADED");
  const sha256 = createHash("sha256").update(new Uint8Array(await file.data.arrayBuffer())).digest("hex");
  if (sha256 !== clip.video_sha256) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error("CUT_NOT_THE_SAME");
  }
  check(await admin.from("flow_clips").update({ storage_path: path, file_deleted_at: null, updated_at: now.toISOString() })
    .eq("owner_id", owner).eq("id", clip.id).eq("status", "POSTED").is("storage_path", null), "flow_clip_not_saved");
}
