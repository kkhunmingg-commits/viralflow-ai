/**
 * Clip learning loop: which warm-up clips people actually watch, engage with and follow from, fed back into the next batch.
 *
 * Signals, strongest first: new followers a post brought (typed in from TikTok Studio, the only place TikTok shows it per
 * post), shares and comments per view, likes per view, and views against the account's own median. Clips the owner threw
 * away before posting count against their series as a quality signal (the generation did not look right).
 * Everything here is pure so it can be tested; reading and saving the numbers lives in learning-store.ts.
 */
import type { FlowClipKind, FlowClipStatus } from "./contracts";

/** A clip as the learning loop sees it: what was planned, and what happened to it. */
export interface LearningClip {
  id: string; kind: FlowClipKind; title: string; caption: string; status: FlowClipStatus;
  readyAt: string | null; postedAt: string | null; createdAt: string; postUrl: string | null;
}
/** Numbers for one posted clip. `follows` is null when unknown (the API does not give per-post followers). */
export interface ClipStats {
  views: number; likes: number; comments: number; shares: number; follows: number | null;
  source: "TIKTOK_API" | "MANUAL"; at: string; videoId?: string | null;
}
export type StatsByClip = Record<string, ClipStats>;

/** Follow prompts the planner rotates through; each is told apart by a fragment only it contains. */
export const CTA_VARIANTS = [
  { id: "SERIES_NEXT", label: "ติดตามไว้ ตอนหน้า…", fragment: null as string | null },
  { id: "PART_TWO", label: "ภาค 2 มาพรุ่งนี้", fragment: "ภาค 2 มาพรุ่งนี้" },
  { id: "COMMENT_ASK", label: "คอมเมนต์สั่งตอนต่อไป", fragment: "เดี๋ยวทำให้ดู" },
  { id: "DONT_LOSE", label: "กดติดตามก่อน เดี๋ยวหาไม่เจอ", fragment: "เลื่อนหาไม่เจอ" },
  { id: "RATE_IT", label: "ให้คะแนน + มีตอนใหม่ทุกวัน", fragment: "มีตอนใหม่ทุกวัน" },
] as const;
export type CtaId = (typeof CTA_VARIANTS)[number]["id"];

export function ctaOf(caption: string): CtaId | null {
  for (const variant of CTA_VARIANTS) if (variant.fragment && caption.includes(variant.fragment)) return variant.id;
  return caption.includes("ติดตาม") ? "SERIES_NEXT" : null;
}

/** "ครัวจิ๋ว: กะเพราไข่ดาว" belongs to the ครัวจิ๋ว series; `seriesOf` is the planner's catalog lookup. */
export type SeriesLookup = (title: string) => string | null;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const median = (ns: number[]) => {
  const s = ns.toSorted((a, b) => a - b), n = s.length;
  return n ? n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 : 0;
};

/** How one posted clip did, relative to this account's typical clip (1.0 = typical). */
export interface ClipScore { clipId: string; series: string | null; cta: CtaId | null; score: number; views: number; engagement: number; followsPer1k: number | null }

export function scoreClips(clips: LearningClip[], stats: StatsByClip, seriesOf: SeriesLookup): ClipScore[] {
  const rows = clips.flatMap(clip => {
    const s = stats[clip.id];
    if (!s || !finite(s.views) || s.views <= 0) return [];
    const engagement = (s.likes + 2 * s.comments + 3 * s.shares) / s.views;
    const followsPer1k = finite(s.follows) ? s.follows * 1000 / s.views : null;
    return [{ clip, s, engagement, followsPer1k }];
  });
  if (!rows.length) return [];
  // Ratios against the account's own medians, so a small account and a big one learn the same way.
  const mViews = Math.max(1, median(rows.map(r => r.s.views)));
  const mEng = Math.max(1e-4, median(rows.map(r => r.engagement)));
  const knownFollows = rows.filter(r => r.followsPer1k !== null).map(r => r.followsPer1k!);
  const mFollows = Math.max(0.05, median(knownFollows));
  const raw = rows.map(({ clip, s, engagement, followsPer1k }) => {
    // Square root keeps one viral outlier from drowning every other signal.
    const viewRatio = Math.min(4, Math.sqrt(s.views / mViews));
    const engRatio = Math.min(4, engagement / mEng);
    const parts: Array<[number, number]> = [[viewRatio, 0.4], [engRatio, 0.3]];
    // Follows are what the owner is after, so they weigh most when known.
    if (followsPer1k !== null) parts.push([Math.min(4, followsPer1k / mFollows), 0.5]);
    const weight = parts.reduce((sum, [, w]) => sum + w, 0);
    const score = parts.reduce((sum, [value, w]) => sum + value * w, 0) / weight;
    return { clipId: clip.id, series: seriesOf(clip.title), cta: ctaOf(clip.caption), score, views: s.views, engagement, followsPer1k };
  });
  // Rescaled so this account's average clip scores exactly 1.0.
  const mean = raw.reduce((sum, r) => sum + r.score, 0) / raw.length || 1;
  return raw.map(r => ({ ...r, score: r.score / mean }));
}

export interface GroupResult {
  key: string; posted: number; discarded: number; score: number; avgViews: number | null; followsPer1k: number | null; weight: number;
}
/** A group's score is shrunk toward "typical" (1.0) until it has enough posts, so one lucky clip cannot take over. */
const PRIOR = 2;
function summarize(key: string, scores: ClipScore[], discarded: number, made: number): GroupResult {
  const sum = scores.reduce((total, s) => total + s.score, 0);
  const score = (sum + PRIOR * 1) / (scores.length + PRIOR);
  const follows = scores.filter(s => s.followsPer1k !== null);
  const discardRate = made ? discarded / made : 0;
  // Untested groups get a small bonus so new ideas keep getting tried.
  const base = scores.length ? score ** 2 : 1.15;
  const weight = Math.min(3, Math.max(0.25, base * (1 - 0.6 * discardRate)));
  return { key, posted: scores.length, discarded, score: Math.round(score * 100) / 100,
    avgViews: scores.length ? Math.round(scores.reduce((t, s) => t + s.views, 0) / scores.length) : null,
    followsPer1k: follows.length ? Math.round(follows.reduce((t, s) => t + s.followsPer1k!, 0) / follows.length * 100) / 100 : null,
    weight: Math.round(weight * 100) / 100 };
}

/** What the next batch should lean on. Weights are relative: 1 = no preference. */
export interface PlanGuide {
  seriesWeights: Record<string, number>;
  ctaWeights: Partial<Record<CtaId, number>>;
  /** Episodes already made per series, so captions can say "EP.5". */
  episodes: Record<string, number>;
  /** Concept titles made recently (newest first), so the same idea is not repeated straight away. */
  recentTitles: string[];
  /** Series whose clips were often thrown away get stricter realism instructions. */
  strictSeries: string[];
}
export interface LearningReport {
  sampleSize: number; withFollows: number; series: GroupResult[]; ctas: GroupResult[];
  top: ClipScore[]; guide: PlanGuide; status: "NO_DATA" | "LEARNING" | "CONFIDENT";
}

export function analyzeLearning(clips: LearningClip[], stats: StatsByClip, seriesOf: SeriesLookup): LearningReport {
  const growth = clips.filter(c => c.kind === "GROWTH");
  const scores = scoreClips(growth, stats, seriesOf);
  const made = growth.filter(c => ["READY", "SCHEDULED", "POSTED", "DISCARDED"].includes(c.status));
  const series = new Map<string, { scores: ClipScore[]; discarded: number; made: number }>();
  const entry = (key: string) => series.get(key) ?? (series.set(key, { scores: [], discarded: 0, made: 0 }), series.get(key)!);
  for (const clip of made) {
    const key = seriesOf(clip.title); if (!key) continue;
    const e = entry(key); e.made++; if (clip.status === "DISCARDED") e.discarded++;
  }
  for (const s of scores) if (s.series) entry(s.series).scores.push(s);
  const seriesResults = [...series].map(([key, e]) => summarize(key, e.scores, e.discarded, e.made))
    .toSorted((a, b) => b.score - a.score || b.posted - a.posted);
  const ctas = CTA_VARIANTS.map(v => summarize(v.id, scores.filter(s => s.cta === v.id), 0, 0))
    .toSorted((a, b) => b.score - a.score || b.posted - a.posted);
  const episodes: Record<string, number> = {};
  for (const clip of made) { const key = seriesOf(clip.title); if (key && clip.status !== "DISCARDED") episodes[key] = (episodes[key] ?? 0) + 1; }
  const recentTitles = [...new Set(growth.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).map(c => c.title))].slice(0, 12);
  const strictSeries = seriesResults.filter(r => r.discarded >= 2 && r.discarded / Math.max(1, r.discarded + r.posted) >= 0.3).map(r => r.key);
  return {
    sampleSize: scores.length, withFollows: scores.filter(s => s.followsPer1k !== null).length,
    series: seriesResults, ctas, top: scores.toSorted((a, b) => b.score - a.score).slice(0, 5),
    guide: { seriesWeights: Object.fromEntries(seriesResults.map(r => [r.key, r.weight])),
      ctaWeights: Object.fromEntries(ctas.map(r => [r.key, r.weight])), episodes, recentTitles, strictSeries },
    status: scores.length === 0 ? "NO_DATA" : scores.length < 8 ? "LEARNING" : "CONFIDENT",
  };
}

// ---------------------------------------------------------------- Matching TikTok videos to library clips

export interface TikTokVideo {
  id: string; description: string; createTime: number; views: number; likes: number; comments: number; shares: number;
}
/** Letters and digits only, so emoji, spacing and hashtag edits in the TikTok app do not break the match. */
export const normalizeText = (text: string) => text.replace(/#\S+/g, "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const firstLine = (caption: string) => caption.split("\n").map(l => l.trim()).find(Boolean) ?? "";

/** Video id from a TikTok post link (https://www.tiktok.com/@name/video/123…). Short links carry none. */
export function videoIdFromUrl(url: string | null) {
  return url?.match(/\/video\/(\d{6,40})/)?.[1] ?? null;
}

/**
 * Pairs videos on the TikTok profile with library clips. A saved post link wins; otherwise the clip whose caption's first line
 * appears in the video's description, made before the video went up, nearest in time. Each video and clip pairs at most once.
 */
export function matchVideos(videos: TikTokVideo[], clips: LearningClip[]): Map<string, TikTokVideo> {
  const matched = new Map<string, TikTokVideo>(), usedVideos = new Set<string>();
  const byId = new Map(videos.map(v => [v.id, v]));
  for (const clip of clips) {
    const id = videoIdFromUrl(clip.postUrl), video = id ? byId.get(id) : undefined;
    if (video) { matched.set(clip.id, video); usedVideos.add(video.id); }
  }
  const candidates = clips.filter(c => !matched.has(c.id)).map(c => ({ clip: c, key: normalizeText(firstLine(c.caption)),
    madeAt: Date.parse(c.readyAt ?? c.createdAt) }));
  for (const video of videos.toSorted((a, b) => a.createTime - b.createTime)) {
    if (usedVideos.has(video.id)) continue;
    const text = normalizeText(video.description), at = video.createTime * 1000;
    if (!text) continue;
    const best = candidates.filter(c => c.key.length >= 6 && !matched.has(c.clip.id) && text.includes(c.key) && c.madeAt <= at + 3_600_000)
      .toSorted((a, b) => (at - a.madeAt) - (at - b.madeAt))[0];
    if (best) { matched.set(best.clip.id, video); usedVideos.add(video.id); }
  }
  return matched;
}

/** Merges fresh API numbers into what is stored, keeping follower counts the owner typed in. */
export function mergeApiStats(stored: StatsByClip, matched: Map<string, TikTokVideo>, at: string): StatsByClip {
  const next = { ...stored };
  for (const [clipId, v] of matched) {
    const prior = stored[clipId];
    next[clipId] = { views: v.views, likes: v.likes, comments: v.comments, shares: v.shares,
      follows: prior?.follows ?? null, source: "TIKTOK_API", at, videoId: v.id };
  }
  return next;
}

/** Keeps the newest entries so the stored file stays small. */
export function trimStats(stats: StatsByClip, max = 250): StatsByClip {
  return Object.fromEntries(Object.entries(stats).toSorted((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, max));
}
