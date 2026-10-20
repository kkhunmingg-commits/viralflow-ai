import { describe, expect, it } from "vitest";
import { bankAcceptance, bankCostSummary, bankHashtags, creativeFingerprint, isTestProduct, isTestRights, machineCostEstimate, planBankSlot, publishDecision } from "./policy";
import { postingRoute } from "./service";

const pass = [{ name: "DURATION", passed: true }, { name: "PACING", passed: true }];
const ok = { masterStatus: "READY", qualityStatus: "PASS", checks: pass, rightsViolations: [], duplicateOf: null, narrationKind: "SYSTEM_TTS" };

describe("content bank policy", () => {
  it("accepts only a passing, rights-clear, unique master and says why otherwise", () => {
    expect(bankAcceptance(ok)).toEqual({ accepted: true, reasons: [] });
    expect(bankAcceptance({ ...ok, qualityStatus: "RETRY", checks: [{ name: "VOICE", passed: false }], rightsViolations: ["ACCOUNT_OUT_OF_SCOPE"], duplicateOf: "x" }).reasons)
      .toEqual(["QUALITY_RETRY", "CHECK_FAILED:VOICE", "EDIT_CHECKS_MISSING", "RIGHTS:ACCOUNT_OUT_OF_SCOPE", "DUPLICATE_OF:x"]);
  });
  it("sends a clip that fell back to captions back for another render", () => {
    expect(bankAcceptance({ ...ok, narrationKind: "CAPTION_ONLY" }).reasons).toEqual(["NARRATION_FELL_BACK_TO_CAPTIONS"]);
  });
  it("treats the same lines as the same clip regardless of spacing", () => {
    expect(creativeFingerprint(["ทายดู  ขวด", "เฉลย"])).toBe(creativeFingerprint(["ทายดู ขวด", " เฉลย "]));
    expect(creativeFingerprint(["a", "b"])).not.toBe(creativeFingerprint(["b", "a"]));
  });
  it("merges account categories into hashtags without duplicates", () => {
    expect(bankHashtags(["#สาระน่ารู้", "ขวด"], ["ของใช้ในบ้าน", "#สาระน่ารู้"])).toEqual(["#สาระน่ารู้", "#ขวด", "#ของใช้ในบ้าน"]);
  });
  it("uses learned audience minutes when the account has them and labels defaults otherwise", () => {
    const now = new Date("2026-10-18T05:00:00Z"); // 12:00 in Bangkok
    const learned = planBankSlot({ now, timeZone: "Asia/Bangkok", audienceMinutes: [20 * 60], taken: [], minGapMinutes: 180, dailyTarget: 2 });
    expect(learned).toEqual({ at: new Date("2026-10-18T13:00:00Z"), basis: "AUDIENCE_DATA" });
    const fallback = planBankSlot({ now, timeZone: "Asia/Bangkok", audienceMinutes: [], taken: [], minGapMinutes: 180, dailyTarget: 2 });
    expect(fallback).toEqual({ at: new Date("2026-10-18T12:30:00Z"), basis: "DEFAULT_NO_DATA" });
    // A taken slot pushes the next clip to the next free one, respecting the per-day target.
    const next = planBankSlot({ now, timeZone: "Asia/Bangkok", audienceMinutes: [], taken: [fallback.at!], minGapMinutes: 180, dailyTarget: 1 });
    expect(next.at).toEqual(new Date("2026-10-19T05:15:00Z"));
  });
  it("keeps billed cost and machine estimates apart and counts rejects against usable clips", () => {
    expect(machineCostEstimate(120, null).thb).toBeNull();
    expect(machineCostEstimate(360, 6).thb).toBe(0.6);
    expect(bankCostSummary([{ status: "ACCEPTED", cost_actual_usd: 0, cost_estimated_thb: .5 }, { status: "REJECTED", cost_actual_usd: 0, cost_estimated_thb: .5 }], 36))
      .toEqual({ attempts: 2, usable: 1, rejected: 1, actualUsd: 0, actualThbPerUsable: 0, estimatedThbPerUsable: 1 });
  });
  it("routes to the posting API only for an audited, enabled runtime", () => {
    expect(postingRoute(null)).toBe("MANUAL_EXPORT");
    expect(postingRoute({ enabled: true, execution_mode: "ENABLED", publishing_enabled: true, app_audit_status: "IN_REVIEW" })).toBe("MANUAL_EXPORT");
    expect(postingRoute({ enabled: true, execution_mode: "ENABLED", publishing_enabled: true, app_audit_status: "AUDITED" })).toBe("AUTO_API");
  });
});

describe("publish decision", () => {
  const rights = (over = {}) => ({ allowsCommercial: true, allowsPromotion: true, testOnly: false, ...over });
  it("leaves a clean clip for the owner to review, never ready by itself", () => {
    expect(publishDecision({ accepted: true, contentType: "GROWTH", accountIsMock: false, testProduct: true, mediaRights: [], graphicOnly: true }))
      .toEqual({ decision: "PENDING_REVIEW", blockers: [] });
  });
  it("blocks affiliate clips of test products and test media", () => {
    const d = publishDecision({ accepted: true, contentType: "AFFILIATE", accountIsMock: false, testProduct: true, mediaRights: [rights({ testOnly: true })], graphicOnly: false });
    expect(d.decision).toBe("DO_NOT_PUBLISH");
    expect(d.blockers).toEqual(["TEST_PRODUCT_MEDIA_NOT_FOR_PUBLISHING", "TEST_MEDIA_NOT_FOR_PUBLISHING"]);
  });
  it("blocks rejected renders, missing rights and rights that do not cover promotion", () => {
    expect(publishDecision({ accepted: false, contentType: "GROWTH", accountIsMock: false, testProduct: false, mediaRights: [], graphicOnly: true }).blockers).toEqual(["MACHINE_REJECTED"]);
    expect(publishDecision({ accepted: true, contentType: "AFFILIATE", accountIsMock: false, testProduct: false, mediaRights: [], graphicOnly: false }).blockers).toEqual(["NO_MEDIA_RIGHTS_EVIDENCE"]);
    expect(publishDecision({ accepted: true, contentType: "AFFILIATE", accountIsMock: false, testProduct: false, mediaRights: [rights({ allowsPromotion: false })], graphicOnly: false }).blockers).toEqual(["MEDIA_RIGHTS_DO_NOT_COVER_USE"]);
  });
  it("recognises test products and test rights records", () => {
    expect(isTestProduct({ external_provider: "pilot-mock" })).toBe(true);
    expect(isTestProduct({ external_provider: "tiktok_shop", provider_metadata: {} })).toBe(false);
    expect(isTestRights("System-drawn test media. Fictional product, not for publishing.")).toBe(true);
  });
});
