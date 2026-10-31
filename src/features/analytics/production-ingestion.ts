import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AnalyticsProviderError, MockTikTokAnalyticsProvider, TikTokAnalyticsProvider,
  type AnalyticsProvider, type VideoAnalyticsObservation } from "./provider";
import { calculateWinner, defaultBaseline, deriveAccountBaseline } from "./scoring";
import { persistVideoEvaluation } from "./services";
import type { AnalyticsMode, VideoMetrics } from "./types";

export type AnalyticsIngestionResult =
  | { status: "READY"; availability: "AVAILABLE"; winnerScoreId: string; winnerDecision: string; duplicate: boolean }
  | { status: "WAITING_FOR_DATA" | "REAUTH_REQUIRED";
    availability: "UNAVAILABLE" | "UNKNOWN" | "STALE" | "AUTH_REQUIRED"; reason: string };

export interface TokenAccess {
  getAccessToken(ownerId: string, accountId: string, refreshBufferMs?: number): Promise<string>;
}
type Config = { provider: "mock" | "official"; realMode: boolean; oauthOfficial: boolean; credentialsReady: boolean };

export function selectAnalyticsProvider(config: Config, fetcher: typeof fetch = fetch): AnalyticsProvider {
  return config.provider === "official"
    ? new TikTokAnalyticsProvider(config.realMode && config.oauthOfficial && config.credentialsReady, fetcher)
    : new MockTikTokAnalyticsProvider();
}

function capturedAt(now: Date) {
  return new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
}
const unavailable = (reason: string, availability: "UNAVAILABLE" | "UNKNOWN" | "STALE" = "UNKNOWN") =>
  ({ status: "WAITING_FOR_DATA" as const, availability, reason });
const reauthorize = (reason: string) =>
  ({ status: "REAUTH_REQUIRED" as const, availability: "AUTH_REQUIRED" as const, reason });

function observationFromRow(row: Record<string, unknown>): VideoAnalyticsObservation {
  return {
    externalVideoId: String(row.external_video_id), capturedAt: String(row.source_snapshot_at),
    source: "TIKTOK_DISPLAY", sourceConfidence: Number(row.source_confidence),
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    views: row.views as number | null, likes: row.likes as number | null,
    comments: row.comments as number | null, shares: row.shares as number | null,
    favorites: row.favorites as number | null, clicks: row.clicks as number | null,
    orders: row.orders as number | null, gmv: row.gmv as number | null,
    commission: row.commission as number | null,
  };
}

export class ProductionAnalyticsIngestion {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly provider: AnalyticsProvider,
    private readonly tokens: TokenAccess,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async collect(input: { ownerId: string; accountId: string; queueId: string; videoId: string;
    videoKind: "MASTER" | "VARIATION"; mode: AnalyticsMode; productId?: string | null }): Promise<AnalyticsIngestionResult> {
    const queueResult = await this.admin.from("publishing_queue")
      .select("status,published_post_ids_json,completed_at")
      .eq("owner_id", input.ownerId).eq("tiktok_account_id", input.accountId)
      .eq("id", input.queueId).eq("video_id", input.videoId).maybeSingle();
    if (queueResult.error) throw new Error("analytics_publish_queue_read_failed");
    const queue = queueResult.data;
    if (!queue || queue.status !== "PUBLISHED") return unavailable("PUBLISH_NOT_CONFIRMED");
    const postIds = queue.published_post_ids_json;
    const postId = Array.isArray(postIds) ? postIds[0] : null;
    if (typeof postId !== "string" || !/^\d{1,40}$/.test(postId)) {
      return unavailable("POST_ID_NOT_READY");
    }
    const accountResult = await this.admin.from("tiktok_accounts")
      .select("authorization_status,granted_scopes,is_mock")
      .eq("owner_id", input.ownerId).eq("id", input.accountId).maybeSingle();
    if (accountResult.error) throw new Error("analytics_account_read_failed");
    const account = accountResult.data;
    if (!account || account.is_mock || account.authorization_status !== "authorized") {
      return reauthorize("ACCOUNT_NOT_AUTHORIZED");
    }
    if (!Array.isArray(account.granted_scopes) || !account.granted_scopes.includes("video.list")) {
      return reauthorize("VIDEO_LIST_SCOPE_REQUIRED");
    }
    if (!this.provider.isAvailable()) return unavailable("ANALYTICS_PROVIDER_DISABLED", "UNAVAILABLE");

    const snapshotTime = capturedAt(this.now());
    const cached = await this.admin.from("video_analytics_snapshots").select("*")
      .eq("owner_id", input.ownerId).eq("tiktok_account_id", input.accountId)
      .eq("source", "TIKTOK_DISPLAY").eq("external_video_id", postId)
      .eq("source_snapshot_at", snapshotTime).maybeSingle();
    if (cached.error) throw new Error("analytics_snapshot_read_failed");
    let observation: VideoAnalyticsObservation;
    if (cached.data) {
      if (cached.data.video_id !== input.videoId) throw new Error("analytics_identity_mismatch");
      const prior = await this.admin.from("winner_scores").select("id,decision")
        .eq("owner_id", input.ownerId).eq("tiktok_account_id", input.accountId)
        .eq("video_snapshot_id", cached.data.id).eq("mode", input.mode)
        .order("evaluated_at", { ascending: false }).limit(1).maybeSingle();
      if (prior.error) throw new Error("analytics_winner_read_failed");
      if (prior.data) return { status: "READY", availability: "AVAILABLE", winnerScoreId: prior.data.id,
        winnerDecision: prior.data.decision, duplicate: true };
      observation = observationFromRow(cached.data);
    } else {
      let token: string;
      try { token = await this.tokens.getAccessToken(input.ownerId, input.accountId); }
      catch { return reauthorize("TOKEN_UNAVAILABLE"); }
      const request = { accountId: input.accountId, externalVideoIds: [postId], accessToken: token, capturedAt: snapshotTime };
      let rows: VideoAnalyticsObservation[];
      try {
        rows = await this.provider.fetchVideoAnalytics(request);
      } catch (error) {
        if (!(error instanceof AnalyticsProviderError)) throw error;
        if (error.code === "AUTH_REQUIRED") {
          try {
            const refreshed = await this.tokens.getAccessToken(input.ownerId, input.accountId, 365 * 24 * 60 * 60_000);
            rows = await this.provider.fetchVideoAnalytics({ ...request, accessToken: refreshed });
          } catch (retryError) {
            if (retryError instanceof AnalyticsProviderError) {
              if (retryError.code === "RATE_LIMITED") return unavailable("ANALYTICS_RATE_LIMITED", "STALE");
              if (retryError.code === "MISSING_SCOPE") return reauthorize("VIDEO_LIST_SCOPE_REQUIRED");
              if (retryError.code === "TEMPORARY_FAILURE") throw new Error("analytics_temporary_failure");
              if (retryError.code === "MALFORMED_RESPONSE") throw new Error("analytics_malformed_response");
            }
            return reauthorize("TOKEN_REAUTH_REQUIRED");
          }
        } else if (error.code === "MISSING_SCOPE") return reauthorize("VIDEO_LIST_SCOPE_REQUIRED");
        else if (error.code === "RATE_LIMITED") return unavailable("ANALYTICS_RATE_LIMITED", "STALE");
        else if (error.code === "TEMPORARY_FAILURE") throw new Error("analytics_temporary_failure");
        else throw new Error("analytics_malformed_response");
      }
      const found = rows.find(row => row.externalVideoId === postId);
      if (!found || found.views === null) return unavailable("ANALYTICS_NOT_READY");
      observation = found;
    }
    const history = await this.admin.from("video_analytics_snapshots")
      .select("views,likes,comments,shares,favorites,clicks,orders,gmv,commission")
      .eq("owner_id", input.ownerId).eq("tiktok_account_id", input.accountId)
      .neq("external_video_id", postId).order("source_snapshot_at", { ascending: false }).limit(50);
    if (history.error) throw new Error("analytics_baseline_read_failed");
    const baseline = history.data?.length ? deriveAccountBaseline(history.data as VideoMetrics[]) : defaultBaseline();
    const publishedAt = observation.publishedAt ?? queue.completed_at;
    observation = { ...observation, publishedAt };
    const ageHours = publishedAt && Number.isFinite(Date.parse(publishedAt))
      ? Math.max(0, (Date.parse(snapshotTime) - Date.parse(publishedAt)) / 3_600_000) : 0;
    if (ageHours < 2) return unavailable("ANALYTICS_MATURATION_PENDING");
    const result = calculateWinner({ ...observation, id: input.videoId, accountId: input.accountId,
      mode: input.mode, ageHours, commerceAvailable: false, baseline });
    const saved = await persistVideoEvaluation(this.admin, { ...input, observation, result, baseline });
    return { status: "READY", availability: "AVAILABLE", winnerScoreId: saved.winnerScoreId,
      winnerDecision: result.decision, duplicate: saved.duplicate };
  }
}
