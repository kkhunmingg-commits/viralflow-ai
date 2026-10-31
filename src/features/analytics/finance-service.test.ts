import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerOrderEvents } from "./finance-service";

const order = { event_type: "ORDER_CREATED", external_order_id: "o1", external_event_id: "e1", product_id: "p1", gmv: 100, estimated_commission: 10, settled_commission: null, occurred_at: "2026-10-27T00:00:00Z" };
/** A fake client whose database may lack the `channel` column, as production did before migration 20261020090000. */
function client(hasChannel: boolean) {
  const selects: string[] = [];
  const chain = (columns: string) => {
    const result = !hasChannel && columns.includes("channel")
      ? { data: null, error: { code: "42703", message: "column affiliate_conversion_events.channel does not exist" } }
      : { data: [hasChannel ? { ...order, channel: "VIDEO" } : order], error: null };
    const q = { eq: () => q, gte: () => q, order: () => q, range: async () => result };
    return q;
  };
  return { selects, from: () => ({ select: (columns: string) => { selects.push(columns); return chain(columns); } }) } as unknown as SupabaseClient & { selects: string[] };
}

describe("ownerOrderEvents", () => {
  it("reads the channel when the column exists", async () => {
    const rows = await ownerOrderEvents(client(true), "owner");
    expect(rows.map(r => r.channel)).toEqual(["VIDEO"]);
  });
  it("still loads, as UNKNOWN channel, on a database without the channel column", async () => {
    const c = client(false);
    const rows = await ownerOrderEvents(c, "owner");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "UNKNOWN", external_order_id: "o1" });
    expect(c.selects).toHaveLength(2);
  });
});
