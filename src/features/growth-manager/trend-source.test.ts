import { describe, expect, it, vi } from "vitest";
import { analyzeTrendIntelligence } from "./topics";
import { createGoogleTrendsThailandSource, GOOGLE_TRENDS_MAX_BYTES, GOOGLE_TRENDS_REFRESH_MS, GOOGLE_TRENDS_TH_RSS, parseGoogleTrendsThailandRss } from "./trend-source";

const now = new Date("2026-10-13T09:00:00Z");
const item = (title = "จัดโต๊ะทำงาน", date = "Tue, 13 Oct 2026 01:20:00 -0700", traffic = "20K+") =>
  `<item><title>${title}</title><ht:approx_traffic>${traffic}</ht:approx_traffic><pubDate>${date}</pubDate><ht:news_item><ht:news_item_title>Do not fetch this article</ht:news_item_title><ht:news_item_url>http://127.0.0.1/secret</ht:news_item_url></ht:news_item></item>`;
const rss = (items = item()) => `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel><title>Daily Search Trends</title><link>${GOOGLE_TRENDS_TH_RSS}</link>${items}</channel></rss>`;
const xmlResponse = (body = rss()) => new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });

describe("official public Thailand Google Trends source", () => {
  it("retains approximate Google search volume without inventing TikTok audience, hooks or growth", () => {
    const feed = parseGoogleTrendsThailandRss(rss(), now), observation = feed.observations[0];
    expect(feed.status).toBe("REAL_OBSERVATIONS");
    expect(observation).toMatchObject({ source: "GOOGLE_TRENDS", capturedAt: "2026-10-13T08:20:00.000Z",
      provenance: { kind: "REAL", collection: "OFFICIAL_RSS", permittedUse: true, scope: { kind: "PUBLIC", regions: ["TH"] } },
      sourceMetrics: { name: "APPROXIMATE_GOOGLE_SEARCH_VOLUME", raw: "20K+", lowerBound: 20_000, exact: false, windowHours: null } });
    for (const field of ["metric", "audience", "hook", "story", "confidence", "momentum"]) expect(observation).not.toHaveProperty(field);
    const report = analyzeTrendIntelligence(feed.observations, { accountId: "pilot", region: "TH" }, now);
    expect(report.status).toBe("UNKNOWN");
    expect(report.viralOutcome).toBe("UNKNOWN");
  });
  it("handles supported escaped scalars, preserves unknown volume and deduplicates", () => {
    const feed = parseGoogleTrendsThailandRss(rss(item("A &amp; B &#x0E01;", undefined, "unknown") + item("A &amp; B &#x0E01;")), now);
    expect(feed.observations).toHaveLength(1);
    expect(feed.observations[0]).toMatchObject({ name: "A & B ก", sourceMetrics: { lowerBound: null, raw: "unknown" } });
    expect(feed.rejectedItems).toBe(1);
  });
  it("rejects stale, future, invalid-date and nested/unknown-entity scalars", () => {
    const feed = parseGoogleTrendsThailandRss(rss(item("old", "Tue, 01 Sep 2026 00:00:00 GMT") + item("future", "Tue, 14 Oct 2026 00:00:00 GMT") + item("bad", "bad date") + item("<b>markup</b>") + item("&untrusted;")), now);
    expect(feed).toMatchObject({ status: "UNKNOWN", reason: "NO_VALID_ITEMS", rejectedItems: 5 });
  });
  it("rejects XML entity declarations, oversized feeds and wrong country", () => {
    expect(() => parseGoogleTrendsThailandRss(`<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]>${rss()}`, now)).toThrow("SOURCE_INVALID");
    expect(() => parseGoogleTrendsThailandRss(rss().replaceAll("geo=TH", "geo=US"), now)).toThrow("SOURCE_INVALID");
    expect(() => parseGoogleTrendsThailandRss("a".repeat(GOOGLE_TRENDS_MAX_BYTES + 1), now)).toThrow("SOURCE_TOO_LARGE");
    expect(() => parseGoogleTrendsThailandRss(rss(item().repeat(101)), now)).toThrow("SOURCE_INVALID");
  });
  it("fetches only the fixed public endpoint once per refresh and joins concurrent requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => xmlResponse()), source = createGoogleTrendsThailandSource(fetcher);
    const [first, second] = await Promise.all([source.read(now), source.read(now)]);
    expect(fetcher).toHaveBeenCalledOnce(); expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledWith(GOOGLE_TRENDS_TH_RSS, expect.objectContaining({ method: "GET", redirect: "error", credentials: "omit", signal: expect.any(AbortSignal) }));
    first.observations.length = 0;
    expect((await source.read(new Date(now.getTime() + 1))).observations).toHaveLength(1);
    await source.read(new Date(now.getTime() + GOOGLE_TRENDS_REFRESH_MS));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("returns UNKNOWN for HTTP failure or non-XML content without retrying or logging payloads", async () => {
    for (const response of [new Response("private debug", { status: 403 }), new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } })]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const feed = await createGoogleTrendsThailandSource(fetcher).read(now);
      expect(feed.status).toBe("UNKNOWN"); expect(feed.observations).toHaveLength(0);
      expect(JSON.stringify(feed)).not.toContain("private debug"); expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("bounds streamed response bytes even when Content-Length is missing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(xmlResponse("a".repeat(GOOGLE_TRENDS_MAX_BYTES + 1)));
    expect(await createGoogleTrendsThailandSource(fetcher).read(now)).toMatchObject({ status: "UNKNOWN", reason: "SOURCE_TOO_LARGE" });
  });
  it("returns UNKNOWN on a timed-out request and does not enter an automatic retry loop", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true });
      }));
      const source = createGoogleTrendsThailandSource(fetcher), pending = source.read(now);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toMatchObject({ status: "UNKNOWN", reason: "SOURCE_UNAVAILABLE" });
      await source.read(now); expect(fetcher).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
