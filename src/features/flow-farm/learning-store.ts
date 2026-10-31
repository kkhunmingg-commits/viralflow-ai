import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TikTokTokenService } from "@/features/tiktok/services";
import { serverEnv } from "@/lib/server-env";
import { analyzeLearning, matchVideos, mergeApiStats, trimStats, type ClipStats, type LearningClip, type LearningReport,
  type StatsByClip, type TikTokVideo } from "./learning";
import { seriesOfTitle } from "./planner";
import { readStateFile, saveStateFile } from "./service";

/**
 * Per-post numbers live in one small private JSON file per owner (same service-only bucket as Flow sign-ins), so the
 * learning loop needs no database migration. Keyed by clip id; the newest 250 clips are kept.
 */
interface StatsFile {
  version: 1; clips: StatsByClip;
  accounts: Record<string, { syncedAt: string | null; followers?: Array<{ at: string; count: number }>; lastError?: string | null }>;
}
const statsPath = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/clip-stats.json`;
};
async function readStats(admin: SupabaseClient, owner: string): Promise<StatsFile> {
  const file = await readStateFile<StatsFile>(admin, statsPath(owner)).catch(() => null);
  return file?.version === 1 ? { ...file, clips: file.clips ?? {}, accounts: file.accounts ?? {} } : { version: 1, clips: {}, accounts: {} };
}
async function writeStats(admin: SupabaseClient, owner: string, file: StatsFile) {
  await saveStateFile(admin, statsPath(owner), { ...file, clips: trimStats(file.clips) }, "clip_stats_not_saved");
}

const CLIP_COLUMNS = "id,kind,title,caption,status,ready_at,posted_at,created_at,post_url";
type ClipRow = { id: string; kind: LearningClip["kind"]; title: string; caption: string; status: LearningClip["status"];
  ready_at: string | null; posted_at: string | null; created_at: string; post_url: string | null };
const toClip = (r: ClipRow): LearningClip => ({ id: r.id, kind: r.kind, title: r.title, caption: r.caption, status: r.status,
  readyAt: r.ready_at, postedAt: r.posted_at, createdAt: r.created_at, postUrl: r.post_url });

/** The account's clips the loop can learn from (everything planned except failed or skipped generations). */
export async function learningClips(client: SupabaseClient, owner: string, accountId: string): Promise<LearningClip[]> {
  const result = await client.from("flow_clips").select(CLIP_COLUMNS).eq("owner_id", owner).eq("tiktok_account_id", accountId)
    .in("status", ["QUEUED", "GENERATING", "READY", "SCHEDULED", "POSTED", "DISCARDED"]).order("created_at", { ascending: false }).limit(300);
  if (result.error) throw new Error("flow_clips_unavailable");
  return (result.data as ClipRow[]).map(toClip);
}

export interface LearningView {
  report: LearningReport; clips: LearningClip[]; stats: StatsByClip; syncedAt: string | null; lastError: string | null;
  followers: Array<{ at: string; count: number }>;
}
export async function loadLearning(admin: SupabaseClient, owner: string, accountId: string): Promise<LearningView> {
  const [clips, file] = await Promise.all([learningClips(admin, owner, accountId), readStats(admin, owner)]);
  const account = file.accounts[accountId];
  const report = analyzeLearning(clips, file.clips, seriesOfTitle, account?.followers ?? []);
  return { report, clips, stats: report.stats, syncedAt: account?.syncedAt ?? null,
    lastError: account?.lastError ?? null, followers: account?.followers ?? [] };
}

/** Numbers the owner typed in from TikTok Studio (the only place that shows new followers per post). */
export async function saveManualStats(admin: SupabaseClient, owner: string, clipId: string,
  values: { views: number; likes: number; comments: number; shares: number; follows: number | null }, now = new Date()) {
  const clip = await admin.from("flow_clips").select("id").eq("owner_id", owner).eq("id", clipId).maybeSingle();
  if (clip.error || !clip.data) throw new Error("CLIP_NOT_FOUND");
  const file = await readStats(admin, owner), prior = file.clips[clipId];
  file.clips[clipId] = { ...values, source: "MANUAL", at: now.toISOString(), videoId: prior?.videoId ?? null, postedAt: prior?.postedAt ?? null } satisfies ClipStats;
  await writeStats(admin, owner, file);
}

// ---------------------------------------------------------------- TikTok Display API (needs the video.list scope)

const API = "https://open.tiktokapis.com/v2";
const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

async function tiktokJson(url: string, token: string, body?: unknown) {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => null) as { data?: Record<string, unknown>; error?: { code?: string } } | null;
  const code = json?.error?.code;
  if (code === "scope_not_authorized" || code === "scope_permission_missed" || response.status === 403) throw new Error("STATS_SCOPE_REQUIRED");
  if (code === "access_token_invalid" || response.status === 401) throw new Error("TIKTOK_REAUTH_REQUIRED");
  if (code === "rate_limit_exceeded" || response.status === 429) throw new Error("TIKTOK_RATE_LIMITED");
  if (!response.ok || (code && code !== "ok") || !json?.data) throw new Error("TIKTOK_UNAVAILABLE");
  return json.data;
}

/** The newest videos on the profile with their public counts (TikTok returns up to 20 per page). */
export async function listProfileVideos(token: string, pages = 3): Promise<TikTokVideo[]> {
  const videos: TikTokVideo[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < pages; page++) {
    const data = await tiktokJson(`${API}/video/list/?fields=id,title,video_description,create_time,view_count,like_count,comment_count,share_count`,
      token, { max_count: 20, ...(cursor ? { cursor } : {}) });
    for (const row of (Array.isArray(data.videos) ? data.videos : []) as Array<Record<string, unknown>>) {
      if (typeof row.id !== "string" || !/^\d{1,40}$/.test(row.id)) continue;
      videos.push({ id: row.id, description: [row.title, row.video_description].filter(v => typeof v === "string").join("\n"),
        createTime: count(row.create_time), views: count(row.view_count), likes: count(row.like_count), comments: count(row.comment_count), shares: count(row.share_count) });
    }
    if (!data.has_more || typeof data.cursor !== "number") break;
    cursor = data.cursor;
  }
  return videos;
}

export function statsScopeGranted(scopes: unknown) {
  return Array.isArray(scopes) && scopes.includes("video.list");
}

/** Pulls the latest counts from TikTok and pairs them with library clips. Never throws for TikTok-side problems. */
export async function syncFromTikTok(admin: SupabaseClient, owner: string, accountId: string, now = new Date()) {
  const account = await admin.from("tiktok_accounts").select("is_mock,authorization_status,granted_scopes").eq("owner_id", owner).eq("id", accountId).maybeSingle();
  if (account.error || !account.data) throw new Error("account_not_found");
  const file = await readStats(admin, owner);
  const record = (patch: Partial<StatsFile["accounts"][string]>) => { file.accounts[accountId] = { ...{ syncedAt: null }, ...file.accounts[accountId], ...patch }; };
  if (account.data.is_mock || account.data.authorization_status !== "authorized" || serverEnv.tiktokProvider !== "official") return { status: "UNAVAILABLE" as const, matched: 0 };
  if (!statsScopeGranted(account.data.granted_scopes)) return { status: "SCOPE_REQUIRED" as const, matched: 0 };
  try {
    const token = await new TikTokTokenService(admin).getAccessToken(owner, accountId);
    const [videos, clips] = await Promise.all([listProfileVideos(token), learningClips(admin, owner, accountId)]);
    const matched = matchVideos(videos, clips.filter(c => ["READY", "SCHEDULED", "POSTED"].includes(c.status)));
    file.clips = mergeApiStats(file.clips, matched, now.toISOString());
    if ((account.data.granted_scopes as string[]).includes("user.info.stats")) {
      const info = await tiktokJson(`${API}/user/info/?fields=follower_count`, token).catch(() => null);
      const followers = count((info?.user as Record<string, unknown> | undefined)?.follower_count);
      if (info?.user) record({ followers: [...(file.accounts[accountId]?.followers ?? []), { at: now.toISOString(), count: followers }].slice(-300) });
    }
    record({ syncedAt: now.toISOString(), lastError: null });
    await writeStats(admin, owner, file);
    return { status: "SYNCED" as const, matched: matched.size, videos: videos.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "TIKTOK_UNAVAILABLE";
    record({ lastError: reason.slice(0, 60) });
    await writeStats(admin, owner, file).catch(() => {});
    return { status: "FAILED" as const, matched: 0, reason };
  }
}

/** Fresh enough to plan from: synced in the last three hours, or the account cannot sync anyway. */
export async function guideForBatch(admin: SupabaseClient, owner: string, accountId: string, now = new Date()) {
  let view = await loadLearning(admin, owner, accountId);
  if (!view.syncedAt || now.getTime() - Date.parse(view.syncedAt) > 3 * 3_600_000) {
    const synced = await syncFromTikTok(admin, owner, accountId, now).catch(() => null);
    if (synced?.status === "SYNCED") view = await loadLearning(admin, owner, accountId);
  }
  return view.report.guide;
}

/**
 * Keeps every account that allowed stats fresh without anyone pressing a button: called after the Flow worker's
 * minute-by-minute poll and after /post renders. Each account syncs at most once an hour, which also records the
 * hourly follower snapshots the per-clip follower estimate is built from.
 */
const lastCheck = new Map<string, number>();
export async function syncStaleAccounts(admin: SupabaseClient, owner: string, now = new Date(), maxAgeMs = 3_600_000) {
  const seen = lastCheck.get(owner);
  if (seen && now.getTime() - seen < 10 * 60_000) return;
  lastCheck.set(owner, now.getTime());
  const accounts = await admin.from("tiktok_accounts").select("id,granted_scopes").eq("owner_id", owner).is("hidden_at", null)
    .eq("authorization_status", "authorized").eq("is_mock", false);
  const file = await readStats(admin, owner);
  for (const account of (accounts.data ?? []) as Array<{ id: string; granted_scopes: unknown }>) {
    if (!statsScopeGranted(account.granted_scopes)) continue;
    const synced = file.accounts[account.id]?.syncedAt;
    if (synced && now.getTime() - Date.parse(synced) < maxAgeMs) continue;
    await syncFromTikTok(admin, owner, account.id, now).catch(() => null);
  }
}
