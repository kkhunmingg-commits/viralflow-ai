import { bangkokDate } from "@/features/flow-farm/contracts";
import { MAX_SHOT_ATTEMPTS, type ReferenceMode, type ShotStatus } from "./contracts";

/** Pure production rules, kept apart from the database code so they can be tested on their own. */
export interface ShotRow {
  id: string; episode_id: string; position: number; status: ShotStatus; reference_mode: ReferenceMode; attempts: number;
  retry_after: string | null; last_frame_path: string | null; flow_clip_id: string | null; prompt: string; subtitle: string;
  video_path: string | null; duration_seconds: number | null; error: string | null;
}

export type ShotOutcome = "WAIT" | "ABSORB" | "RETRY" | "RETRY_TOMORROW" | "GIVE_UP";
/** What a queued shot's Flow clip status means for the series. */
export function shotOutcome(clipStatus: string | null, attempts: number): ShotOutcome {
  if (clipStatus === "QUEUED" || clipStatus === "GENERATING") return "WAIT";
  if (clipStatus === "READY" || clipStatus === "SCHEDULED" || clipStatus === "POSTED") return "ABSORB";
  // Flow had no credits left today: the same shot goes back in the queue tomorrow and it does not count as a try.
  if (clipStatus === "SKIPPED_NO_CREDIT") return "RETRY_TOMORROW";
  // FAILED, DISCARDED, or the clip row is gone: one more try, then the owner decides.
  return attempts + 1 < MAX_SHOT_ATTEMPTS ? "RETRY" : "GIVE_UP";
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

/** Whether a new episode may start today: one at a time, up to the series' daily number, never past the season. */
export function mayStartEpisode(series: { next_episode_number: number; total_episodes: number; episodes_per_day: number }, startedToday: number, openEpisodes: number) {
  if (openEpisodes > 0) return false;
  if (series.next_episode_number > series.total_episodes) return false;
  return startedToday < series.episodes_per_day;
}

/** An episode stuck in ASSEMBLING this long (the server stopped mid-cut) is cut again. */
export const ASSEMBLY_STALE_MS = 10 * 60_000;
