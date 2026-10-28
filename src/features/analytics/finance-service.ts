import type { SupabaseClient } from "@supabase/supabase-js";
import { financeLedger, type LedgerOrder } from "./finance-ledger";

const columns = "channel,event_type,external_order_id,external_event_id,external_video_id,tiktok_account_id,product_id,gmv,estimated_commission,settled_commission,source,occurred_at";
/** Imported Affiliate order events for the owner, paged so large histories are not cut off silently. */
export async function ownerOrderEvents(client: SupabaseClient, ownerId: string, since?: Date) {
  const rows: (LedgerOrder & { occurred_at: string })[] = [];
  for (let from = 0; ; from += 1000) {
    let q = client.from("affiliate_conversion_events").select(columns).eq("owner_id", ownerId);
    if (since) q = q.gte("occurred_at", since.toISOString());
    const { data, error } = await q.order("occurred_at", { ascending: false }).order("id").range(from, from + 999);
    if (error) throw new Error(`Finance query failed: ${error.message}`);
    rows.push(...(data ?? []) as (LedgerOrder & { occurred_at: string })[]);
    if ((data?.length ?? 0) < 1000) return rows;
  }
}
export async function getFinanceLedger(client: SupabaseClient, ownerId: string) {
  return financeLedger(await ownerOrderEvents(client, ownerId));
}
