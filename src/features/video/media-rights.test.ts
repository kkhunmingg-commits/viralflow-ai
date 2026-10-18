import { describe, expect, it } from "vitest";
import { mediaRightsViolations, strategyAssetFromLedger, strategyFactFromEvidence, type MediaRightsRecord } from "./media-rights";

const at = new Date("2026-10-18T12:00:00Z"), use = { at, accountId: "pilot" };
const record: MediaRightsRecord = { id: "r1", media_asset_id: "a1", product_id: "p1", origin_source: "OWNER_CREATED", asset_role: "REAL_FOOTAGE",
  allows_commercial: true, allows_edit: true, platform_scope: ["TIKTOK"], account_scope: null, review_state: "APPROVED", expires_at: null, revoked_at: null };
const asset = { id: "a1", product_id: "p1", asset_type: "VIDEO", source_type: "UPLOAD", storage_path: "owner/x/a1.mp4", duration_seconds: 8 };

// Same cases as scripts/verify-media-rights-sql.mjs so the app view matches the publish-time SQL gate.
describe("media rights ledger", () => {
  it("allows a fully attested, reviewed record", () => expect(mediaRightsViolations(record, use)).toEqual([]));
  it.each<[Partial<MediaRightsRecord>, string]>([
    [{ review_state: "PENDING" }, "NOT_APPROVED"], [{ review_state: "REJECTED" }, "NOT_APPROVED"],
    [{ expires_at: "2026-10-17T00:00:00Z" }, "EXPIRED"], [{ expires_at: "not-a-date" }, "EXPIRED"],
    [{ allows_commercial: false }, "COMMERCIAL_NOT_ALLOWED"], [{ allows_edit: false }, "EDIT_NOT_ALLOWED"],
    [{ platform_scope: ["INSTAGRAM"] }, "PLATFORM_OUT_OF_SCOPE"], [{ account_scope: ["other"] }, "ACCOUNT_OUT_OF_SCOPE"],
    [{ revoked_at: "2026-10-18T11:00:00Z" }, "REVOKED"],
  ])("blocks %o with %s", (change, reason) => expect(mediaRightsViolations({ ...record, ...change }, use)).toContain(reason));
  it("treats a missing record and future-dated limits correctly", () => {
    expect(mediaRightsViolations(undefined, use)).toEqual(["NO_RIGHTS_RECORD"]);
    expect(mediaRightsViolations({ ...record, expires_at: "2026-10-19T00:00:00Z", revoked_at: "2026-10-19T00:00:00Z", account_scope: ["pilot"] }, use)).toEqual([]);
  });
  it("confirms a strategy asset only for a clean record of the same product", () => {
    expect(strategyAssetFromLedger(asset, record, use)).toMatchObject({ kind: "REAL_FOOTAGE", source: "OWNER", rightsConfirmed: true, reviewed: true });
    expect(strategyAssetFromLedger(asset, undefined, use)).toMatchObject({ kind: "REAL_FOOTAGE", rightsConfirmed: false, reviewed: false });
    expect(strategyAssetFromLedger(asset, { ...record, product_id: "p2" }, use)?.rightsConfirmed).toBe(false);
    expect(strategyAssetFromLedger(asset, { ...record, allows_edit: false }, use)?.rightsConfirmed).toBe(false);
    expect(strategyAssetFromLedger(asset, { ...record, asset_role: "MUSIC" }, use)).toBeNull();
  });
  it("marks evidence unverified once revoked", () => {
    const row = { id: "f1", product_id: "p1", topic: null, statement: "s", source: "PDP" as const, source_reference: "ref", role: null,
      captured_at: "2026-10-01T00:00:00Z", revoked_at: null };
    expect(strategyFactFromEvidence(row, at)).toMatchObject({ verified: true, productId: "p1", reference: "ref" });
    expect(strategyFactFromEvidence({ ...row, revoked_at: "2026-10-18T00:00:00Z" }, at).verified).toBe(false);
  });
});
