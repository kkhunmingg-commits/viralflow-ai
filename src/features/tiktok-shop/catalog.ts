import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProductClip } from "@/features/product-links/service";
import type { ClipLength } from "@/features/product-links/script";
import { cleanItems, factsFromTitle, tiktokImageUrl, tiktokProductUrl } from "./items";

/** One TikTok Shop product as the owner's list shows it. */
export interface TikTokShopProduct {
  id: string; product_id: string; title: string; shop_name: string | null; category: string | null;
  price: number | null; original_price: number | null; sold_count: number | null; rating: number | null; review_count: number | null;
  image_url: string | null; product_url: string; seen_at: string; picked_at: string | null; live: boolean; clip_id: string | null;
  commission: number | null; stock: number | null; in_showcase: boolean;
}
const COLUMNS = "id,product_id,title,shop_name,category,price,original_price,sold_count,rating,review_count,image_url,product_url,seen_at,picked_at,live,clip_id,commission,stock,in_showcase";
const missingTable = (error: { code?: string } | null) => !!error && ["42P01", "PGRST205"].includes(error.code ?? "");
const num = (v: unknown) => v === null || v === undefined ? null : Number(v);
const row = (r: Record<string, unknown>): TikTokShopProduct => ({ ...(r as unknown as TikTokShopProduct),
  price: num(r.price), original_price: num(r.original_price), sold_count: num(r.sold_count), rating: num(r.rating), review_count: num(r.review_count),
  commission: num(r.commission), stock: num(r.stock), in_showcase: r.in_showcase === true });

/**
 * Saves a pull from TikTok Shop: new products are added, known ones get today's numbers (the owner's picks stay).
 * Only what this read saw is written: a shop page has sales but no commission, the showcase has commission but no
 * sales, so neither wipes the other's numbers. A showcase read also clears the mark on products no longer in it.
 */
export async function importTikTokProducts(admin: SupabaseClient, owner: string, raw: readonly unknown[], now = new Date()) {
  const items = cleanItems(raw).slice(0, 2500);
  if (!items.length) return { saved: 0 };
  const at = now.toISOString();
  const rows = items.map(i => {
    const row: Record<string, unknown> = { owner_id: owner, product_id: i.productId, title: i.title, product_url: tiktokProductUrl(i), seen_at: at, updated_at: at };
    const image = tiktokImageUrl(i.image);
    if (image) row.image_url = image;
    if (i.shopName != null) row.shop_name = i.shopName;
    if (i.category != null) row.category = i.category;
    if (i.price != null) row.price = i.price;
    if (i.originalPrice != null) row.original_price = i.originalPrice;
    if (i.sold != null) row.sold_count = i.sold;
    if (i.rating != null) row.rating = i.rating;
    if (i.reviews != null) row.review_count = i.reviews;
    if (i.commission != null) row.commission = i.commission;
    if (i.stock != null) row.stock = i.stock;
    if (i.showcase) { row.in_showcase = true; row.showcase_seen_at = at; }
    return row;
  });
  // One upsert per set of columns, so a missing number is left as it was rather than written as null.
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) { const key = Object.keys(row).sort().join(","); groups.set(key, [...(groups.get(key) ?? []), row]); }
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += 200) {
      const result = await admin.from("tiktok_shop_products").upsert(group.slice(i, i + 200), { onConflict: "owner_id,product_id" });
      if (result.error) throw new Error(missingTable(result.error) ? "TIKTOK_TABLE_MISSING" : "TIKTOK_PRODUCTS_NOT_SAVED");
    }
  }
  return { saved: rows.length };
}

/** After a full showcase read (saved in parts within minutes): products it did not list are not in the showcase any more. */
export async function closeShowcaseRead(admin: SupabaseClient, owner: string, now = new Date()) {
  const before = new Date(now.getTime() - 15 * 60_000).toISOString();
  const result = await admin.from("tiktok_shop_products").update({ in_showcase: false }).eq("owner_id", owner).eq("in_showcase", true).lt("showcase_seen_at", before);
  if (result.error) throw new Error("TIKTOK_PRODUCTS_NOT_SAVED");
}

/** The owner's TikTok Shop products, best-selling first (picked ones are listed by the page separately). */
export async function listTikTokProducts(client: SupabaseClient, owner: string, limit = 300,
  { sort = "sold", commissionOnly = false }: { sort?: "sold" | "commission"; commissionOnly?: boolean } = {}) {
  let query = client.from("tiktok_shop_products").select(COLUMNS).eq("owner_id", owner);
  if (commissionOnly) query = query.eq("in_showcase", true).gt("commission", 0);
  query = sort === "commission"
    ? query.order("commission", { ascending: false, nullsFirst: false }).order("sold_count", { ascending: false, nullsFirst: false })
    : query.order("sold_count", { ascending: false, nullsFirst: false }).order("commission", { ascending: false, nullsFirst: false });
  const result = await query.limit(limit);
  if (result.error) { if (missingTable(result.error)) return { available: false, products: [] as TikTokShopProduct[] }; throw new Error("TIKTOK_PRODUCTS_UNAVAILABLE"); }
  return { available: true, products: (result.data ?? []).map(r => row(r as Record<string, unknown>)) };
}

/** The products Praew presents in the TikTok LIVE: the owner's picks that are switched on, newest pick first. */
export async function liveTikTokPicks(client: SupabaseClient, owner: string, limit = 12) {
  const result = await client.from("tiktok_shop_products").select(COLUMNS).eq("owner_id", owner).eq("live", true)
    .order("picked_at", { ascending: false, nullsFirst: false }).limit(limit);
  if (result.error) { if (missingTable(result.error)) return []; throw new Error("TIKTOK_PICKS_UNAVAILABLE"); }
  const picks = (result.data ?? []).map(r => row(r as Record<string, unknown>));
  // The facts the clip kept are what Praew may say about it too.
  const clipIds = picks.map(p => p.clip_id).filter((v): v is string => !!v);
  const clips = clipIds.length ? await client.from("product_link_clips").select("id,facts,image_paths").eq("owner_id", owner).in("id", clipIds) : { data: [] };
  const byClip = new Map(((clips.data ?? []) as Array<{ id: string; facts: unknown; image_paths: unknown }>).map(c => [c.id, c]));
  return picks.map(p => {
    const clip = p.clip_id ? byClip.get(p.clip_id) : undefined;
    const facts = Array.isArray(clip?.facts) ? clip.facts.map(String) : factsFromTitle(p.title);
    const imagePath = Array.isArray(clip?.image_paths) && typeof clip.image_paths[0] === "string" ? clip.image_paths[0] : null;
    return { ...p, facts, imagePath };
  });
}
/** What the LIVE Manager tab needs: each switched-on pick's TikTok product id, link and title, newest pick first. */
export async function liveBasket(client: SupabaseClient, owner: string, limit = 20) {
  const result = await client.from("tiktok_shop_products").select("product_id,title").eq("owner_id", owner).eq("live", true)
    .order("picked_at", { ascending: false, nullsFirst: false }).limit(limit);
  if (result.error) { if (missingTable(result.error)) return []; throw new Error("TIKTOK_PICKS_UNAVAILABLE"); }
  // LIVE Manager's "Product URL" box was checked (26 Nov) to accept this plain form; slugged links are not promised.
  return ((result.data ?? []) as Array<{ product_id: string; title: string }>)
    .map(r => ({ productId: r.product_id, url: tiktokProductUrl({ productId: r.product_id, url: null }), title: r.title }));
}
export type TikTokPick = Awaited<ReturnType<typeof liveTikTokPicks>>[number];

export async function setTikTokLive(admin: SupabaseClient, owner: string, ids: string[], live: boolean, now = new Date()) {
  if (!ids.length) return;
  const at = now.toISOString();
  const result = await admin.from("tiktok_shop_products").update({ live, updated_at: at, ...(live ? { picked_at: at } : {}) }).eq("owner_id", owner).in("id", ids);
  if (result.error) throw new Error("TIKTOK_PRODUCTS_NOT_SAVED");
}

/**
 * The owner picked these best-sellers: each one gets an automatic clip (same Flow pipeline as the link clips, TikTok
 * wording: "กดตะกร้าสีส้ม") and goes into Praew's live list. A product that already has a clip only goes into the live.
 */
export async function pickTikTokProducts(admin: SupabaseClient, owner: string, input: { ids: string[]; tiktokAccountId: string; lengthSeconds: ClipLength; makeClips: boolean },
  now = new Date()) {
  const result = await admin.from("tiktok_shop_products").select(COLUMNS).eq("owner_id", owner).in("id", input.ids.slice(0, 20));
  if (result.error) throw new Error("TIKTOK_PRODUCTS_UNAVAILABLE");
  const products = (result.data ?? []).map(r => row(r as Record<string, unknown>));
  let made = 0; const failed: string[] = [];
  for (const p of products) {
    let clipId = p.clip_id;
    if (input.makeClips && !clipId) {
      try {
        const clip = await createProductClip(admin, owner, { tiktokAccountId: input.tiktokAccountId, platform: "TIKTOK", source: "TIKTOK_SHOP", link: p.product_url,
          productUrl: p.product_url, externalId: p.product_id, title: p.title, facts: factsFromTitle(p.title), lengthSeconds: input.lengthSeconds,
          imageUrls: p.image_url ? [p.image_url] : [], uploads: [] }, now);
        clipId = clip.id; made++;
      } catch { failed.push(p.title.slice(0, 40)); }
    }
    const at = now.toISOString();
    await admin.from("tiktok_shop_products").update({ live: true, picked_at: at, updated_at: at, ...(clipId ? { clip_id: clipId } : {}) }).eq("owner_id", owner).eq("id", p.id);
  }
  return { picked: products.length, made, failed };
}
