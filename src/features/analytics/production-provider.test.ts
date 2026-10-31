import { describe, expect, it, vi } from "vitest";
import { AnalyticsProviderError, TikTokAnalyticsProvider } from "./provider";

const request = { accountId: "account-1", externalVideoIds: ["123456789"],
  accessToken: "private-token", capturedAt: "2026-09-23T10:00:00.000Z" };
const ok = (videos: unknown[]) => Response.json({ data: { videos }, error: { code: "ok" } });

describe("official TikTok Display analytics boundary", () => {
  it("is disabled until explicitly configured and sends only the official video query", async () => {
    expect(new TikTokAnalyticsProvider().isAvailable()).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(ok([{ id: "123456789", create_time: 1_790_000_000,
      view_count: 0, like_count: 0, comment_count: 0, share_count: 0 }]));
    const provider = new TikTokAnalyticsProvider(true, fetcher);
    const rows = await provider.fetchVideoAnalytics(request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://open.tiktokapis.com/v2/video/query/?fields=id,create_time,like_count,comment_count,share_count,view_count");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ filters: { video_ids: ["123456789"] } });
    expect(rows[0]).toMatchObject({ externalVideoId: "123456789", views: 0, likes: 0,
      favorites: null, clicks: null, orders: null, gmv: null, commission: null });
  });

  it.each([
    [401, "access_token_invalid", "AUTH_REQUIRED"],
    [401, "scope_not_authorized", "MISSING_SCOPE"],
    [403, "scope_not_authorized", "MISSING_SCOPE"],
    [400, "scope_permission_missed", "MISSING_SCOPE"],
    [429, "rate_limit_exceeded", "RATE_LIMITED"],
    [500, "internal_error", "TEMPORARY_FAILURE"],
  ] as const)("classifies HTTP %i without leaking credentials", async (status, code, expected) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { code, message: "sensitive" } }, { status }));
    await expect(new TikTokAnalyticsProvider(true, fetcher).fetchVideoAnalytics(request))
      .rejects.toMatchObject({ code: expected, message: expected });
  });

  it("rejects malformed or foreign video data", async () => {
    const bad = new TikTokAnalyticsProvider(true, vi.fn().mockResolvedValue(ok([{ id: "999", view_count: 1 }])));
    await expect(bad.fetchVideoAnalytics(request)).rejects.toBeInstanceOf(AnalyticsProviderError);
    const negative = new TikTokAnalyticsProvider(true, vi.fn().mockResolvedValue(ok([{ id: "123456789", view_count: -1 }])));
    await expect(negative.fetchVideoAnalytics(request)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});
