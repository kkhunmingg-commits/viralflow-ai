/**
 * Shopee and Lazada product links, as the owner pastes them (usually an affiliate short link).
 *
 * The pasted link is kept exactly as given: it carries the owner's affiliate tracking and is the link that goes in
 * the caption and the first comment. The canonical product URL (resolved from a short link) is only used to read
 * the product page and to spot the same product pasted twice.
 */
export type ProductPlatform = "SHOPEE" | "LAZADA";
export const PLATFORM_LABEL: Record<ProductPlatform, string> = { SHOPEE: "Shopee", LAZADA: "Lazada" };

export interface ParsedLink {
  platform: ProductPlatform;
  /** The link as pasted, trimmed (affiliate tracking kept). */
  link: string;
  /** True for short/affiliate redirect links that must be followed to find the product page. */
  short: boolean;
  /** "shopId.itemId" for Shopee, "itemId" for Lazada, once known. */
  externalId: string | null;
}

const SHOPEE_HOST = /(^|\.)shopee\.(co\.th|com\.my|sg|ph|vn|co\.id|com|tw|com\.br)$/i;
const SHOPEE_SHORT = /^(s\.shopee\.[a-z.]+|shp\.ee|shope\.ee)$/i;
const LAZADA_HOST = /(^|\.)lazada\.(co\.th|com\.my|sg|com\.ph|vn|co\.id)$/i;
const LAZADA_SHORT = /^(s\.lazada\.[a-z.]+|c\.lazada\.[a-z.]+|lzd\.co)$/i;

/** Reads the product id out of a full product URL (not a short link). */
export function productIdFromUrl(platform: ProductPlatform, url: URL): string | null {
  if (platform === "SHOPEE") {
    const path = decodeURIComponent(url.pathname);
    const product = /\/product\/(\d{3,})\/(\d{3,})/.exec(path);
    if (product) return `${product[1]}.${product[2]}`;
    const slug = /-i\.(\d{3,})\.(\d{3,})(?:$|[/?#])/.exec(path + "/");
    if (slug) return `${slug[1]}.${slug[2]}`;
    return null;
  }
  const item = /-i(\d{3,})(?:-s\d+)?\.html/.exec(url.pathname) ?? /\/products\/i(\d{3,})/.exec(url.pathname);
  return item ? item[1] : null;
}

/** Throws INVALID_PRODUCT_LINK / UNSUPPORTED_PRODUCT_LINK; never fetches anything. */
export function parseProductLink(input: string): ParsedLink {
  const text = input.trim();
  // A share from the app often wraps the link in a sentence ("ดูสินค้านี้ https://s.shopee.co.th/abc").
  const found = /https?:\/\/[^\s<>"']+/i.exec(text)?.[0] ?? text;
  let url: URL;
  try { url = new URL(found); } catch { throw new Error("INVALID_PRODUCT_LINK"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("INVALID_PRODUCT_LINK");
  if (url.username || url.password || url.port) throw new Error("INVALID_PRODUCT_LINK");
  const host = url.hostname.toLowerCase();
  url.protocol = "https:";
  const link = url.toString().slice(0, 1000);
  if (SHOPEE_SHORT.test(host)) return { platform: "SHOPEE", link, short: true, externalId: null };
  if (LAZADA_SHORT.test(host)) return { platform: "LAZADA", link, short: true, externalId: null };
  if (SHOPEE_HOST.test(host)) return { platform: "SHOPEE", link, short: false, externalId: productIdFromUrl("SHOPEE", url) };
  if (LAZADA_HOST.test(host)) return { platform: "LAZADA", link, short: false, externalId: productIdFromUrl("LAZADA", url) };
  throw new Error("UNSUPPORTED_PRODUCT_LINK");
}

/** A redirect target is followed only while it stays on the same marketplace (no open redirect to elsewhere). */
export function sameMarketplace(platform: ProductPlatform, target: string) {
  try {
    const url = new URL(target);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return platform === "SHOPEE" ? SHOPEE_HOST.test(host) || SHOPEE_SHORT.test(host) : LAZADA_HOST.test(host) || LAZADA_SHORT.test(host);
  } catch { return false; }
}

export const linkErrorLabel: Record<string, string> = {
  INVALID_PRODUCT_LINK: "ลิงก์นี้อ่านไม่ได้ วางลิงก์สินค้าที่คัดลอกจากแอป Shopee หรือ Lazada",
  UNSUPPORTED_PRODUCT_LINK: "ตอนนี้รองรับเฉพาะลิงก์ Shopee และ Lazada",
};
