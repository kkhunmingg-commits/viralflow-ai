import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { buildStoredClipPackage } from "./services";
const owner = "dbba830c-b3a4-446e-b5d5-a40bcbe72914";
const media = new Uint8Array(2000); media.set([102,116,121,112], 4);
const hash = createHash("sha256").update(media).digest("hex");
let rows: Record<string, Record<string, unknown>[]>;
const download = vi.fn();
function client() {
  return { from(table: string) {
    const filters: [string, unknown][] = [];
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key,value]); return query; },
      is(key: string, value: unknown) { filters.push([key,value]); return query; }, order() { return query; }, limit() { return query; },
      async maybeSingle() { return { data: rows[table]?.find(row => filters.every(([key,value]) => row[key] === value)) ?? null, error: null }; },
    }; return query;
  }, storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
}
beforeEach(() => {
  rows = {
    master_videos: [{ id: "video", owner_id: owner, tiktok_account_id: "account", product_id: "product", selected_script_id: "script",
      storage_path: `owner/${owner}/masters/video/video.mp4`, status: "READY", quality_status: "PASS", quality_score: 95,
      quality_explanation_json: {}, provider: "local", updated_at: "2026-10-10T00:00:00Z" }],
    tiktok_accounts: [{ id: "account", owner_id: owner, hidden_at: null, display_name: "account", token: "must-not-export", video_publish_approval_status: "NOT_APPROVED" }],
    products: [{ id: "product", owner_id: owner, title: "product", product_url: "https://shop.example/product" }],
    scripts: [{ id: "script", owner_id: owner, caption: "caption", hashtags_json: ["tag"], updated_at: "2026-10-10T00:00:00Z" }],
    content_compliance_checks: [{ video_id: "video", owner_id: owner, overall_status: "PASS", checked_at: "2026-10-10T01:00:00Z" }],
    originality_checks: [{ video_id: "video", owner_id: owner, originality_status: "ORIGINAL", created_at: "2026-10-10T01:00:00Z" }],
    media_assets: [{ owner_id: owner, asset_type: "VIDEO", storage_path: `owner/${owner}/masters/video/video.mp4`, mime_type: "video/mp4", checksum: hash }],
  };
  download.mockReset().mockResolvedValue({ data: new Blob([media], { type: "video/mp4" }), error: null });
});
describe("stored clip manual package ownership", () => {
  it("exports genuine owned bytes without TikTok approval or credential exposure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("external calls prohibited"));
    try {
      const zip = await buildStoredClipPackage(client(), owner, "video");
      expect(zip.slice(0,4)).toEqual(new Uint8Array([80,75,3,4]));
      expect(new TextDecoder().decode(zip)).not.toContain("must-not-export");
      expect(new TextDecoder().decode(zip)).not.toContain(owner);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it("refuses other owners and mismatched linked accounts before storage reads", async () => {
    await expect(buildStoredClipPackage(client(), "different-owner", "video")).rejects.toThrow();
    rows.tiktok_accounts[0].owner_id = "different-owner";
    await expect(buildStoredClipPackage(client(), owner, "video")).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });
  it("refuses hidden accounts and foreign storage paths", async () => {
    rows.tiktok_accounts[0].hidden_at = "2026-10-10T00:00:00Z";
    await expect(buildStoredClipPackage(client(), owner, "video")).rejects.toThrow();
    rows.tiktok_accounts[0].hidden_at = null; rows.master_videos[0].storage_path = "owner/another-owner/clip.mp4";
    await expect(buildStoredClipPackage(client(), owner, "video")).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
  });
  it("refuses stale/rejected media and detects changed bytes", async () => {
    rows.content_compliance_checks[0].overall_status = "REJECT";
    await expect(buildStoredClipPackage(client(), owner, "video")).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
    rows.content_compliance_checks[0].overall_status = "PASS";
    download.mockResolvedValue({ data: new Blob([new Uint8Array(2000)], { type: "video/mp4" }), error: null });
    await expect(buildStoredClipPackage(client(), owner, "video")).rejects.toThrow();
    const changed = media.slice(); changed[100] = 1;
    download.mockResolvedValue({ data: new Blob([changed], { type: "video/mp4" }), error: null });
    await expect(buildStoredClipPackage(client(), owner, "video")).rejects.toThrow("export_media_changed");
  });
});
