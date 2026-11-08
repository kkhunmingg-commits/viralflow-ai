import { parseProductLink, productIdFromUrl, sameMarketplace, type ParsedLink, type ProductPlatform } from "./link";

/**
 * Where product details come from. Today: the product page behind the pasted link (MANUAL_LINK), which the owner
 * checks and completes by hand. Later: the Shopee / Lazada Affiliate Open API (AFFILIATE_API) once the account
 * qualifies; it returns the same shape, so the rest of the pipeline does not change.
 */
export type ProductSourceKind = "MANUAL_LINK" | "AFFILIATE_API";
export interface ProductDetails {
  platform: ProductPlatform; source: ProductSourceKind;
  /** The link exactly as pasted (affiliate tracking kept); this is what goes in captions and comments. */
  link: string;
  /** The product page the short link points to, when it could be followed. */
  productUrl: string | null;
  externalId: string | null;
  title: string; description: string; brand: string | null;
  /** Up to 8 listing photo URLs (https only), in the listing's own order. */
  images: string[];
  /** What the page could not give: the form asks the owner for these. */
  missing: Array<"TITLE" | "IMAGES" | "DESCRIPTION">;
  /** Why reading the page failed, if it did (blocked, timeout); the owner then fills the details in. */
  readError: string | null;
}
export interface ProductSource {
  kind: ProductSourceKind;
  lookup(link: ParsedLink): Promise<ProductDetails>;
}

const MAX_PAGE_BYTES = 2_500_000;
const USER_AGENT = "Mozilla/5.0 (compatible; ViralFlowAI/1.0; product-preview)";

/** HTML entities that show up in Thai product titles. */
function decode(text: string) {
  return text.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
const tidy = (text: string, max: number) => decode(text).replace(/\s+/g, " ").trim().slice(0, max);

function meta(html: string, key: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name !== key) continue;
    const content = /content\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /content\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    if (content) return content;
  }
  return null;
}

type JsonLd = Record<string, unknown>;
function jsonLdProducts(html: string): JsonLd[] {
  const out: JsonLd[] = [];
  for (const match of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim()) as unknown;
      const items = Array.isArray(value) ? value : (value as JsonLd)?.["@graph"] && Array.isArray((value as JsonLd)["@graph"]) ? (value as JsonLd)["@graph"] as unknown[] : [value];
      for (const item of items) if (item && typeof item === "object" && /Product/i.test(String((item as JsonLd)["@type"] ?? ""))) out.push(item as JsonLd);
    } catch { /* a broken block is skipped */ }
  }
  return out;
}

const httpsImage = (value: unknown): string | null => {
  const text = typeof value === "string" ? value : value && typeof value === "object" && typeof (value as JsonLd).url === "string" ? (value as JsonLd).url as string : null;
  if (!text) return null;
  const url = text.startsWith("//") ? `https:${text}` : text;
  try { const parsed = new URL(url); return parsed.protocol === "https:" ? parsed.toString() : null; } catch { return null; }
};

/** Title, description, brand and photos from a product page's Open Graph tags and schema.org Product data. Pure. */
export function readProductPage(html: string) {
  const products = jsonLdProducts(html), product = products[0];
  const ldImages = product ? (Array.isArray(product.image) ? product.image : [product.image]).map(httpsImage) : [];
  const ogImages = (html.match(/<meta\b[^>]*>/gi) ?? []).filter(tag => /property\s*=\s*["']og:image(:url)?["']/i.test(tag))
    .map(tag => httpsImage(/content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null));
  const images = [...new Set([...ldImages, ...ogImages].filter((u): u is string => !!u))].slice(0, 8);
  const brandValue = product?.brand;
  const brand = typeof brandValue === "string" ? brandValue : brandValue && typeof brandValue === "object" && typeof (brandValue as JsonLd).name === "string" ? (brandValue as JsonLd).name as string : null;
  const rawTitle = (typeof product?.name === "string" ? product.name : null) ?? meta(html, "og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  // Marketplace pages add the shop name after a separator: "สินค้า | Shopee Thailand".
  const title = tidy(rawTitle, 300).replace(/\s*[|｜-]\s*(Shopee|Lazada)[^|｜]*$/i, "").trim();
  // Line breaks are kept: sellers list one feature per line, which is how facts are split later.
  const description = decode((typeof product?.description === "string" ? product.description : null) ?? meta(html, "og:description") ?? meta(html, "description") ?? "")
    .replace(/[^\S\n]+/g, " ").replace(/\n\s*/g, "\n").trim().slice(0, 3000);
  return { title, description, brand: brand ? tidy(brand, 120) : null, images };
}

/** Facts worth checking from a seller description: short lines, one claim each, never the shop's sales talk. */
export function factCandidates(description: string, max = 8): string[] {
  const parts = description.split(/[\n\r•●▪︎✓✔️✅★☆⭐️|]+|(?<=[.!])\s+|\s{2,}/).map(p => p.replace(/^[\s\-–*:#]+/, "").trim()).filter(Boolean);
  const seen = new Set<string>(), out: string[] = [];
  for (const part of parts) {
    const text = part.slice(0, 90);
    if ([...text].length < 6) continue;
    // Shipping, ordering and shop boilerplate are not product facts.
    if (/ส่งไว|ส่งฟรี|พร้อมส่ง|เก็บเงินปลายทาง|ทักแชท|สั่งซื้อ|โค้ด|คูปอง|ร้านค้า|การันตี|รับประกันความพอใจ|ติดตามร้าน|flash ?sale|COD/i.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

async function boundedText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Follows a short link hop by hop, only while it stays on the marketplace. Returns the last URL reached. */
export async function followLink(parsed: ParsedLink, fetcher: typeof fetch = fetch, hops = 5) {
  let current = parsed.link;
  for (let i = 0; i < hops; i++) {
    const response = await fetcher(current, { redirect: "manual", headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, signal: AbortSignal.timeout(8000) });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current).toString();
      if (!sameMarketplace(parsed.platform, next)) throw new Error("REDIRECT_LEFT_MARKETPLACE");
      current = next;
      continue;
    }
    return { url: current, response };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

/** Reads the product page behind the pasted link. Marketplaces often block servers; then the owner fills the form. */
export const pageSource: ProductSource = {
  kind: "MANUAL_LINK",
  async lookup(parsed) {
    const base: ProductDetails = { platform: parsed.platform, source: "MANUAL_LINK", link: parsed.link, productUrl: parsed.short ? null : parsed.link,
      externalId: parsed.externalId, title: "", description: "", brand: null, images: [], missing: ["TITLE", "IMAGES", "DESCRIPTION"], readError: null };
    try {
      const { url, response } = await followLink(parsed);
      const productUrl = url.split("#")[0];
      const externalId = parsed.externalId ?? productIdFromUrl(parsed.platform, new URL(productUrl));
      if (!response.ok) return { ...base, productUrl, externalId, readError: `HTTP_${response.status}` };
      const page = readProductPage(await boundedText(response));
      const missing: ProductDetails["missing"] = [];
      if (!page.title || /^(shopee|lazada)/i.test(page.title)) missing.push("TITLE");
      if (!page.images.length) missing.push("IMAGES");
      if (!page.description) missing.push("DESCRIPTION");
      return { ...base, productUrl, externalId, title: missing.includes("TITLE") ? "" : page.title, description: page.description, brand: page.brand,
        images: page.images, missing, readError: missing.length === 3 ? "PAGE_HAD_NO_PRODUCT_DATA" : null };
    } catch (error) {
      return { ...base, readError: error instanceof Error ? error.message.slice(0, 120) : "READ_FAILED" };
    }
  },
};

/**
 * Placeholder for the Affiliate Open API (Shopee needs 1,000 sales before it opens). When credentials exist it will
 * answer lookups with the API's product data and offer link; until then the page source is used.
 */
export const affiliateApiSource: ProductSource | null = null;

export async function lookupProduct(input: string): Promise<ProductDetails> {
  const parsed = parseProductLink(input);
  return (affiliateApiSource ?? pageSource).lookup(parsed);
}
