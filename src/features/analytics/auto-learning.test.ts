import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAutoLearning } from "./auto-learning";

type Row = Record<string, unknown>;
class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private write: Row | null = null;
  constructor(private rows: Record<string, Row[]>, private table: string) {}
  select(fields: string) { void fields; return this; }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this; }
  upsert(value: Row, options: unknown) { void options; this.write = value; return this; }
  insert(value: Row) { this.write = value; return this; }
  private result(single: boolean) {
    if (this.write) {
      const row: Row = { id: `${this.table}-${this.rows[this.table].length + 1}`,
        ...(this.table === "learning_decisions" ? { decision_version: "learning-loop-v1" } : {}), ...this.write };
      const existing = this.rows[this.table].find(previous => previous.owner_id === row.owner_id
        && previous.tiktok_account_id === row.tiktok_account_id
        && previous.evidence_hash === row.evidence_hash);
      if (existing && this.table === "growth_account_snapshots") {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      if (existing) return { data: null, error: null };
      this.rows[this.table].push(row);
      return { data: single ? row : [row], error: null };
    }
    const found = this.rows[this.table].filter(row => this.filters.every(filter => filter(row)));
    return { data: single ? found[0] ?? null : found, error: null };
  }
  single() { return Promise.resolve(this.result(true)); }
  maybeSingle() { return Promise.resolve(this.result(true)); }
  then<TResult1 = unknown, TResult2 = never>(onfulfilled?: ((value: {data: Row[];error: null}) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.result(false) as {data: Row[];error: null}).then(onfulfilled, onrejected);
  }
}
function fixture() {
  const rows: Record<string, Row[]> = {
    winner_scores: [{ id: "winner-1", owner_id: "owner-1", tiktok_account_id: "account-1",
      video_snapshot_id: "snapshot-1", decision: "SCALE", confidence: .8, final_score: 72,
      evaluated_at: "2026-09-23T10:00:00Z" }],
    learning_decisions: [], growth_account_snapshots: [],
    tiktok_accounts: [{ id: "account-1", owner_id: "owner-1", follower_count: 1000 }],
  };
  return { rows, admin: { from: (table: string) => new Query(rows, table) } as unknown as SupabaseClient };
}
const input = { ownerId: "owner-1", accountId: "account-1", winnerScoreId: "winner-1",
  productId: "product-1", mode: "GROWTH" as const };

describe("analytics learning after a resumed Auto step", () => {
  it("reuses the exact decision and Growth snapshot after a crash/retry", async () => {
    const { rows, admin } = fixture();
    const first = await recordAutoLearning(admin, input);
    const repeated = await recordAutoLearning(admin, input);
    expect(repeated).toEqual(first);
    expect(first?.learningDecision).toBe("BOOST");
    expect(rows.learning_decisions).toHaveLength(1);
    expect(rows.growth_account_snapshots).toHaveLength(1);
  });

  it("keeps Affiliate learning separate and blocks cross-account score references", async () => {
    const { rows, admin } = fixture();
    expect(await recordAutoLearning(admin, { ...input, accountId: "account-2" })).toBeNull();
    const affiliate = await recordAutoLearning(admin, { ...input, mode: "AFFILIATE" });
    expect(affiliate?.learningDecision).toBe("BOOST");
    expect(rows.learning_decisions).toHaveLength(1);
    expect(rows.growth_account_snapshots).toHaveLength(0);
  });
});
