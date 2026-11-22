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
    text: { text: "โปรเด็ดวันนี้ กดตะกร้าเลย!", style: "red-tag" },
    clock: {}, emoji: { emoji: "🔥" }, image: { src: "" }, promo: {},
  };
  return itemSchema.parse({ id: newId(kind, rnd), kind, ...box, ...defaults[kind], ...extra });
}

const overlaps = (a: Zone, b: Zone) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A random spot for a pop-up of size w x h that stays inside the frame, off Praew's face and off the middle column
 * (where she gestures). Falls back to the side strip with the most room.
 */
export function pickSpot(w: number, h: number, face: Zone, rnd = Math.random): { x: number; y: number } {
  const ww = Math.min(w, 1), hh = Math.min(h, 1);
  const center: Zone = { x: 0.38, y: 0, w: 0.24, h: 0.75 };
  for (let i = 0; i < 40; i++) {
    const spot = { x: rnd() * (1 - ww), y: rnd() * (1 - hh), w: ww, h: hh };
    if (!overlaps(spot, face) && !overlaps(spot, center)) return { x: spot.x, y: spot.y };
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
    price: item.price || product?.price || "",
    badge: item.badge || "โปรในไลฟ์",
    cta: item.cta || (product?.where.includes("ตะกร้า") || !product ? "กดตะกร้าสีส้มได้เลย 🛒" : "ลิงก์สินค้าอยู่ในโพสต์ 🛒"),
    fact: product?.facts[0] ? shorten(product.facts[0], 70) : "",
    image: product?.image ?? null,
  };
}

/** The ticker text: every live product's name and first fact, or the owner's title. */
export function tickerText(item: Extract<OverlayItem, { kind: "promo" }>, products: readonly OverlayProduct[]) {
  if (item.title) return item.title;
  const parts = products.map(p => `🛒 ${shorten(p.name, 50)}${p.facts[0] ? ` · ${shorten(p.facts[0], 60)}` : ""}${p.price ? ` · ${p.price}` : ""}`);
  return parts.length ? parts.join("   ✦   ") : "🔥 ไลฟ์สดวันนี้ ถามแพรวได้ทุกเรื่อง พิมพ์คอมเมนต์มาเลย 🔥";
}

/** OBS URL token: owner id + a random secret kept in the owner's overlay file. */
export const overlayToken = (owner: string, secret: string) => `${owner}.${secret}`;
export function parseToken(token: string | null): { owner: string; secret: string } | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,80})$/i.exec(token ?? "");
  return m ? { owner: m[1].toLowerCase(), secret: m[2] } : null;
}
