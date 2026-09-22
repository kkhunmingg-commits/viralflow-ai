import { z } from "zod";
import { isIP } from "node:net";
import type { PublishInitResult, PublishSettings, SourceInfo, TikTokPublishStatus } from "./types";

export interface TikTokPublishingProvider {
  readonly name: "tiktok" | "mock";
  uploadDraft(accessToken: string, source: SourceInfo): Promise<PublishInitResult>;
  directPost(accessToken: string, settings: PublishSettings, source: SourceInfo): Promise<PublishInitResult>;
  uploadBinary(uploadUrl: string, media: Blob, source: SourceInfo): Promise<void>;
  fetchPublishStatus(accessToken: string, publishId: string): Promise<TikTokPublishStatus>;
}

const initResponseSchema = z.object({
  data: z.object({ publish_id: z.string().min(1).max(64), upload_url: z.string().url().nullish() }),
  error: z.object({ code: z.literal("ok") }),
});
const statusResponseSchema = z.object({
  data: z.object({
    status: z.enum(["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD", "SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"]),
    fail_reason: z.string().nullish(),
    publicaly_available_post_id: z.array(z.union([z.string(), z.number()])).default([]),
    uploaded_bytes: z.number().int().nonnegative().default(0),
  }),
  error: z.object({ code: z.literal("ok") }),
});

export function buildChunkSource(videoSize: number): SourceInfo {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0) throw new Error("invalid_video_size");
  const maxWhole = 64 * 1024 * 1024;
  if (videoSize <= maxWhole) return { source: "FILE_UPLOAD", videoSize, chunkSize: videoSize, totalChunkCount: 1 };
  const chunkSize = 10 * 1024 * 1024;
  return { source: "FILE_UPLOAD", videoSize, chunkSize, totalChunkCount: Math.floor(videoSize / chunkSize) };
}

function isPrivateAddress(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
      || parts[0] >= 224;
  }
  if (isIP(host) === 6) {
    return !/^[23]/.test(host);
  }
  return false;
}

function assertAllowedHttpsUrl(value: string, allowedHosts: readonly string[], errorCode: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorCode);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || (url.port && url.port !== "443")
    || isPrivateAddress(hostname)
    || !allowedHosts.includes(hostname)
  ) {
    throw new Error(errorCode);
  }
  return url.toString();
}

export function assertVerifiedPullUrl(value: string, allowedHosts: readonly string[]) {
  return assertAllowedHttpsUrl(value, allowedHosts, "pull_url_not_verified");
}

export function assertTikTokUploadUrl(value: string, allowedHosts: readonly string[]) {
  return assertAllowedHttpsUrl(value, allowedHosts, "upload_url_not_allowed");
}

function sourceBody(source: SourceInfo) {
  return source.source === "PULL_FROM_URL"
    ? { source: source.source, video_url: source.videoUrl }
    : { source: source.source, video_size: source.videoSize, chunk_size: source.chunkSize, total_chunk_count: source.totalChunkCount };
}

export class OfficialTikTokPublishingProvider implements TikTokPublishingProvider {
  readonly name = "tiktok" as const;
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly allowedUploadHosts: readonly string[] = [
      "open-upload.tiktokapis.com",
      "upload.us.tiktokapis.com",
    ],
  ) {}

  private async init(endpoint: string, accessToken: string, body: object) {
    const response = await this.request(`https://open.tiktokapis.com${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json();
    if (!response.ok) throw new Error(`tiktok_http_${response.status}`);
    const parsed = initResponseSchema.parse(json).data;
    return {
      publishId: parsed.publish_id,
      uploadUrl: parsed.upload_url
        ? assertTikTokUploadUrl(parsed.upload_url, this.allowedUploadHosts)
        : null,
    };
  }

  uploadDraft(accessToken: string, source: SourceInfo) {
    return this.init("/v2/post/publish/inbox/video/init/", accessToken, { source_info: sourceBody(source) });
  }

  directPost(accessToken: string, settings: PublishSettings, source: SourceInfo) {
    return this.init("/v2/post/publish/video/init/", accessToken, {
      post_info: {
        title: settings.caption,
        privacy_level: settings.privacyLevel,
        disable_comment: settings.disableComment,
        disable_duet: settings.disableDuet,
        disable_stitch: settings.disableStitch,
        is_aigc: settings.isAigc,
        ...settings.commercialContent,
      },
      source_info: sourceBody(source),
    });
  }

  async uploadBinary(uploadUrl: string, media: Blob, source: SourceInfo) {
    if (source.source !== "FILE_UPLOAD" || !source.videoSize || !source.chunkSize || !source.totalChunkCount) {
      throw new Error("file_upload_source_required");
    }
    const safeUploadUrl = assertTikTokUploadUrl(uploadUrl, this.allowedUploadHosts);
    let start = 0;
    for (let index = 0; index < source.totalChunkCount; index += 1) {
      const final = index === source.totalChunkCount - 1;
      const endExclusive = final ? source.videoSize : Math.min(source.videoSize, start + source.chunkSize);
      const body = media.slice(start, endExclusive, media.type || "video/mp4");
      const response = await this.request(safeUploadUrl, {
        method: "PUT",
        redirect: "error",
        headers: {
          "Content-Type": media.type || "video/mp4",
          "Content-Length": String(body.size),
          "Content-Range": `bytes ${start}-${endExclusive - 1}/${source.videoSize}`,
        },
        body,
      });
      if (!response.ok) throw new Error(`tiktok_upload_http_${response.status}`);
      start = endExclusive;
    }
  }

  async fetchPublishStatus(accessToken: string, publishId: string) {
    const response = await this.request("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json: unknown = await response.json();
    if (!response.ok) throw new Error(`tiktok_status_http_${response.status}`);
    const data = statusResponseSchema.parse(json).data;
    return { status: data.status, failReason: data.fail_reason ?? null, postIds: data.publicaly_available_post_id.map(String), uploadedBytes: data.uploaded_bytes };
  }
}

export class MockTikTokPublishingProvider implements TikTokPublishingProvider {
  readonly name = "mock" as const;
  private readonly statuses = new Map<string, TikTokPublishStatus>();
  private sequence = 0;
  async uploadDraft(_token: string, source: SourceInfo) {
    const publishId = `v_inbox_${source.source.toLowerCase()}_mock_${++this.sequence}`;
    this.statuses.set(publishId, { status: "SEND_TO_USER_INBOX", failReason: null, postIds: [], uploadedBytes: source.videoSize ?? 0 });
    return { publishId, uploadUrl: source.source === "FILE_UPLOAD" ? `https://mock.invalid/upload/${publishId}` : null };
  }
  async directPost(_token: string, _settings: PublishSettings, source: SourceInfo) {
    const publishId = `v_pub_${source.source.toLowerCase()}_mock_${++this.sequence}`;
    this.statuses.set(publishId, { status: "PUBLISH_COMPLETE", failReason: null, postIds: [`mock-${publishId.slice(-12)}`], uploadedBytes: source.videoSize ?? 0 });
    return { publishId, uploadUrl: source.source === "FILE_UPLOAD" ? `https://mock.invalid/upload/${publishId}` : null };
  }
  async uploadBinary() {}
  async fetchPublishStatus(_token: string, publishId: string) {
    return this.statuses.get(publishId)
      ?? (publishId.startsWith("v_inbox_")
        ? { status: "SEND_TO_USER_INBOX", failReason: null, postIds: [], uploadedBytes: 0 }
        : publishId.startsWith("v_pub_")
          ? { status: "PUBLISH_COMPLETE", failReason: null, postIds: [`mock-${publishId.slice(-12)}`], uploadedBytes: 0 }
          : { status: "PROCESSING_UPLOAD", failReason: null, postIds: [], uploadedBytes: 0 });
  }
}

export { initResponseSchema, statusResponseSchema };
