import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerOrderEvents } from "@/features/analytics/finance-service";
import { financeLedger } from "@/features/analytics/finance-ledger";
import { LIVE_POLICY, type LiveCandidate } from "./live-director";

/** Products with real VIDEO sales in the window, each with its owner-verified facts; nothing is estimated. */
export async function liveCandidates(client: SupabaseClient, ownerId: string, now = new Date()): Promise<LiveCandidate[]> {
  const orders = (await ownerOrderEvents(client, ownerId, new Date(now.getTime() - LIVE_POLICY.salesWindowDays * 86400000)))
    .filter(o => o.channel === "VIDEO" && o.product_id);
  const ids = [...new Set(orders.map(o => o.product_id!))];
  if (!ids.length) return [];
  const [products, facts] = await Promise.all([
    client.from("products").select("id,title,current_price").eq("owner_id", ownerId).in("id", ids),
    client.from("content_evidence").select("product_id,statement").eq("owner_id", ownerId).in("product_id", ids).is("revoked_at", null),
  ]);
  // content_evidence arrives with migration 20261018120000; without it there are simply no verified facts yet.
  const factsMissing = facts.error && ["42P01", "PGRST205"].includes(facts.error.code ?? "");
  if (products.error || (facts.error && !factsMissing)) throw new Error("Live lineup query failed");
  return (products.data ?? []).map(p => {
    const own = orders.filter(o => o.product_id === p.id), ledger = financeLedger(own);
    return { productId: p.id, title: p.title, price: p.current_price === null ? null : Number(p.current_price),
      videoOrders: ledger.video.orders, videoGmv: ledger.video.gmv, settledCommission: ledger.video.settledCommission,
      lastOrderAt: own.filter(o => o.event_type !== "ORDER_CANCELLED").map(o => o.occurred_at).sort().at(-1) ?? null,
      facts: (factsMissing ? [] : facts.data ?? []).filter(f => f.product_id === p.id).map(f => String(f.statement)) };
  });
}
