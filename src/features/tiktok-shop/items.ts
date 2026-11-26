import { z } from "zod";

/**
 * TikTok Shop best-sellers as the ViralFlow Chrome extension reads them from TikTok Shop's own web pages
 * (shop.tiktok.com/th, its category pages and search) in the owner's Chrome. Every number is what TikTok Shop shows;
 * nothing is estimated. Pure (zod only).
 */
const httpsUrl = z.string().trim().max(2000).refine(v => { try { return new URL(v).protocol === "https:"; } catch { return false; } });
const count = z.coerce.number().finite().nonnegative().max(1e12).transform(v => Math.round(v));
const money = z.coerce.number().finite().nonnegative().max(1e9);

export const shopItemSchema = z.object({
  productId: z.string().trim().regex(/^\d{6,30}$/),
  title: z.string().trim().min(1).max(300),
  shopName: z.string().trim().max(120).nullish(),
  price: money.nullish(),
  originalPrice: money.nullish(),
  sold: count.nullish(),
  rating: z.coerce.number().min(0).max(5).nullish(),
  reviews: count.nullish(),
  image: httpsUrl.nullish(),
  url: httpsUrl.nullish(),
  category: z.string().trim().max(80).nullish(),
});
export type ShopItem = z.infer<typeof shopItemSchema>;
export const importSchema = z.object({ items: z.array(z.unknown()).max(2000), page: z.string().max(2000).optional() });

/** Only TikTok Shop's own pages are kept as a product link. */
export function tiktokProductUrl(item: Pick<ShopItem, "productId" | "url">) {
  try {
    const url = new URL(item.url ?? "");
    if (url.protocol === "https:" && /(^|\.)tiktok\.com$/i.test(url.hostname) && url.pathname.includes(item.productId)) return `${url.origin}${url.pathname}`.slice(0, 2000);
  } catch { /* fall through */ }
  return `https://shop.tiktok.com/th/pdp/${item.productId}`;
}
/** Listing photos only from TikTok's image hosts. */
export function tiktokImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && /(^|\.)(ibyteimg\.com|byteimg\.com|tiktokcdn\.com|tiktokcdn-[a-z]+\.com)$/i.test(url.hostname) ? value.slice(0, 2000) : null;
  } catch { return null; }
}

/** Valid items only, one per product (the one with the most sales wins), best-selling first. */
export function cleanItems(raw: readonly unknown[]): ShopItem[] {
  const byId = new Map<string, ShopItem>();
  for (const r of raw) {
    const parsed = shopItemSchema.safeParse(r);
    if (!parsed.success) continue;
    const item = { ...parsed.data, title: parsed.data.title.replace(/\s+/g, " ") };
    const had = byId.get(item.productId);
    if (!had || (item.sold ?? 0) > (had.sold ?? 0)) byId.set(item.productId, item);
  }
  return [...byId.values()].sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0));
}

/**
 * What the clip may say about a TikTok Shop product. TikTok Shop's product page is not served to the web in Thailand,
 * so the listing title is all there is: its descriptive phrases ("มี 6 ขนาดให้เลือก", "กันน้ำ") are the facts; the
 * clip script screens them again for claims. Prices and sales numbers are never facts (they change).
 */
export function factsFromTitle(title: string, max = 4): string[] {
  // Thai is written without spaces between words, so each spaced chunk of a Thai title is a phrase; short tokens
  // ("มี", "6") and Latin words (brand, model) join the next Thai phrase. The first phrase is the product's name.
  const words = title.replace(/[【】[\]()（）{}|/]+/g, " ").split(/\s+/).map(w => w.trim()).filter(Boolean);
  const phrases: string[] = [];
  let buffer: string[] = [];
  for (const word of words) {
    buffer.push(word);
    if (/[\u0E00-\u0E7F]/.test(word) && [...word].length >= 6) { phrases.push(buffer.join(" ")); buffer = []; }
  }
  if (buffer.length) phrases.push(buffer.join(" "));
  return [...new Set(phrases.slice(1)
    .filter(p => [...p].length >= 6 && !/\d+\s*(บาท|฿)|%|ส่วนลด|ลดราคา|โปร|แถม|ฟรี|ขายดี|อันดับ|ส่งไว|พร้อมส่ง|ของแท้|รับประกัน/i.test(p))
    .map(p => p.slice(0, 90)))].slice(0, max);
}

export const fmtCount = (n: number | null | undefined) => n === null || n === undefined ? "—"
  : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} ล้าน` : n.toLocaleString("th-TH");

/** The LIVE Manager tab pins the next product in the live basket this often (Praew presents the pinned one). */
export const PIN_EVERY_SECONDS = 180;
