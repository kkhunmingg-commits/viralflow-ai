import type { SupabaseClient } from "@supabase/supabase-js";
import { financeLedger, type LedgerOrder } from "./finance-ledger";

const baseColumns = "event_type,external_order_id,external_event_id,external_video_id,tiktok_account_id,product_id,gmv,estimated_commission,settled_commission,source,occurred_at";
/** Postgres "undefined column": the database predates the migration that added `channel`. */
const missingColumn = (error: { code?: string } | null) => error?.code === "42703";
/**
 * Imported Affiliate order events for the owner, paged so large histories are not cut off silently. A database without
 * the `channel` column (migration 20261020090000 not applied) still loads, with every order counted as UNKNOWN channel.
 */
export async function ownerOrderEvents(client: SupabaseClient, ownerId: string, since?: Date) {
  const rows: (LedgerOrder & { occurred_at: string })[] = [];
  let withChannel = true;
  for (let from = 0; ; from += 1000) {
    const columns: string = withChannel ? `channel,${baseColumns}` : baseColumns;
    let q = client.from("affiliate_conversion_events").select(columns).eq("owner_id", ownerId);
    if (since) q = q.gte("occurred_at", since.toISOString());
    const { data, error } = await q.order("occurred_at", { ascending: false }).order("id").range(from, from + 999);
    if (withChannel && missingColumn(error)) { withChannel = false; from -= 1000; continue; }
    if (error) throw new Error(`Finance query failed: ${error.message}`);
    const page = (data ?? []) as unknown as (LedgerOrder & { occurred_at: string })[];
    rows.push(...(withChannel ? page : page.map(o => ({ ...o, channel: "UNKNOWN" }))));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
export async function getFinanceLedger(client: SupabaseClient, ownerId: string) {
  return financeLedger(await ownerOrderEvents(client, ownerId));
}
