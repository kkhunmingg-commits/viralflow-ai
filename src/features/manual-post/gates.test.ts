import { describe, expect, it } from "vitest";
import { storedClipExportReady } from "./gates";
const video = { status: "READY", quality_status: "PASS", quality_score: 92, provider: "local", quality_explanation_json: {}, updated_at: "2026-10-10T00:00:00Z" };
const compliance = { overall_status: "PASS", checked_at: "2026-10-10T01:00:00Z" };
const originality = { originality_status: "ORIGINAL", created_at: "2026-10-10T01:00:00Z" };
const script = { updated_at: "2026-10-10T00:00:00Z" };
describe("stored EXPORT content gates", () => {
  it("does not require TikTok approval or authorized account for manual export", () => {
    expect(storedClipExportReady({ ...video, video_publish_approval_status: "NOT_APPROVED" }, compliance, originality, script)).toBe(true);
  });
  it.each([{ status: "FAILED" }, { quality_status: "REJECT" }, { quality_score: 80 }, { quality_score: null }, { quality_score: 101 },
    { quality_explanation_json: { reviewRequired: true } }, { quality_explanation_json: { qualityThreshold: 70 } },
    { quality_explanation_json: { visualVerificationStatus: "REVIEW" } }, { provider: "fal" }])("fails closed for invalid quality %s", patch => {
    expect(storedClipExportReady({ ...video, ...patch }, compliance, originality, script)).toBe(false);
  });
  it("requires actual visual PASS for fal", () => {
    expect(storedClipExportReady({ ...video, provider: "fal", quality_explanation_json: { visualVerificationStatus: "PASS" } }, compliance, originality, script)).toBe(true);
  });
  it("blocks missing checks, risky claims and reused content", () => {
    expect(storedClipExportReady(video, null, originality, script)).toBe(false);
    expect(storedClipExportReady(video, { ...compliance, overall_status: "REVIEW" }, originality, script)).toBe(false);
    expect(storedClipExportReady(video, compliance, { ...originality, originality_status: "TOO_SIMILAR" }, script)).toBe(false);
  });
  it("refuses stale or malformed evidence after script or video changes", () => {
    expect(storedClipExportReady({ ...video, updated_at: "2026-10-10T02:00:00Z" }, compliance, originality, script)).toBe(false);
    expect(storedClipExportReady(video, compliance, originality, { updated_at: "2026-10-10T02:00:00Z" })).toBe(false);
    expect(storedClipExportReady(video, { ...compliance, checked_at: null }, originality, script)).toBe(false);
  });
});
