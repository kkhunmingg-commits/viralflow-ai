import { describe, expect, it } from "vitest";
import { accountPostingMode, autoPublishMode, autoVideoQualityOutcome } from "./execution-policy";

describe("Auto production gates", () => {
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

  it("requires separately granted and approved draft capability without widening OAuth scopes", () => {
    const draft = { ...directReady, granted_scopes: ["video.upload"], upload_status: "READY" };
    expect(accountPostingMode(draft, "DRAFT", false, true)).toBe("DRAFT_UPLOAD");
    expect(accountPostingMode(draft, "DRAFT", false, false)).toBeNull();
    expect(accountPostingMode({ ...draft, granted_scopes: ["video.publish"] }, "DRAFT", false, true)).toBeNull();
    expect(accountPostingMode({ ...draft, upload_status: "NOT_APPROVED" }, "DRAFT", false, true)).toBeNull();
    expect(accountPostingMode({ ...draft, authorization_status: "revoked" }, "DRAFT", false, true)).toBeNull();
    expect(accountPostingMode({ ...draft, authorization_status: "revoked" }, "EXPORT", false)).toBe("EXPORT");
  });
});
