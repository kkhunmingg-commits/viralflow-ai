import { bangkokDate } from "@/features/flow-farm/contracts";
import { MAX_REFUSED_ATTEMPTS, MAX_SHOT_ATTEMPTS, type ReferenceMode, type ShotRoute, type ShotStatus } from "./contracts";

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

/** Why a clip that failed failed, for planRetry: Google's temporary refusal, or a real broken take. */
export const failureKind = (error: string | null | undefined): "REFUSED" | "BROKEN" => /^FLOW_UNUSUAL_ACTIVITY/.test(error ?? "") ? "REFUSED" : "BROKEN";

export interface RetryPlan { status: "PLANNED" | "FAILED"; route: ShotRoute; attempts: number; retryAfter: string | null }
/**
 * Where a shot goes next. A broken take (Flow failed, or the server's check rejected the file) is remade on the repair
 * account, up to MAX_SHOT_ATTEMPTS tries in all. Running out of credits is not a try: the shot moves to the repair
 * account if it still has credits today, otherwise it waits for tomorrow's credits on the main account.
 */
export function planRetry(shot: Pick<ShotRow, "attempts" | "route">, reason: "BROKEN" | "NO_CREDIT" | "REFUSED",
  repair: { exists: boolean; outOfCreditsToday: boolean }, now = new Date()): RetryPlan {
  // Google refused the job for "unusual activity": nothing is wrong with the shot. The refused account is set aside
  // by the caller and the shot goes straight on to the next account in the pool; only many refusals stop the episode.
  if (reason === "REFUSED") {
    const attempts = shot.attempts + 1;
    if (attempts >= MAX_REFUSED_ATTEMPTS) return { status: "FAILED", route: shot.route, attempts, retryAfter: null };
    return { status: "PLANNED", route: repair.exists ? "REPAIR" : shot.route, attempts, retryAfter: null };
  }
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
export interface RepairAccount { id: string; label: string; active: boolean; loggedIn: boolean; exhaustedToday: boolean; usedToday: number; perDay: number;
  /** Why the account is set aside for a while (it could not start a shot), or null. */
  asideReason: string | null }
export interface RepairAccountRow { id: string; label: string; active: boolean; exhausted_on: string | null; clips_today: number; clips_today_on: string | null;
  clips_per_day_estimate: number; priority: number; created_at: string }
export function repairAccounts(rows: RepairAccountRow[], loggedIn: (id: string) => boolean, today: string, aside: (id: string) => string | null = () => null): RepairAccount[] {
  return rows.toSorted((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(row => ({
    id: row.id, label: row.label, active: row.active, loggedIn: loggedIn(row.id), exhaustedToday: row.exhausted_on === today,
    usedToday: row.clips_today_on === today ? row.clips_today : 0, perDay: Math.max(1, row.clips_per_day_estimate), asideReason: aside(row.id) }));
}
/** Shots an account can still make today: none once Flow said it is out, or once its daily allowance is used up. */
export function repairShotsLeft(account: RepairAccount) {
  return !account.active || !account.loggedIn || account.exhaustedToday || account.asideReason ? 0 : Math.max(0, account.perDay - account.usedToday);
}
/** The pool account to send the next repair shot to: the one with the most shots left (ties: the oldest). */
export function pickRepairAccount(pool: RepairAccount[], exclude: string[] = []) {
  return pool.filter(a => !exclude.includes(a.id) && repairShotsLeft(a) > 0).toSorted((a, b) => repairShotsLeft(b) - repairShotsLeft(a))[0] ?? null;
}

/**
 * Lucky, 7 Nov: one account makes an episode from its first shot to its last, in one Flow project, so the shots match.
 * Only an account with room for every shot still to make counts (5/5 for a five-shot episode). The account that made
 * the episode's earlier shots keeps it while it has room; otherwise the main account, then the repair account with the
 * most shots left. Null: no account can finish the episode today, so it waits rather than start on a half-empty one.
 */
export function pickEpisodeAccount(accounts: RepairAccount[], needed: number,
  { sticky = null, main = null, exclude = [] }: { sticky?: string | null; main?: string | null; exclude?: string[] } = {}) {
  const fits = accounts.filter(a => !exclude.includes(a.id) && repairShotsLeft(a) >= Math.max(1, needed));
  return fits.find(a => a.id === sticky) ?? fits.find(a => a.id === main)
    ?? fits.toSorted((a, b) => repairShotsLeft(b) - repairShotsLeft(a))[0] ?? null;
}

/** A worker reason that means the account has no credits (Flow said so, or shows no usable Generate button). */
export const isCreditReason = (reason: string) => reason === "NO_CREDIT" || /^GENERATE_BUTTON/.test(reason);
/** How long an account that could not start a shot for another reason (page changed, picture box missing…) is skipped. */
export const SET_ASIDE_MS = 2 * 60 * 60_000;
/** Accounts still set aside at `now`, from the saved { id: { until, reason } } map. */
/** When the first account that is only set aside (not out of credits) comes back, or null if none is. */
export function firstBackAt(aside: Record<string, { until: string }>, waiting: string[]) {
  const times = waiting.map(id => aside[id]?.until).filter((t): t is string => Boolean(t)).toSorted();
  return times[0] ?? null;
}
export function setAsideNow(saved: Record<string, { until: string; reason: string }> | null, now: Date) {
  return Object.fromEntries(Object.entries(saved ?? {}).filter(([, v]) => new Date(v.until).getTime() > now.getTime()));
}
