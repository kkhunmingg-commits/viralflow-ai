import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { creativeFixture } from "./fixtures";
import { readCreativeIntelligence } from "./intelligence-service";

type Row = Record<string, unknown>;
type Result = { data: Row[] | Row | null; error: { code: string } | null };
interface Query extends PromiseLike<Result> {
  select(columns: string): Query; eq(key: string, value: unknown): Query; in(key: string, values: unknown[]): Query;
  gte(key: string, value: string): Query; order(key: string, options: { ascending: boolean }): Query;
  limit(count: number): Query; maybeSingle(): Promise<Result>;
}
interface RecordedQuery { table: string; columns: string; filters: Array<{ key: string; kind: string; value: unknown }>; }
function memoryClient(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const queries: RecordedQuery[] = [];
  const client = { from(table: string): Query {
    const record: RecordedQuery = { table, columns: "*", filters: [] }; queries.push(record);
    let max = Infinity, ordering: { key: string; ascending: boolean } | null = null;
    const result = (single: boolean): Result => {
      if (errors[table]) return { data: null, error: { code: errors[table] } };
      let rows = [...(tables[table] ?? [])].filter(row => record.filters.every(f =>
        f.kind === "eq" ? row[f.key] === f.value : f.kind === "in" ? (f.value as unknown[]).includes(row[f.key])
          : typeof row[f.key] === "string" && String(row[f.key]) >= String(f.value)));
      if (ordering) {
        const o = ordering;
        rows = rows.toSorted((a, b) => String(a[o.key]).localeCompare(String(b[o.key])) * (o.ascending ? 1 : -1));
      }
      rows = rows.slice(0, max).map(row => record.columns === "*" ? row : Object.fromEntries(record.columns.split(",").map(key => [key, row[key]])));
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const query: Query = {
      select(columns) { record.columns = columns; return query; },
      eq(key, value) { record.filters.push({ key, kind: "eq", value }); return query; },
      in(key, value) { record.filters.push({ key, kind: "in", value }); return query; },
      gte(key, value) { record.filters.push({ key, kind: "gte", value }); return query; },
      order(key, options) { ordering = { key, ascending: options.ascending }; return query; },
      limit(count) { max = count; return query; },
      maybeSingle() { return Promise.resolve(result(true)); },
      then(onfulfilled, onrejected) { return Promise.resolve(result(false)).then(onfulfilled, onrejected); },
    };
    return query;
  } };
  return { client: client as unknown as SupabaseClient, queries };
}

const owner = "11111111-1111-4111-8111-111111111111", otherOwner = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-13T12:00:00Z");
function setup() {
  const context = creativeFixture("AFFILIATE", "home");
  context.account.id = "new-pilot"; context.product.id = "mop";
  const tables: Record<string, Row[]> = {
    tiktok_accounts: [{ id: "new-pilot", owner_id: owner, is_mock: false, authorization_status: "authorized" },
      { id: "old-sales", owner_id: owner, is_mock: false, authorization_status: "authorized" }],
    auto_account_discovery: [{ owner_id: owner, tiktok_account_id: "new-pilot", can_execute: true, affiliate_allowed: true,
      valid_until: "2026-10-13T15:00:00Z" }],
    media_assets: [{ id: "upload-1", owner_id: owner, product_id: "mop", asset_type: "VIDEO", source_type: "UPLOAD",
      storage_path: `owner/${owner}/products/mop/demo.mp4`, duration_seconds: 8,
      rightsConfirmed: true, reviewed: true },
    { id: "wrong-owner-path", owner_id: owner, product_id: "mop", asset_type: "VIDEO", source_type: "UPLOAD",
      storage_path: `owner/${otherOwner}/products/mop/demo.mp4`, duration_seconds: 8 },
    { id: "mock-1", owner_id: owner, product_id: "mop", asset_type: "PRODUCT_IMAGE", source_type: "MOCK",
      storage_path: `owner/${owner}/products/mop/mock.ppm` }],
    video_analytics_snapshots: [1, 2, 3].map(i => ({ id: `snapshot-${i}`, owner_id: owner, tiktok_account_id: "new-pilot",
      source: "TIKTOK_DISPLAY", video_kind: "MASTER", video_id: `video-${i}`, source_snapshot_at: "2026-10-13T10:00:00Z",
      views: 100 * i, likes: 10, comments: 2, shares: 3, favorites: null, clicks: null, orders: null, gmv: null, commission: null })),
    master_videos: [1, 2, 3].map(i => ({ id: `video-${i}`, owner_id: owner, tiktok_account_id: "new-pilot",
      creative_project_id: `project-${i}`, selected_script_id: `script-${i}`, created_at: "2026-10-13T08:00:00Z" })),
    creative_projects: [1, 2, 3].map(i => ({ id: `project-${i}`, owner_id: owner, tiktok_account_id: "new-pilot", mode: "AFFILIATE" })),
    scripts: [1, 2, 3].map(i => ({ id: `script-${i}`, owner_id: owner, creative_project_id: `project-${i}`,
      creative_angle_id: `angle-${i}`, hook_text: "จุดนี้ทำงานอย่างไร?", updated_at: "2026-10-13T07:00:00Z" })),
    creative_angles: [1, 2, 3].map(i => ({ id: `angle-${i}`, owner_id: owner, creative_project_id: `project-${i}`, angle_type: "DEMONSTRATION" })),
  };
  return { context, tables };
}

describe("existing creative service intelligence reads", () => {
  it("joins only owner/pilot account data and treats upload presence as unverified evidence", async () => {
    const { context, tables } = setup();
    tables.video_analytics_snapshots.push({ ...tables.video_analytics_snapshots[0], id: "old-account-row", tiktok_account_id: "old-sales" },
      { ...tables.video_analytics_snapshots[0], id: "cross-user-row", owner_id: otherOwner });
    const { client, queries } = memoryClient(tables);
    const result = await readCreativeIntelligence(client, owner, context, { now });
    expect(result.learning.sampleSize).toBe(3);
    expect(result.learning.evidenceIds).toEqual(["snapshot-1", "snapshot-2", "snapshot-3"]);
    expect(result.evidenceReadiness.availableAssetCount).toBe(1);
    expect(result.evidenceReadiness.verifiedProductFactCount).toBe(0);
    expect(result.strategy.concepts.every(c => c.status === "WAIT_FOR_EVIDENCE")).toBe(true);
    expect(result.paidCalls).toBe(0); expect(result.postingCalls).toBe(0);
    expect(queries.every(q => q.filters.some(f => f.key === "owner_id" && f.kind === "eq" && f.value === owner))).toBe(true);
    for (const table of ["video_analytics_snapshots", "master_videos", "creative_projects", "auto_account_discovery"]) {
      const query = queries.find(q => q.table === table)!;
      expect(query.filters).toContainEqual({ key: "tiktok_account_id", kind: "eq", value: "new-pilot" });
    }
    expect(queries.find(q => q.table === "media_assets")?.filters).toContainEqual({ key: "product_id", kind: "eq", value: "mop" });
  });
  it("confirms rights only from an approved, in-scope ledger record and cites only unrevoked evidence", async () => {
    const { context, tables } = setup();
    const record = { id: "rights-1", owner_id: owner, media_asset_id: "upload-1", product_id: "mop", origin_source: "OWNER_CREATED",
      asset_role: "REAL_FOOTAGE", allows_commercial: true, allows_edit: true, platform_scope: ["TIKTOK"], account_scope: null,
      review_state: "APPROVED", expires_at: null, revoked_at: null };
    const fact = { id: "fact-1", owner_id: owner, product_id: "mop", topic: null, statement: "ไม้ถูพื้นบิดน้ำได้ด้วยถังปั่น", source: "PDP",
      source_reference: "https://shop.example/mop", role: "SELLING_POINT", captured_at: "2026-10-12T00:00:00Z", revoked_at: null };
    const cases: Array<[Row, number]> = [[record, 1], [{ ...record, review_state: "PENDING" }, 0], [{ ...record, account_scope: ["old-sales"] }, 0],
      [{ ...record, product_id: "other-product" }, 0], [{ ...record, revoked_at: "2026-10-13T11:00:00Z" }, 0], [{ ...record, owner_id: otherOwner }, 0]];
    for (const [rights, cleared] of cases) {
      tables.media_asset_rights = [rights];
      tables.content_evidence = [fact, { ...fact, id: "fact-revoked", revoked_at: "2026-10-13T11:00:00Z" }, { ...fact, id: "fact-other", owner_id: otherOwner }];
      const { client } = memoryClient(tables);
      const result = await readCreativeIntelligence(client, owner, context, { now });
      expect(result.evidenceReadiness.rightsClearedAssetCount).toBe(cleared);
      expect(result.evidenceReadiness.verifiedProductFactCount).toBe(1);
      // A cleared owner clip is the only thing that moves the strategist off WAIT_FOR_EVIDENCE; a human review still follows.
      expect(result.strategy.concepts.some(c => c.production.method === "REAL_FOOTAGE_EDIT" && c.production.ready && c.status === "REVIEW_REQUIRED")).toBe(cleared === 1);
      expect(result.paidCalls).toBe(0); expect(result.postingCalls).toBe(0);
    }
  });
  it("stays fail-closed when the ledger tables are not migrated yet", async () => {
    const { context, tables } = setup();
    const { client } = memoryClient(tables, { media_asset_rights: "42P01", content_evidence: "42P01" });
    const result = await readCreativeIntelligence(client, owner, context, { now });
    expect(result.evidenceReadiness.rightsClearedAssetCount).toBe(0);
    expect(result.strategy.concepts.every(c => c.status === "WAIT_FOR_EVIDENCE")).toBe(true);
  });
  it.each(["not-opted-in", "expired", "mock-account", "revoked-account"])("does not read sales account Analytics when %s", async condition => {
    const { context, tables } = setup();
    if (condition === "not-opted-in") tables.auto_account_discovery[0].can_execute = false;
    if (condition === "expired") tables.auto_account_discovery[0].valid_until = "2026-10-12T00:00:00Z";
    if (condition === "mock-account") tables.tiktok_accounts[0].is_mock = true;
    if (condition === "revoked-account") tables.tiktok_accounts[0].authorization_status = "revoked";
    const { client, queries } = memoryClient(tables);
    const result = await readCreativeIntelligence(client, owner, context, { now });
    expect(queries.some(q => q.table === "video_analytics_snapshots")).toBe(false);
    expect(result.learning.status).toBe("UNKNOWN");
    expect(result.strategy.concepts.every(c => !c.production.ready)).toBe(true);
  });
  it("cannot attribute a selected script or angle from a different same-owner project", async () => {
    const { context, tables } = setup();
    tables.scripts[0].creative_project_id = "project-2";
    tables.creative_angles[1].creative_project_id = "project-3";
    const { client } = memoryClient(tables);
    const result = await readCreativeIntelligence(client, owner, context, { now });
    expect(result.learning.evidenceIds).toEqual(["snapshot-3"]);
    expect(result.learning.sampleSize).toBe(1);
  });
  it("does not reconstruct historical hooks after a script was changed", async () => {
    const { context, tables } = setup();
    tables.scripts[0].updated_at = "2026-10-13T09:00:00Z";
    const { client } = memoryClient(tables);
    const result = await readCreativeIntelligence(client, owner, context, { now });
    expect(result.learning.sampleSize).toBe(3);
    expect(result.learning.cohorts.every(c => c.videos === 2)).toBe(true);
    expect(result.learning.preferredHook).toBeNull();
  });
  it("treats absent optional account permission storage as unknown instead of authorizing learning", async () => {
    const { context, tables } = setup();
    const { client, queries } = memoryClient(tables, { auto_account_discovery: "42P01" });
    const result = await readCreativeIntelligence(client, owner, context, { now });
    expect(queries.some(q => q.table === "video_analytics_snapshots")).toBe(false);
    expect(result.learning.sampleSize).toBe(0);
  });
  it("fails closed for non-optional source errors and missing owned account", async () => {
    const { context, tables } = setup();
    await expect(readCreativeIntelligence(memoryClient(tables, { media_assets: "42501" }).client, owner, context, { now })).rejects.toThrow("CREATIVE_INTELLIGENCE_SOURCE_UNAVAILABLE");
    tables.tiktok_accounts = [];
    await expect(readCreativeIntelligence(memoryClient(tables).client, owner, context, { now })).rejects.toThrow("CREATIVE_INTELLIGENCE_SOURCE_UNAVAILABLE");
  });
});
