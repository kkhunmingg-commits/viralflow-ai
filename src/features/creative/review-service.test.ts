import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-env", () => ({ serverEnv: {} }));
import { approveEvidenceCreative } from "./services";
import { CREATIVE_STRATEGY_VERSION, planCreativeStrategy } from "./strategist";
import { creativeScriptDigest, reviewedProductionMethod } from "./production-gate";

type Row = Record<string, unknown>;
function fixture() {
  const plan = planCreativeStrategy({ now: new Date("2026-10-13T12:00:00Z"),
    account: { id: "pilot-account", mode: "AFFILIATE", affiliateEligible: true },
    product: { id: "product-1", title: "ถังปั่นไม้ถูพื้น", mechanism: "COMPLEX" }, facts: [],
    assets: [{ id: "reviewed-footage", kind: "REAL_FOOTAGE", source: "OWNER", reference: "reviewed-test-evidence-record",
      productId: "product-1", rightsConfirmed: true, reviewed: true, durationSeconds: 8 }] });
  const selected = plan.concepts.find(c => c.id === plan.selectedConceptId)!;
  const script = { id: "script-1", owner_id: "owner-1", creative_project_id: "project-1", creative_angle_id: "angle-1",
    version: CREATIVE_STRATEGY_VERSION, hook_text: selected.concept.hook, voice_script: selected.concept.voiceScript,
    cta_text: selected.concept.cta, caption: selected.concept.caption,
    scene_plan_json: selected.concept.scenePlan, overlay_text_json: selected.concept.overlayText };
  const angle: Row = { id: "angle-1", owner_id: "owner-1", creative_project_id: "project-1", policy_status: "REVIEW",
    score_explanation_json: { reasons: ["Existing explanation must survive approval"], productionStrategy: {
      plan, conceptId: selected.id, productId: "product-1", scriptDigest: creativeScriptDigest(script), review: null } } };
  const project = { id: "project-1", owner_id: "owner-1", tiktok_account_id: "pilot-account", product_id: "product-1" };
  return { script, angle, project, plan };
}

function clientFor(data: ReturnType<typeof fixture>, options: { authenticatedUser?: string | null; zeroUpdatedRows?: boolean } = {}) {
  const tables: Record<string, Row[]> = { creative_projects: [data.project], scripts: [data.script], creative_angles: [data.angle,
    { id: "other-angle", owner_id: "owner-2", creative_project_id: "other-project", policy_status: "REVIEW" }] };
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const writes: Array<{ table: string; values: Row; filters: Array<[string, unknown]> }> = [];
  const from = vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    let patch: Row | null = null, selected = "*";
    const query = {
      select(columns: string) { selected = columns; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(values: Row) { patch = values; return query; },
      async maybeSingle() {
        const rows = (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
        if (patch) {
          writes.push({ table, values: patch, filters: [...filters] });
          if (options.zeroUpdatedRows) return { data: null, error: null };
          for (const row of rows) Object.assign(row, patch);
        } else reads.push({ table, filters: [...filters] });
        const row = rows[0] ?? null;
        return { data: row && selected !== "*" ? Object.fromEntries(selected.split(",").map(key => [key, row[key]])) : row, error: null };
      },
    };
    return query;
  });
  const client = { from, auth: { getUser: vi.fn(async () => ({ data: { user:
    options.authenticatedUser === null ? null : { id: options.authenticatedUser ?? "owner-1" } }, error: null })) } };
  return { client: client as unknown as SupabaseClient, tables, reads, writes, from };
}
const allChecks = { creativeApproved: true, factualAccuracyApproved: true, mediaRightsApproved: true };
afterEach(() => vi.restoreAllMocks());

describe("authenticated human creative approval service", () => {
  it.each(["another-user", null])("rejects authenticated owner mismatch %s before reads or writes", async authenticatedUser => {
    const state = clientFor(fixture(), { authenticatedUser });
    await expect(approveEvidenceCreative(state.client, "owner-1", "project-1", "angle-1", "script-1", allChecks))
      .rejects.toThrow("HUMAN_CREATIVE_REVIEW_REQUIRED");
    expect(state.from).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it.each(["creativeApproved", "factualAccuracyApproved", "mediaRightsApproved"] as const)("requires explicit human %s", async field => {
    const state = clientFor(fixture());
    await expect(approveEvidenceCreative(state.client, "owner-1", "project-1", "angle-1", "script-1", { ...allChecks, [field]: false }))
      .rejects.toThrow("HUMAN_CREATIVE_REVIEW_REQUIRED");
    expect(state.writes).toEqual([]);
  });
  it("writes SAFE only on the owner's angle and persists a readable bound approval without network calls", async () => {
    const data = fixture(), state = clientFor(data);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN_IN_APPROVAL_TEST"));
    await approveEvidenceCreative(state.client, "owner-1", "project-1", "angle-1", "script-1", allChecks);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ table: "creative_angles", values: { policy_status: "SAFE" },
      filters: [["owner_id", "owner-1"], ["id", "angle-1"]] });
    expect(state.reads.every(read => read.filters.some(([key, value]) => key === "owner_id" && value === "owner-1"))).toBe(true);
    const saved = state.tables.creative_angles[0];
    expect(saved.policy_status).toBe("SAFE");
    expect(saved.score_explanation_json).toMatchObject({ reasons: ["Existing explanation must survive approval"], productionStrategy: {
      review: { ...allChecks, reviewedBy: "owner-1", fingerprint: data.plan.fingerprint, conceptId: data.plan.selectedConceptId } } });
    expect(state.tables.creative_angles[1].policy_status).toBe("REVIEW");
    expect(reviewedProductionMethod({ angle: saved, script: data.script, account: { id: "pilot-account" }, product: { id: "product-1" } }, "owner-1"))
      .toBe("REAL_FOOTAGE_EDIT");
    expect(network).not.toHaveBeenCalled();
  });
  it("does not report successful approval when the update affected zero rows", async () => {
    const data = fixture(), state = clientFor(data, { zeroUpdatedRows: true });
    await expect(approveEvidenceCreative(state.client, "owner-1", "project-1", "angle-1", "script-1", allChecks))
      .rejects.toThrow("CREATIVE_REVIEW_SAVE_FAILED");
    expect(data.angle.policy_status).toBe("REVIEW");
    expect(state.writes).toHaveLength(1);
  });
  it("rejects a changed script or a different-owned angle before saving approval", async () => {
    const changed = fixture(); changed.script.voice_script = "ข้อความใหม่หลังจัดทำแผน";
    const changedState = clientFor(changed);
    await expect(approveEvidenceCreative(changedState.client, "owner-1", "project-1", "angle-1", "script-1", allChecks))
      .rejects.toThrow("HUMAN_CREATIVE_REVIEW_REQUIRED");
    expect(changedState.writes).toEqual([]);
    const other = fixture(); other.angle.owner_id = "owner-2";
    const otherState = clientFor(other);
    await expect(approveEvidenceCreative(otherState.client, "owner-1", "project-1", "angle-1", "script-1", allChecks))
      .rejects.toThrow("Creative selection mismatch");
    expect(otherState.writes).toEqual([]);
  });
});
