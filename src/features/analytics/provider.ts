import type { AnalyticsSource, VideoMetrics } from "./types";

export interface VideoAnalyticsObservation extends VideoMetrics {
  externalVideoId: string;
  capturedAt: string;
  source: AnalyticsSource;
  sourceConfidence: number;
  publishedAt?: string | null;
}

export interface AnalyticsFetchRequest {
  accountId: string;
  externalVideoIds: readonly string[];
  accessToken: string;
  capturedAt: string;
}

export interface AnalyticsProvider {
  readonly name: string;
  isAvailable(): boolean;
  getFailureReason(): string | null;
  fetchVideoAnalytics(request: AnalyticsFetchRequest): Promise<VideoAnalyticsObservation[]>;
}

export class AnalyticsProviderError extends Error {
  constructor(readonly code: "AUTH_REQUIRED" | "MISSING_SCOPE" | "RATE_LIMITED" | "TEMPORARY_FAILURE" | "MALFORMED_RESPONSE") {
    super(code);
    this.name = "AnalyticsProviderError";
  }
}

export class MockTikTokAnalyticsProvider implements AnalyticsProvider {
  readonly name = "mock-tiktok-analytics";
  constructor(private readonly rows: VideoAnalyticsObservation[] = []) {}
  isAvailable() { return true; }
  getFailureReason() { return null; }
  async fetchVideoAnalytics(request: AnalyticsFetchRequest) {
    return structuredClone(this.rows.filter(row => request.externalVideoIds.includes(row.externalVideoId)));
  }
}

type Fetcher = typeof fetch;
const videoQueryUrl = "https://open.tiktokapis.com/v2/video/query/?fields=id,create_time,like_count,comment_count,share_count,view_count";

function metric(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new AnalyticsProviderError("MALFORMED_RESPONSE");
  }
  return value;
}

function normalizedVideo(value: unknown, capturedAt: string): VideoAnalyticsObservation {
  if (!value || typeof value !== "object") throw new AnalyticsProviderError("MALFORMED_RESPONSE");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^\d{1,40}$/.test(row.id)) {
    throw new AnalyticsProviderError("MALFORMED_RESPONSE");
  }
  const created = metric(row.create_time);
  if (created !== null && (created < 946_684_800 || created > Date.now() / 1000 + 86_400)) {
    throw new AnalyticsProviderError("MALFORMED_RESPONSE");
  }
  return {
    externalVideoId: row.id, capturedAt, source: "TIKTOK_DISPLAY", sourceConfidence: 0.95,
    publishedAt: created === null ? null : new Date(created * 1000).toISOString(),
    views: metric(row.view_count), likes: metric(row.like_count),
    comments: metric(row.comment_count), shares: metric(row.share_count),
    favorites: null, clicks: null, orders: null, gmv: null, commission: null,
  };
}

export class TikTokAnalyticsProvider implements AnalyticsProvider {
  readonly name = "tiktok-display-api";
  constructor(private readonly enabled = false, private readonly fetcher: Fetcher = fetch) {}
  isAvailable() { return this.enabled; }
  getFailureReason() { return this.enabled ? null : "ANALYTICS_PROVIDER_DISABLED"; }

  async fetchVideoAnalytics(request: AnalyticsFetchRequest): Promise<VideoAnalyticsObservation[]> {
    if (!this.enabled) throw new AnalyticsProviderError("AUTH_REQUIRED");
    if (!request.accessToken || !request.externalVideoIds.length || request.externalVideoIds.length > 20
      || request.externalVideoIds.some(id => !/^\d{1,40}$/.test(id))) {
      throw new AnalyticsProviderError("MALFORMED_RESPONSE");
    }
    let response: Response;
    try {
      response = await this.fetcher(videoQueryUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${request.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: [...request.externalVideoIds] } }),
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch {
      throw new AnalyticsProviderError("TEMPORARY_FAILURE");
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new AnalyticsProviderError("MALFORMED_RESPONSE"); }
    const envelope = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const apiError = envelope.error && typeof envelope.error === "object"
      ? (envelope.error as Record<string, unknown>).code : undefined;
    if (response.status === 403 || apiError === "scope_not_authorized" || apiError === "scope_permission_missed") {
      throw new AnalyticsProviderError("MISSING_SCOPE");
    }
    if (response.status === 401 || apiError === "access_token_invalid") throw new AnalyticsProviderError("AUTH_REQUIRED");
    if (response.status === 429 || apiError === "rate_limit_exceeded") throw new AnalyticsProviderError("RATE_LIMITED");
    if (response.status >= 500 || apiError === "internal_error") throw new AnalyticsProviderError("TEMPORARY_FAILURE");
    if (!response.ok || apiError !== "ok") throw new AnalyticsProviderError("MALFORMED_RESPONSE");
    const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : null;
    if (!data || !Array.isArray(data.videos)) throw new AnalyticsProviderError("MALFORMED_RESPONSE");
    const allowed = new Set(request.externalVideoIds);
    const observations = data.videos.map(row => normalizedVideo(row, request.capturedAt));
    if (observations.some(row => !allowed.has(row.externalVideoId))) throw new AnalyticsProviderError("MALFORMED_RESPONSE");
    return observations;
  }
}

export class TikTokShopAnalyticsProvider implements AnalyticsProvider {
  readonly name = "tiktok-shop-analytics-202605";
  isAvailable() { return false; }
  getFailureReason() { return "APPROVAL_REQUIRED: data.shop_analytics.public.read and seller authorization are required"; }
  async fetchVideoAnalytics(request: AnalyticsFetchRequest): Promise<VideoAnalyticsObservation[]> {
    void request;
    throw new Error(this.getFailureReason()!);
  }
}
