import { z } from "zod";

/**
 * Things drawn over Praew's live picture (text, clock, images, emoji, promo banners). The owner arranges them on the
 * AI LIVE page; OBS on the home PC shows the same layout as a transparent Browser Source above Praew's video, so the
 * engine itself is never touched. Positions and sizes are fractions of the 720x1280 frame.
 */
export const FRAME = { width: 720, height: 1280 } as const;
export const MAX_ITEMS = 60;

export const TEXT_STYLES = ["red-tag", "white-outline", "yellow-pop", "gradient", "dark-pill", "gold-lux", "neon", "mint-pill"] as const;
export const PROMO_COLORS = ["red", "orange", "pink", "purple", "green", "blue", "gold", "black", "mint"] as const;
export type PromoColor = typeof PROMO_COLORS[number];
export const PROMO_TEMPLATES = ["banner", "price-tag", "card", "ticker", "frame"] as const;
export type PromoTemplate = typeof PROMO_TEMPLATES[number];

const unit = z.number().finite().min(0).max(1);
const base = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  x: unit, y: unit,
  w: z.number().finite().min(0.02).max(1), h: z.number().finite().min(0.01).max(1),
  opacity: unit.default(1),
  rotation: z.number().finite().min(-180).max(180).default(0),
  hidden: z.boolean().default(false),
  /** 0 = always on screen; otherwise pops up about every N minutes for showSec seconds. */
  everyMin: z.number().finite().min(0).max(120).default(0),
  showSec: z.number().finite().min(1).max(600).default(5),
  /** A pop-up lands somewhere new each time, never over Praew's face. */
  randomPos: z.boolean().default(false),
  /** Made by "สร้างชุดป้ายโปรอัตโนมัติ"; pressing it again replaces these and keeps the owner's own items. */
  auto: z.boolean().optional(),
};
const text = (max: number) => z.string().max(max).default("");

export const itemSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("text"), text: text(200), style: z.enum(TEXT_STYLES).default("white-outline") }),
  z.object({ ...base, kind: z.literal("clock"), style: z.enum(TEXT_STYLES).default("dark-pill"), withDate: z.boolean().default(false) }),
  z.object({ ...base, kind: z.literal("emoji"), emoji: z.string().min(1).max(16) }),
  // An uploaded picture (owner/<id>/live-overlay/… in private Storage) or an https picture.
  z.object({ ...base, kind: z.literal("image"), src: z.string().max(500) }),
  z.object({
    ...base, kind: z.literal("promo"), template: z.enum(PROMO_TEMPLATES).default("banner"),
    /** Product name from the live list, or "" to go through the live products in turn. */
    product: text(160),
    cycleSec: z.number().finite().min(3).max(600).default(12),
    // Typed by the owner; empty = taken from the product (a link-clip price is never stored, so it says to check the cart).
    title: text(120), price: text(40), badge: text(40), cta: text(60),
    color: z.enum(PROMO_COLORS).default("red"),
  }),
]);
export type OverlayItem = z.infer<typeof itemSchema>;
export type OverlayKind = OverlayItem["kind"];

const zone = z.object({ x: unit, y: unit, w: unit, h: unit });
/** The look of the auto set: chosen tone and layout ("auto"/"random" = picked from the products), the last one made, and whether OBS makes a new one each live (on unless the owner arranged it by hand). */
const look = z.object({
  tone: z.string().max(20).default("auto"),
  layout: z.string().max(20).default("random"),
  last: z.string().max(80).default(""),
  at: z.string().max(40).default(""),
  autoNew: z.boolean().default(true),
  /** Which version of the automatic sets made this look (0 = before the lighter sets). */
  v: z.number().int().min(0).max(100).default(0),
});
export type OverlayLook = z.infer<typeof look>;
export const configSchema = z.object({
  items: z.array(itemSchema).max(MAX_ITEMS).default([]),
  /** Where Praew's face is in the frame: pop-ups never land here. */
  faceZone: zone.default({ x: 0.22, y: 0.1, w: 0.56, h: 0.42 }),
  /** Master switch: off hides everything in OBS without losing the layout. */
  enabled: z.boolean().default(true),
  look: look.prefault({}),
});
export type OverlayConfig = z.infer<typeof configSchema>;
export type Zone = z.infer<typeof zone>;
export interface StoredOverlay extends OverlayConfig { secret: string; updatedAt: string }
export const emptyConfig = (): OverlayConfig => configSchema.parse({});

/** A product the live presents, as the overlay shows it. `image` is a Storage path or an https URL. */
export interface OverlayProduct { name: string; price: string | null; facts: string[]; image: string | null; where: string }

export const newId = (kind: string, rnd = Math.random) => `${kind}-${Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, "0")}`;

const DEFAULT_BOX: Record<OverlayKind, Pick<OverlayItem, "x" | "y" | "w" | "h">> = {
  text: { x: 0.08, y: 0.56, w: 0.84, h: 0.07 },
  clock: { x: 0.7, y: 0.03, w: 0.26, h: 0.045 },
  emoji: { x: 0.06, y: 0.5, w: 0.14, h: 0.08 },
  image: { x: 0.68, y: 0.55, w: 0.28, h: 0.16 },
  promo: { x: 0.04, y: 0.78, w: 0.92, h: 0.14 },
};
const PROMO_BOX: Record<PromoTemplate, Pick<OverlayItem, "x" | "y" | "w" | "h">> = {
  banner: { x: 0.04, y: 0.77, w: 0.92, h: 0.14 },
  "price-tag": { x: 0.66, y: 0.56, w: 0.3, h: 0.13 },
  card: { x: 0.64, y: 0.5, w: 0.33, h: 0.27 },
  ticker: { x: 0, y: 0.94, w: 1, h: 0.045 },
  frame: { x: 0, y: 0, w: 1, h: 1 },
};

/** A new item with sensible defaults, placed where it does not cover the face. */
export function makeItem(kind: OverlayKind, extra: Record<string, unknown> = {}, rnd = Math.random): OverlayItem {
  const template = kind === "promo" ? (extra.template as PromoTemplate | undefined) ?? "banner" : null;
  const box = template ? PROMO_BOX[template] : DEFAULT_BOX[kind];
  const defaults: Record<OverlayKind, Record<string, unknown>> = {
    text: { text: "ช้อปในไลฟ์ กดตะกร้าได้เลย", style: "red-tag" },
    clock: {}, emoji: { emoji: "🔥" }, image: { src: "" }, promo: {},
  };
  return itemSchema.parse({ id: newId(kind, rnd), kind, ...box, ...defaults[kind], ...extra });
}

const overlaps = (a: Zone, b: Zone) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where TikTok draws its own menus over a portrait live, as fractions of the frame: the host name, viewers and close
 * button on top, the comments bottom-left, and the comment box, gift, share and cart buttons along the bottom.
 * Overlay pieces made automatically never go here, and pop-ups never land here.
 */
export const TIKTOK_UI: readonly (Zone & { label: string; hard: boolean })[] = [
  { label: "แถบชื่อช่อง/คนดู TikTok · อย่าวางทับ", x: 0, y: 0, w: 1, h: 0.115, hard: true },
  // 27 Nov (Lucky): TikTok always draws its comments on top of the picture, so a banner may sit under them like other lives do.
  { label: "คอมเมนต์ TikTok · ขึ้นทับป้ายได้", x: 0, y: 0.6, w: 0.68, h: 0.3, hard: false },
  { label: "ปุ่มคอมเมนต์ ของขวัญ ตะกร้า · อย่าวางทับ", x: 0, y: 0.9, w: 1, h: 0.1, hard: true },
];
/** A box (with a hair of slack for rounding) that sits under TikTok's host bar or bottom buttons (comments may cover it). */
export const overTikTokUi = (box: Zone) => {
  const inner = { x: box.x + 0.003, y: box.y + 0.003, w: Math.max(0, box.w - 0.006), h: Math.max(0, box.h - 0.006) };
  return TIKTOK_UI.some(z => z.hard && overlaps(inner, z));
};

/**
 * A random spot for a pop-up of size w x h that stays inside the frame, off Praew's face, off the middle column
 * (where she gestures) and off TikTok's own menus. Falls back to the side strip with the most room.
 */
export function pickSpot(w: number, h: number, face: Zone, rnd = Math.random): { x: number; y: number } {
  const ww = Math.min(w, 1), hh = Math.min(h, 1);
  const center: Zone = { x: 0.38, y: 0, w: 0.24, h: 0.75 };
  for (let i = 0; i < 40; i++) {
    const spot = { x: rnd() * (1 - ww), y: rnd() * (1 - hh), w: ww, h: hh };
    if (!overlaps(spot, face) && !overlaps(spot, center) && !overTikTokUi(spot)) return { x: spot.x, y: spot.y };
  }
  const left = face.x, right = 1 - (face.x + face.w);
  const x = left >= right ? Math.max(0, (left - ww) * rnd()) : Math.min(1 - ww, face.x + face.w + Math.max(0, right - ww) * rnd());
  return { x, y: Math.min(1 - hh, face.y + rnd() * Math.max(0, face.h - hh)) };
}

/** Seconds until the next pop-up: about every N minutes (±40 %), the first one sooner so the live does not start bare. */
export function nextPopupDelaySec(everyMin: number, first: boolean, rnd = Math.random) {
  const mean = everyMin * 60;
  return first ? 5 + rnd() * mean * 0.6 : mean * (0.6 + rnd() * 0.8);
}

/** Which product a promo shows now: a named one, or the live list in turn every cycleSec. */
export function promoProduct(item: Extract<OverlayItem, { kind: "promo" }>, products: readonly OverlayProduct[], nowMs: number) {
  if (!products.length) return null;
  if (item.product) return products.find(p => p.name === item.product) ?? null;
  return products[Math.floor(nowMs / 1000 / item.cycleSec) % products.length];
}

export const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
/** The words a promo shows: what the owner typed, else the product's own (nothing invented, no claims). */
export function promoWords(item: Extract<OverlayItem, { kind: "promo" }>, product: OverlayProduct | null) {
  return {
    title: item.title || (product ? shorten(product.name, 60) : "สินค้าแนะนำในไลฟ์"),
    price: SHOW_PRICES ? item.price || product?.price || "" : "",
    badge: item.badge || "สินค้าในไลฟ์",
    cta: item.cta || (product?.where.includes("ตะกร้า") || !product ? "กดตะกร้าสีส้มได้เลย 🛒" : "ดูในคลิปสินค้าของช่อง"),
    fact: product?.facts[0] ? shorten(product.facts[0], 70) : "",
    image: product?.image ?? null,
  };
}

/** The ticker text: every live product's name and first fact, or the owner's title. */
export function tickerText(item: Extract<OverlayItem, { kind: "promo" }>, products: readonly OverlayProduct[]) {
  if (item.title) return item.title;
  const parts = products.map(p => `🛒 ${shorten(p.name, 50)}${p.facts[0] ? ` · ${shorten(p.facts[0], 60)}` : ""}${SHOW_PRICES && p.price ? ` · ${p.price}` : ""}`);
  return parts.length ? parts.join("   ✦   ") : "🔥 ไลฟ์สดวันนี้ ถามแพรวได้ทุกเรื่อง พิมพ์คอมเมนต์มาเลย 🔥";
}

/** What the PC read from TikTok: the product the host pinned (popped) in the live cart, as TikTok shows it. */
export interface PinnedProduct { name: string; price?: string | null; image?: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const pairs = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
/** How alike two product titles are (0-1): TikTok's cart title and the posted listing title are often cut differently. */
export function titleLikeness(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y || x.startsWith(y.slice(0, 16)) || y.startsWith(x.slice(0, 16))) return 1;
  const px = pairs(x), py = pairs(y);
  let both = 0;
  for (const p of px) if (py.has(p)) both++;
  return (2 * both) / Math.max(1, px.size + py.size);
}

/**
 * The product pinned in the TikTok live cart is the only one the overlay shows, so the screen always matches the cart.
 * A pinned product that is not in Praew's list is shown as TikTok gave it (its cart title and price). Nothing pinned = all.
 */
/**
 * 27 Nov (Lucky: a price that does not match the cart can get the live restricted): the overlay shows no price at all,
 * only "ดูราคาในตะกร้า", until a test live shows the pinned price TikTok reports matches the cart exactly.
 */
export const SHOW_PRICES = false;
export function pinnedProducts(products: readonly OverlayProduct[], pin: PinnedProduct | null | undefined): OverlayProduct[] {
  const list = pinnedProductsWithPrice(products, pin);
  return SHOW_PRICES ? list : list.map(p => ({ ...p, price: null }));
}
function pinnedProductsWithPrice(products: readonly OverlayProduct[], pin: PinnedProduct | null | undefined): OverlayProduct[] {
  if (!pin?.name) return [...products];
  let best: OverlayProduct | null = null, score = 0;
  for (const p of products) { const s = titleLikeness(p.name, pin.name); if (s > score) { best = p; score = s; } }
  const pic = pin.image?.startsWith("https://") ? pin.image : null;
  // The cart price TikTok reports for the pin wins: a saved listing price is often not the live price.
  if (best && score >= 0.5) return [{ ...best, price: pin.price || best.price, image: best.image ?? pic }];
  return [{ name: pin.name.slice(0, 120), price: pin.price || null, facts: [], where: "ตะกร้าสีส้มในไลฟ์", image: pic }];
}

/** OBS URL token: owner id + a random secret kept in the owner's overlay file. */
export const overlayToken = (owner: string, secret: string) => `${owner}.${secret}`;
export function parseToken(token: string | null): { owner: string; secret: string } | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,80})$/i.exec(token ?? "");
  return m ? { owner: m[1].toLowerCase(), secret: m[2] } : null;
}
