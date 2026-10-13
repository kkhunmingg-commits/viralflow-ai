import { createHash } from "node:crypto";
import type { TrendObservation } from "./topics";

/** Official Trending now export; no private API, arbitrary URL, article or media fetch. */
export const GOOGLE_TRENDS_TH_RSS = "https://trends.google.com/trending/rss?geo=TH";
export const GOOGLE_TRENDS_REFRESH_MS = 10 * 60_000;
export const GOOGLE_TRENDS_MAX_BYTES = 512 * 1024;
export const GOOGLE_TRENDS_RSS_DOCUMENTATION = "https://support.google.com/trends/answer/3076011?hl=en";
export const GOOGLE_TRENDS_REUSE_DOCUMENTATION = "https://support.google.com/trends/answer/4365538?hl=en";
const TIMEOUT_MS = 10_000;
const MAX_ITEMS = 100;

export interface GoogleTrendsObservation extends TrendObservation {
  sourceMetrics: {
    name: "APPROXIMATE_GOOGLE_SEARCH_VOLUME";
    raw: string;
    lowerBound: number | null;
    exact: false;
    windowHours: null;
  };
}
export interface GoogleTrendsFeed {
  status: "REAL_OBSERVATIONS" | "UNKNOWN";
  country: "TH";
  fetchedAt: string;
  sourceUrl: typeof GOOGLE_TRENDS_TH_RSS;
  attribution: "Data source: Google Trends (https://trends.google.com/)";
  observations: GoogleTrendsObservation[];
  rejectedItems: number;
  reason?: "SOURCE_UNAVAILABLE" | "SOURCE_INVALID" | "SOURCE_TOO_LARGE" | "NO_VALID_ITEMS";
  /** These are Google searches; audience, hooks and TikTok virality are not measured. */
  tikTokViralOutcome: "UNKNOWN";
}
function result(now: Date): GoogleTrendsFeed {
  if (!Number.isFinite(now.getTime())) throw new Error("TREND_TIME_INVALID");
  return { status: "UNKNOWN", country: "TH", fetchedAt: now.toISOString(), sourceUrl: GOOGLE_TRENDS_TH_RSS,
    attribution: "Data source: Google Trends (https://trends.google.com/)", observations: [], rejectedItems: 0,
    tikTokViralOutcome: "UNKNOWN" };
}
function invalid(code: GoogleTrendsFeed["reason"] = "SOURCE_INVALID"): never { throw new Error(code); }

/** Deliberately restricted scalar reader, not a general XML parser. No entity expansion. */
function scalar(item: string, tag: "title" | "pubDate" | "ht:approx_traffic"): string {
  const matches = [...item.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g"))];
  if (matches.length !== 1) invalid();
  let text = matches[0][1].trim();
  if (text.startsWith("<![CDATA[") && text.endsWith("]]>")) {
    text = text.slice(9, -3);
    if (text.includes("]]>")) invalid();
  } else {
    if (text.includes("<") || /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-fA-F]{1,6});)/.test(text)) invalid();
    text = text.replace(/&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-fA-F]{1,6});/g, entity => {
      const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
      if (entity in named) return named[entity];
      const code = entity.startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
      if (code <= 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) invalid();
      return String.fromCodePoint(code);
    });
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text || text.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) invalid();
  return text;
}
function lowerBound(raw: string): number | null {
  // Preserve approximation. Never convert this to exact views, an index or growth rate.
  const match = /^(\d+(?:,\d{3})*(?:\.\d+)?)([KMB])?\+$/i.exec(raw);
  if (!match) return null;
  const multipliers: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
  const value = Number(match[1].replaceAll(",", "")) * (multipliers[match[2]?.toUpperCase()] ?? 1);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseGoogleTrendsThailandRss(xml: string, now: Date): GoogleTrendsFeed {
  const report = result(now);
  if (Buffer.byteLength(xml, "utf8") > GOOGLE_TRENDS_MAX_BYTES) invalid("SOURCE_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !/^\s*(?:<\?xml[^?]*\?>\s*)?<rss\s[^>]*>[\s\S]*<\/rss>\s*$/.test(xml) ||
      !/<channel>[\s\S]*<\/channel>/.test(xml) ||
      !/<link>https:\/\/trends\.google\.com\/trending\/rss\?geo=TH<\/link>/.test(xml)) invalid();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  if (items.length > MAX_ITEMS || (xml.match(/<item(?:\s|>)/g)?.length ?? 0) !== items.length) invalid();
  const seen = new Set<string>();
  for (const [, item] of items) {
    try {
      const name = scalar(item, "title"), published = Date.parse(scalar(item, "pubDate"));
      if (!Number.isFinite(published) || published > now.getTime() || now.getTime() - published > 7 * 86_400_000) invalid();
      const raw = scalar(item, "ht:approx_traffic");
      const key = `google-trends:TH:${createHash("sha256").update(name.toLocaleLowerCase()).digest("hex").slice(0, 24)}`;
      if (seen.has(key)) { report.rejectedItems++; continue; }
      seen.add(key);
      report.observations.push({ name, key, source: "GOOGLE_TRENDS", capturedAt: new Date(published).toISOString(), authorized: true,
        provenance: { kind: "REAL", reference: GOOGLE_TRENDS_TH_RSS, collection: "OFFICIAL_RSS", permittedUse: true,
          verifiedAt: now.toISOString(), scope: { kind: "PUBLIC", regions: ["TH"] } }, visualUse: "UNKNOWN",
        sourceMetrics: { name: "APPROXIMATE_GOOGLE_SEARCH_VOLUME", raw, lowerBound: lowerBound(raw), exact: false, windowHours: null } });
    } catch { report.rejectedItems++; }
  }
  if (report.observations.length) report.status = "REAL_OBSERVATIONS";
  else report.reason = "NO_VALID_ITEMS";
  return report;
}

async function readBounded(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > GOOGLE_TRENDS_MAX_BYTES)) invalid("SOURCE_TOO_LARGE");
  if (!response.body) invalid();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > GOOGLE_TRENDS_MAX_BYTES) { await reader.cancel(); invalid("SOURCE_TOO_LARGE"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

/** One bounded official RSS request per source instance per 10 minutes; no retries. */
export function createGoogleTrendsThailandSource(fetcher: typeof fetch = fetch) {
  let cached: GoogleTrendsFeed | undefined, expiresAt = 0, inFlight: Promise<GoogleTrendsFeed> | undefined;
  return {
    async read(now = new Date()): Promise<GoogleTrendsFeed> {
      result(now);
      if (cached && now.getTime() < expiresAt) return structuredClone(cached);
      if (inFlight) return structuredClone(await inFlight);
      inFlight = (async () => {
        const timer = new AbortController(), timeout = setTimeout(() => timer.abort(), TIMEOUT_MS);
        try {
          const response = await fetcher(GOOGLE_TRENDS_TH_RSS, { method: "GET", redirect: "error", credentials: "omit",
            cache: "no-store", signal: timer.signal, headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
          if (!response.ok || response.redirected) invalid("SOURCE_UNAVAILABLE");
          if (!/^(?:application\/(?:rss\+xml|xml)|text\/xml)(?:;|$)/i.test(response.headers.get("content-type") ?? "")) invalid();
          return parseGoogleTrendsThailandRss(await readBounded(response), now);
        } catch (error) {
          const report = result(now), code = error instanceof Error ? error.message : "";
          report.reason = code === "SOURCE_TOO_LARGE" ? "SOURCE_TOO_LARGE" : code === "SOURCE_INVALID" ? "SOURCE_INVALID" : "SOURCE_UNAVAILABLE";
          return report;
        } finally { clearTimeout(timeout); }
      })();
      try { cached = await inFlight; expiresAt = now.getTime() + GOOGLE_TRENDS_REFRESH_MS; return structuredClone(cached); }
      finally { inFlight = undefined; }
    },
  };
}
