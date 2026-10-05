import { describe, expect, it } from "vitest";
import { autoPublishMode, autoVideoQualityOutcome } from "./execution-policy";

describe("Auto production gates", () => {
  it("honors a stricter fal threshold and stops explicitly for human review", () => {
    const row = { provider: "fal", status: "READY", quality_status: "PASS", quality_score: 93,
      quality_explanation_json: { visualVerificationStatus: "PASS", qualityThreshold: 95 } };
    expect(autoVideoQualityOutcome(row)).toMatchObject({ kind: "SKIP_ITEM", reason: "QUALITY_NOT_PASSED" });
    expect(autoVideoQualityOutcome({ ...row, quality_score: 97 })).toMatchObject({ kind: "ADVANCE" });
    expect(autoVideoQualityOutcome({ ...row, quality_explanation_json: { reviewRequired: true } }))
      .toMatchObject({ kind: "WAIT", state: "WAITING_FOR_APPROVAL", reason: "REVIEW_REQUIRED" });
    for (const qualityThreshold of ["invalid", 84, 101, NaN]) {
      expect(autoVideoQualityOutcome({ ...row, quality_explanation_json: { visualVerificationStatus: "PASS", qualityThreshold } }))
        .toMatchObject({ kind: "SKIP_ITEM" });
    }
    expect(autoVideoQualityOutcome({ ...row, quality_score: undefined })).toMatchObject({ kind: "SKIP_ITEM" });
  });
  const directReady = { is_mock: false, authorization_status: "authorized", audit_status: "AUDITED",
    direct_post_status: "READY", granted_scopes: ["video.publish", "video.list"] };

  it("requires public direct-post capability before an Auto run can reach analytics", () => {
    expect(autoPublishMode(directReady, false)).toBe("DIRECT_POST");
    expect(autoPublishMode({ ...directReady, audit_status: "UNAUDITED" }, false)).toBeNull();
    expect(autoPublishMode({ ...directReady, granted_scopes: ["video.upload"] }, false)).toBeNull();
    expect(autoPublishMode({ ...directReady, direct_post_status: "PRIVATE_ONLY" }, false)).toBeNull();
    expect(autoPublishMode({ ...directReady, is_mock: true }, false)).toBeNull();
    expect(autoPublishMode({ ...directReady, is_mock: true }, true)).toBe("DRAFT_UPLOAD");
  });

  it("does not publish a fal clip without actual-frame verification", () => {
    const ready = { provider: "fal", status: "READY", quality_status: "PASS", quality_score: 93,
      quality_explanation_json: { visualVerificationStatus: "PASS" } };
    expect(autoVideoQualityOutcome(ready)).toEqual({ kind: "ADVANCE", evidence: { qualityScore: 93 } });
    expect(autoVideoQualityOutcome({ ...ready, quality_explanation_json: {} })).toMatchObject({
      kind: "WAIT", state: "WAITING_FOR_DATA", reason: "VISUAL_VERIFICATION_PENDING" });
    expect(autoVideoQualityOutcome({ ...ready, quality_status: "RETRY",
      quality_explanation_json: { visualVerificationStatus: "REVIEW" } })).toMatchObject({
        kind: "WAIT", state: "WAITING_FOR_DATA", reason: "VISUAL_VERIFICATION_PENDING" });
    expect(autoVideoQualityOutcome({ ...ready, quality_status: "REJECT",
      quality_explanation_json: { visualVerificationStatus: "FAIL" } })).toMatchObject({ kind: "SKIP_ITEM" });
  });
});
