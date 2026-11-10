import { z } from "zod";
import { productIdFromUrl, sameMarketplace, type ProductPlatform } from "./link";
import { readProductPage } from "./source";

/**
 * Shopee and Lazada refuse servers, so the product page is opened by the owner's own computer: the Flow worker
 * (workers/flow-browser) loads the pasted link in a real Chrome window, captures what the page shows, and sends it here.
 * This file turns that capture into product details. Pure apart from zod.
 */
export const LOOKUP_MAX_ATTEMPTS = 3;
export type LookupStateName = "PENDING" | "CLAIMED" | "LOGIN" | "FAILED";
export interface LookupState { state: LookupStateName; attempts: number; requestedAt: string; claimedAt: string | null; note: string | null }

const MAX_IMAGE_B64 = 1_100_000;
export const lookupResultSchema = z.object({
  jobId: z.uuid(),
  ok: z.boolean(),
  error: z.string().max(160).optional(),
  finalUrl: z.string().max(3000).optional(),
  html: z.string().max(900_000).optional(),
  /** Shopee's own product data, captured from the page's /api/v4/pdp request (a trimmed copy). */
  api: z.unknown().optional(),
  dom: z.object({ title: z.string().max(500).optional(), h1: z.string().max(500).optional(), description: z.string().max(6000).optional(),
    images: z.array(z.string().max(2000)).max(40).optional() }).optional(),
  /** Photos downloaded by the browser (the image CDN may refuse servers too). */
  images: z.array(z.object({ url: z.string().max(2000), base64: z.string().max(MAX_IMAGE_B64) })).max(4).optional(),
});
export type LookupResult = z.infer<typeof lookupResultSchema>;

/** Shopee image ids become CDN URLs on the shop's own country host (down-th, down-sg, …). */
export function shopeeImageUrl(id: string, pageUrl?: string) {
  if (/^https:\/\//.test(id)) return id;
  if (!/^[a-z0-9_-]{8,80}$/i.test(id)) return null;
  const host = (() => { try { return new URL(pageUrl ?? "").hostname; } catch { return "shopee.co.th"; } })();
  const cc = /\.co\.th$/.test(host) ? "th" : /\.sg$/.test(host) ? "sg" : /\.com\.my$/.test(host) ? "my" : /\.vn$/.test(host) ? "vn" : /\.ph$/.test(host) ? "ph"
    : /\.co\.id$/.test(host) ? "id" : /\.tw$/.test(host) ? "tw" : "th";
  return `https://down-${cc}.img.susercontent.com/file/${id}`;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj | null => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const str = (value: unknown) => typeof value === "string" ? value : "";

/** Pages that are a sign-in or robot check instead of the product. */
export function isLoginWall(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    return /\/(buyer\/login|verify\/|login)/i.test(pathname) || /^(member|login|passport)\./i.test(hostname);
  } catch { return false; }
}

export interface BrowserDetails {
  title: string; description: string; brand: string | null; imageUrls: string[]; productUrl: string | null; externalId: string | null;
}

/** Shopee's product data first (exact title, every listing photo, the seller's description), then the page itself. */
export function detailsFromBrowser(platform: ProductPlatform, result: LookupResult): BrowserDetails {
  const finalUrl = result.finalUrl && sameMarketplace(platform, result.finalUrl) && !isLoginWall(result.finalUrl) ? result.finalUrl.split("#")[0] : null;
  const page = result.html ? readProductPage(result.html) : { title: "", description: "", brand: null, images: [] as string[] };
  const api = obj(result.api), item = obj(api?.item);
  const apiImages = [
    ...(Array.isArray(item?.images) ? item.images : []),
    ...(Array.isArray(obj(api?.product_images)?.images) ? obj(api?.product_images)!.images as unknown[] : []),
  ].map(id => shopeeImageUrl(str(id), finalUrl ?? undefined)).filter((u): u is string => !!u);
  const apiBrand = str(obj(item?.brand)?.name) || str(item?.brand);
  const strip = (title: string) => title.replace(/\s*[|｜-]\s*(Shopee|Lazada)[^|｜]*$/i, "").replace(/\s+/g, " ").trim();
  const title = strip(str(item?.title) || str(item?.name) || page.title || result.dom?.h1 || result.dom?.title || "").slice(0, 300);
  const description = (str(item?.description) || page.description || result.dom?.description || "").replace(/\r/g, "").slice(0, 3000);
  const httpsOnly = (u: string) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
  const imageUrls = [...new Set([...apiImages, ...page.images, ...(result.dom?.images ?? [])].filter(httpsOnly))].slice(0, 12);
  let externalId: string | null = null;
  if (finalUrl) { try { externalId = productIdFromUrl(platform, new URL(finalUrl)); } catch { externalId = null; } }
  if (!externalId && item && /^\d+$/.test(String(item.shop_id ?? "")) && /^\d+$/.test(String(item.item_id ?? ""))) externalId = `${item.shop_id}.${item.item_id}`;
  return { title: /^(shopee|lazada)\b/i.test(title) ? "" : title, description, brand: (apiBrand || page.brand || null)?.slice(0, 120) ?? null,
    imageUrls, productUrl: finalUrl, externalId };
}

export const lookupErrorLabel = (code: string | null | undefined) => {
  if (!code) return null;
  if (/LOGIN_REQUIRED/.test(code)) return "ร้านค้าไม่ยอมเปิดหน้าสินค้าให้เครื่องสร้างคลิป: เปิดลิงก์ใน Chrome ของคุณ แล้วกดปุ่ม ⚡ ส่งเข้า ViralFlow มุมขวาล่าง";
  if (/NO_EXTENSION/.test(code)) return "เปิดหน้าสินค้าใน Chrome ของคุณแล้ว แต่ไม่มีข้อมูลกลับมา: ติดตั้งส่วนขยาย ViralFlow ใน Chrome ก่อน (ดูวิธีในหน้าคลิปสินค้า)";
  if (/PAGE_NOT_READY/.test(code)) return "Chrome ของคุณเปิดหน้าสินค้าแล้วแต่ไม่เห็นข้อมูลสินค้า (อาจต้องล็อกอิน Shopee หรือยืนยันตัวตนก่อน)";
  if (/NO_PRODUCT_DATA|NO_TITLE/.test(code)) return "หน้าสินค้าไม่แสดงชื่อสินค้า (ลิงก์อาจหมดอายุหรือสินค้าถูกลบ)";
  if (/NO_IMAGES/.test(code)) return "หน้าสินค้าไม่มีรูปที่ใช้ได้";
  if (/TIMEOUT|Timeout/.test(code)) return "เปิดหน้าสินค้าไม่ทัน (เน็ตช้าหรือหน้าเว็บค้าง)";
  return code.slice(0, 120);
};
