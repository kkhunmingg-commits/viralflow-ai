import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerOrderEvents } from "@/features/analytics/finance-service";
import { financeLedger } from "@/features/analytics/finance-ledger";
import { LIVE_POLICY, PRAEW_MAX_PRODUCTS, liveBlockStart, praewProducts, selectLiveLineup, type LiveCandidate, type PostedProduct, type PostedTikTokProduct, type PraewProduct } from "./live-director";

/** Products with real VIDEO sales in the window, each with its owner-verified facts; nothing is estimated. */
export async function liveCandidates(client: SupabaseClient, ownerId: string, now = new Date()): Promise<LiveCandidate[]> {
  const orders = (await ownerOrderEvents(client, ownerId, new Date(now.getTime() - LIVE_POLICY.salesWindowDays * 86400000)))
    .filter(o => o.channel === "VIDEO" && o.product_id);
  const ids = [...new Set(orders.map(o => o.product_id!))];
  if (!ids.length) return [];
  const [products, facts] = await Promise.all([
    client.from("products").select("id,title,current_price,image_url").eq("owner_id", ownerId).in("id", ids),
    client.from("content_evidence").select("product_id,statement").eq("owner_id", ownerId).in("product_id", ids).is("revoked_at", null),
  ]);
  // content_evidence arrives with migration 20261018120000; without it there are simply no verified facts yet.
  const factsMissing = facts.error && ["42P01", "PGRST205"].includes(facts.error.code ?? "");
  if (products.error || (facts.error && !factsMissing)) throw new Error("Live lineup query failed");
  return (products.data ?? []).map(p => {
    const own = orders.filter(o => o.product_id === p.id), ledger = financeLedger(own);
    return { productId: p.id, title: p.title, price: p.current_price === null ? null : Number(p.current_price),
      imageUrl: typeof p.image_url === "string" && p.image_url.startsWith("https://") ? p.image_url : null,
      videoOrders: ledger.video.orders, videoGmv: ledger.video.gmv, settledCommission: ledger.video.settledCommission,
      lastOrderAt: own.filter(o => o.event_type !== "ORDER_CANCELLED").map(o => o.occurred_at).sort().at(-1) ?? null,
      facts: (factsMissing ? [] : facts.data ?? []).filter(f => f.product_id === p.id).map(f => String(f.statement)) };
  });
}

/**
 * Products the owner approved for sale from Shopee / Lazada link clips (posted automatically, posting, or left to post by
 * hand). Their facts are the ones the owner kept from the product page.
 */
export async function postedProducts(client: SupabaseClient, ownerId: string, limit = 30): Promise<PostedProduct[]> {
  const result = await client.from("product_link_clips").select("platform,external_id,link,title,facts,image_paths,posts,reviewed_at,updated_at")
    .eq("owner_id", ownerId).in("status", ["APPROVED", "PUBLISHING", "PUBLISHED"]).order("reviewed_at", { ascending: false, nullsFirst: false }).limit(limit);
  // product_link_clips arrives with migration 20261108160000; without it nothing has been posted from a link yet.
  if (result.error) { if (["42P01", "PGRST205"].includes(result.error.code ?? "")) return []; throw new Error("Posted products query failed"); }
  return (result.data ?? []).map(r => ({
    key: `${r.platform}:${r.external_id ?? r.link}`, title: String(r.title), platform: r.platform === "LAZADA" ? "LAZADA" : "SHOPEE",
    facts: Array.isArray(r.facts) ? r.facts.map(String) : [], approvedAt: String(r.reviewed_at ?? r.updated_at),
    imagePath: Array.isArray(r.image_paths) && typeof r.image_paths[0] === "string" ? r.image_paths[0] : null,
    postedOn: Array.isArray(r.posts) ? r.posts.filter((p: { status?: string }) => p?.status === "DONE").length : 0,
  }));
}

/**
 * TikTok Shop products the owner already posted clips for (Flow farm AFFILIATE clips that reached POSTED), newest first,
 * with the price and photo from the product record and any owner-kept facts.
 */
export async function postedTikTokProducts(client: SupabaseClient, ownerId: string, limit = 12): Promise<PostedTikTokProduct[]> {
  const clips = await client.from("flow_clips").select("product_id,posted_at").eq("owner_id", ownerId).eq("kind", "AFFILIATE")
    .eq("status", "POSTED").not("product_id", "is", null).order("posted_at", { ascending: false }).limit(200);
  if (clips.error) { if (["42P01", "PGRST205"].includes(clips.error.code ?? "")) return []; throw new Error("Posted TikTok products query failed"); }
  const lastPost = new Map<string, string>();
  for (const c of clips.data ?? []) if (c.product_id && !lastPost.has(c.product_id)) lastPost.set(c.product_id, String(c.posted_at));
  const ids = [...lastPost.keys()].slice(0, limit);
  if (!ids.length) return [];
  const [products, facts] = await Promise.all([
    client.from("products").select("id,title,current_price,image_url,status").eq("owner_id", ownerId).in("id", ids),
    client.from("content_evidence").select("product_id,statement").eq("owner_id", ownerId).in("product_id", ids).is("revoked_at", null),
  ]);
  const factsMissing = facts.error && ["42P01", "PGRST205"].includes(facts.error.code ?? "");
  if (products.error || (facts.error && !factsMissing)) throw new Error("Posted TikTok products query failed");
  return (products.data ?? []).filter(p => p.status !== "discontinued").map(p => ({
    productId: p.id, title: p.title, price: p.current_price === null ? null : Number(p.current_price), postedAt: lastPost.get(p.id) ?? "",
    imageUrl: typeof p.image_url === "string" && p.image_url.startsWith("https://") ? p.image_url : null,
    facts: (factsMissing ? [] : facts.data ?? []).filter(f => f.product_id === p.id).map(f => String(f.statement)),
  }));
}

/** Everything Praew's product list is made from, read once. */
export async function praewSources(client: SupabaseClient, ownerId: string, now = new Date()) {
  const blockStart = liveBlockStart(now);
  const [candidates, posted, postedTikTok] = await Promise.all([liveCandidates(client, ownerId, blockStart), postedProducts(client, ownerId),
    postedTikTokProducts(client, ownerId)]);
  return { blockStart, candidates, posted, postedTikTok, lineup: selectLiveLineup(candidates, blockStart) };
}

/**
 * The products Praew presents right now: TikTok Shop best-sellers of this 4-hour block, then TikTok Shop products with
 * posted clips, then the newest posted link-clip products.
 */
export async function praewFeed(client: SupabaseClient, ownerId: string, now = new Date()): Promise<PraewProduct[]> {
  const s = await praewSources(client, ownerId, now);
  return praewProducts(s.lineup, s.candidates, s.posted, PRAEW_MAX_PRODUCTS, s.postedTikTok);
}
