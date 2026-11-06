import { bangkokDate } from "@/features/flow-farm/contracts";
import { MAX_SHOT_ATTEMPTS, type ReferenceMode, type ShotRoute, type ShotStatus } from "./contracts";

/** Pure production rules, kept apart from the database code so they can be tested on their own. */
export interface ShotRow {
  id: string; episode_id: string; position: number; status: ShotStatus; reference_mode: ReferenceMode; attempts: number;
  retry_after: string | null; last_frame_path: string | null; flow_clip_id: string | null; prompt: string; subtitle: string;
  video_path: string | null; duration_seconds: number | null; error: string | null; route: ShotRoute;
}

export type ClipVerdict = "WAIT" | "CHECK" | "BROKEN" | "NO_CREDIT";
/** What a queued shot's Flow clip status means: still being made, made (now check it), broken, or out of credits. */
export function clipVerdict(clipStatus: string | null): ClipVerdict {
  if (clipStatus === "QUEUED" || clipStatus === "GENERATING") return "WAIT";
  if (clipStatus === "READY" || clipStatus === "SCHEDULED" || clipStatus === "POSTED") return "CHECK";
  if (clipStatus === "SKIPPED_NO_CREDIT") return "NO_CREDIT";
  // FAILED, DISCARDED, or the clip row is gone.
  return "BROKEN";
}

export interface RetryPlan { status: "PLANNED" | "FAILED"; route: ShotRoute; attempts: number; retryAfter: string | null }
/**
 * Where a shot goes next. A broken take (Flow failed, or the server's check rejected the file) is remade on the repair
 * account, up to MAX_SHOT_ATTEMPTS tries in all. Running out of credits is not a try: the shot moves to the repair
 * account if it still has credits today, otherwise it waits for tomorrow's credits on the main account.
 */
export function planRetry(shot: Pick<ShotRow, "attempts" | "route">, reason: "BROKEN" | "NO_CREDIT",
  repair: { exists: boolean; outOfCreditsToday: boolean }, now = new Date()): RetryPlan {
  if (reason === "BROKEN") {
    const attempts = shot.attempts + 1;
    if (attempts >= MAX_SHOT_ATTEMPTS) return { status: "FAILED", route: shot.route, attempts, retryAfter: null };
    return { status: "PLANNED", route: repair.exists ? "REPAIR" : "PRIMARY", attempts, retryAfter: null };
  }
  // The repair accounts are one shared pool: while any of them still has credits today the shot goes there,
  // whichever account it was on (the one that just ran out is no longer picked).
  if (repair.exists && !repair.outOfCreditsToday) return { status: "PLANNED", route: "REPAIR", attempts: shot.attempts, retryAfter: null };
  return { status: "PLANNED", route: "PRIMARY", attempts: shot.attempts, retryAfter: nextBangkokMorning(now) };
}

/** The Google account a shot must be made on; null for series made before accounts were assigned (any account). */
export function shotAccount(route: ShotRoute, series: { flow_account_id: string | null; repair_flow_account_id: string | null }) {
  return route === "REPAIR" ? series.repair_flow_account_id ?? series.flow_account_id : series.flow_account_id;
}

/** Start of the next Bangkok day, when Flow credits renew. */
export function nextBangkokMorning(now = new Date()) {
  const today = bangkokDate(now);
  return new Date(new Date(`${today}T00:00:00+07:00`).getTime() + 86_400_000 + 5 * 60_000).toISOString();
}

const settled = (shot: Pick<ShotRow, "status">) => shot.status === "DONE" || shot.status === "SKIPPED";
/** Shots are made strictly in order: the next one needs the previous one's last frame. */
export function nextShotToQueue<T extends ShotRow>(shots: T[], now = new Date()): T | null {
  const ordered = shots.toSorted((a, b) => a.position - b.position);
  if (ordered.some(shot => shot.status === "QUEUED" || shot.status === "FAILED")) return null;
  const next = ordered.find(shot => !settled(shot));
  if (!next || next.status !== "PLANNED") return null;
  if (next.retry_after && new Date(next.retry_after).getTime() > now.getTime()) return null;
  return next;
}
export const episodeShotsFinished = (shots: ShotRow[]) => shots.length > 0 && shots.every(settled) && shots.some(shot => shot.status === "DONE");

/** The image the worker attaches in Flow for this shot. Falls back to the key still, then to nothing. */
export function referencePath(shot: Pick<ShotRow, "position" | "reference_mode">, shots: ShotRow[], keyStill: string | null) {
  if (shot.reference_mode === "NONE") return null;
  if (shot.reference_mode === "PREVIOUS_FRAME") {
    const previous = shots.filter(s => s.position < shot.position && s.status === "DONE").toSorted((a, b) => b.position - a.position)[0];
    return previous?.last_frame_path ?? keyStill;
  }
  return keyStill;
}

/** Without an image to attach, the prompt must not talk about one. */
export function promptFor(prompt: string, imagePath: string | null) {
  return imagePath ? prompt : prompt.split("\n").filter(line => !/attached (image|reference image)/.test(line)).join("\n");
}

/**
 * Whether a new episode may start today: one at a time, up to the series' daily number, never past the season. A story
 * that took over from a finished one waits for the next day: today's credits went to the previous story's last episode.
 */
export function mayStartEpisode(series: { next_episode_number: number; total_episodes: number; episodes_per_day: number },
  startedToday: number, openEpisodes: number) {
  if (openEpisodes > 0) return false;
  if (series.next_episode_number > series.total_episodes) return false;
  return startedToday < series.episodes_per_day;
}

/** An episode stuck in ASSEMBLING this long (the server stopped mid-cut) is cut again. */
export const ASSEMBLY_STALE_MS = 10 * 60_000;

/** One repair account as the shared pool sees it today. */
export interface RepairAccount { id: string; label: string; active: boolean; loggedIn: boolean; exhaustedToday: boolean; usedToday: number; perDay: number }
export interface RepairAccountRow { id: string; label: string; active: boolean; exhausted_on: string | null; clips_today: number; clips_today_on: string | null;
  clips_per_day_estimate: number; priority: number; created_at: string }
export function repairAccounts(rows: RepairAccountRow[], loggedIn: (id: string) => boolean, today: string): RepairAccount[] {
  return rows.toSorted((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(row => ({
    id: row.id, label: row.label, active: row.active, loggedIn: loggedIn(row.id), exhaustedToday: row.exhausted_on === today,
    usedToday: row.clips_today_on === today ? row.clips_today : 0, perDay: Math.max(1, row.clips_per_day_estimate) }));
}
/** Shots an account can still make today: none once Flow said it is out, or once its daily allowance is used up. */
export function repairShotsLeft(account: RepairAccount) {
  return !account.active || !account.loggedIn || account.exhaustedToday ? 0 : Math.max(0, account.perDay - account.usedToday);
}
/** The pool account to send the next repair shot to: the one with the most shots left (ties: the oldest). */
export function pickRepairAccount(pool: RepairAccount[], exclude: string[] = []) {
  return pool.filter(a => !exclude.includes(a.id) && repairShotsLeft(a) > 0).toSorted((a, b) => repairShotsLeft(b) - repairShotsLeft(a))[0] ?? null;
}
