import { z } from "zod";

/** Genres the built-in showrunner can write a whole season for. */
export const DRAMA_GENRES = ["HORROR", "ACTION", "COMEDY", "ROMANCE", "MYSTERY", "FANTASY"] as const;
export type DramaGenre = (typeof DRAMA_GENRES)[number];
export const dramaGenreLabels: Record<DramaGenre, string> = {
  HORROR: "สยองขวัญ", ACTION: "แอ็กชัน", COMEDY: "ตลก", ROMANCE: "โรแมนติก", MYSTERY: "สืบสวน", FANTASY: "แฟนตาซี",
};

export type Role = "LEAD" | "ALLY" | "RIVAL";
export type PlaceKey = "A" | "B" | "C";

/** One of the three main characters. English fields go into every Flow prompt word for word, so faces, clothes and
 * voices stay the same in every shot; Thai fields are for the owner and the subtitles. */
export interface CastMember {
  role: Role; name: string; nameEn: string; age: string; look: string; outfit: string; voice: string;
  trait: string; want: string; secret: string;
}
export interface Place { key: PlaceKey; name: string; look: string }
export interface Line { who: Role; line: string }

/** What the series is, fixed when it is created: the cast, places, the key object, the hidden truth and the ending.
 * The season may change how it tells the story, never these. */
export interface SeriesBible {
  version: 1; genre: DramaGenre; premiseKey: string; title: string; logline: string;
  style: string; sound: string; hashtags: string[];
  cast: CastMember[]; places: Place[]; object: { name: string; look: string };
  truth: string; ending: string;
  /** Phase of every episode, decided up front so the season always reaches its ending on the last episode. */
  arc: EpisodePhase[];
}

export const EPISODE_PHASES = ["OPENING", "INCITING", "RISING", "MIDPOINT", "ESCALATION", "CRISIS", "CLIMAX", "FINALE"] as const;
export type EpisodePhase = (typeof EPISODE_PHASES)[number];
export const episodePhaseLabels: Record<EpisodePhase, string> = {
  OPENING: "เปิดเรื่อง", INCITING: "ปมเริ่ม", RISING: "ปมขยาย", MIDPOINT: "จุดพลิก", ESCALATION: "ยิ่งเข้มข้น",
  CRISIS: "จุดวิกฤต", CLIMAX: "ไคลแมกซ์", FINALE: "ตอนจบ",
};

/** Running memory of the story after the latest finished episode. */
export interface StoryState {
  episode: number;
  place: PlaceKey | null;
  /** Lasting changes to a character's look (an injury, wet clothes) that later prompts must keep. */
  conditions: Partial<Record<Role, { en: string; th: string }>>;
  clues: string[];
  usedMoves: string[];
  usedCliffs: string[];
  lastCliff: { th: string; en: string } | null;
  recap: Array<{ episode: number; title: string; summary: string }>;
}
export const emptyStoryState = (): StoryState =>
  ({ episode: 0, place: null, conditions: {}, clues: [], usedMoves: [], usedCliffs: [], lastCliff: null, recap: [] });

export type ReferenceMode = "NONE" | "KEY_STILL" | "PREVIOUS_FRAME";
export interface PlannedShot {
  position: number; summary: string; prompt: string; subtitle: string; speaker: Role | null; referenceMode: ReferenceMode;
}
export interface PlannedEpisode {
  number: number; phase: EpisodePhase; title: string; summary: string; cliffhanger: string; shots: PlannedShot[];
  stateAfter: StoryState; caption: string; hashtags: string[];
}

export type SeriesStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type EpisodeStatus = "PRODUCING" | "ASSEMBLING" | "READY" | "FAILED";
export type ShotStatus = "PLANNED" | "QUEUED" | "DONE" | "FAILED" | "SKIPPED";
export const seriesStatusLabels: Record<SeriesStatus, string> = { ACTIVE: "กำลังผลิต", PAUSED: "พักไว้", COMPLETED: "จบซีซันแล้ว", ARCHIVED: "เก็บเข้ากรุ" };
export const episodeStatusLabels: Record<EpisodeStatus, string> = { PRODUCING: "กำลังถ่ายทำ", ASSEMBLING: "กำลังตัดต่อ", READY: "ตัดต่อเสร็จ อยู่ในคลัง", FAILED: "ต้องตรวจ" };
export const shotStatusLabels: Record<ShotStatus, string> = { PLANNED: "รอคิว", QUEUED: "อยู่ในคิว Flow", DONE: "ได้แล้ว", FAILED: "ไม่สำเร็จ", SKIPPED: "ข้าม" };

/** Tries per shot before the episode waits for the owner: one on the main account, then up to three repairs. */
export const MAX_SHOT_ATTEMPTS = 4;
/** Google's temporary "unusual activity" refusals a shot may take before the episode waits for the owner. */
export const MAX_REFUSED_ATTEMPTS = 3;
/**
 * How long an account Google refused is left out (Lucky, 7 Nov: do not ask the same account again, move the shot to
 * the next account, go round all of them, then come back).
 */
export const REFUSED_ASIDE_MS = 30 * 60_000;
/** Which Google account a shot is queued on: the series' own account, or its repair account after a broken take. */
export type ShotRoute = "PRIMARY" | "REPAIR";
export const MAX_ASSEMBLE_ATTEMPTS = 3;

const optionalUuid = z.preprocess(value => value === "" || value == null ? undefined : value, z.uuid().optional());
export const createSeriesSchema = z.object({
  tiktokAccountId: z.uuid(),
  /** The Google (Flow) account that makes this series and nothing else while it runs. */
  flowAccountId: z.uuid(),
  /** A second Google account that remakes any broken shot. */
  repairFlowAccountId: optionalUuid,
  genre: z.enum(DRAMA_GENRES),
  totalEpisodes: z.coerce.number().int().min(3).max(60).default(30),
  shotsPerEpisode: z.coerce.number().int().min(2).max(6).default(5),
  episodesPerDay: z.coerce.number().int().min(1).max(5).default(1),
}).refine(input => input.repairFlowAccountId !== input.flowAccountId, { message: "REPAIR_SAME_AS_MAIN", path: ["repairFlowAccountId"] });
export const seriesRefSchema = z.object({ id: z.uuid() });
export const shotRefSchema = z.object({ seriesId: z.uuid(), shotId: z.uuid() });
