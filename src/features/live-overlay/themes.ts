import { MAX_ITEMS, makeItem, shorten, type OverlayConfig, type OverlayItem, type OverlayLook, type OverlayProduct, type PromoColor, type TEXT_STYLES } from "./model";

/**
 * Looks for "สร้างชุดหน้าจอไลฟ์อัตโนมัติ": a tone (colours, lettering, emoji) and a layout (which promo pieces go where).
 * The tone follows what the live products are (beauty → soft pink or gold, food → hot red/orange, gadgets → blue neon…),
 * and a new set never repeats the last tone+layout, so each live looks different. Words come only from the products and
 * a few neutral labels; nothing is drawn by a paid AI.
 */
type Style = typeof TEXT_STYLES[number];
export interface Tone { id: string; label: string; main: PromoColor; alt: PromoColor; head: Style; clock: Style; emoji: string[] }
export const TONES: readonly Tone[] = [
  { id: "hot", label: "แดงร้อนแรง", main: "red", alt: "orange", head: "red-tag", clock: "dark-pill", emoji: ["🔥", "💥", "🛒", "⚡"] },
  { id: "sweet", label: "ชมพูหวาน", main: "pink", alt: "purple", head: "gradient", clock: "white-outline", emoji: ["💖", "🌸", "✨", "🛍️"] },
  { id: "lux", label: "ทองหรูพรีเมียม", main: "gold", alt: "black", head: "gold-lux", clock: "gold-lux", emoji: ["👑", "💎", "✨", "🌟"] },
  { id: "fresh", label: "มินต์สดชื่น", main: "mint", alt: "green", head: "mint-pill", clock: "dark-pill", emoji: ["🍀", "💚", "✨", "🛒"] },
  { id: "tech", label: "ฟ้าไฮเทค", main: "blue", alt: "purple", head: "neon", clock: "dark-pill", emoji: ["⚡", "💥", "✨", "🛒"] },
  { id: "fun", label: "ส้มสนุกสดใส", main: "orange", alt: "pink", head: "yellow-pop", clock: "dark-pill", emoji: ["🎉", "🤩", "🎁", "🛒"] },
  { id: "night", label: "ม่วงนีออนกลางคืน", main: "black", alt: "purple", head: "neon", clock: "neon", emoji: ["🌟", "💜", "✨", "🔥"] },
  { id: "natural", label: "เขียวธรรมชาติ", main: "green", alt: "gold", head: "white-outline", clock: "dark-pill", emoji: ["🌿", "🍀", "🌸", "🎁"] },
];

export const LAYOUTS = [
  { id: "classic", label: "แบนเนอร์ล่าง + แถบวิ่ง" },
  { id: "side-card", label: "การ์ดสินค้าข้างจอ" },
  { id: "full-frame", label: "กรอบไลฟ์ทั้งจอ" },
  { id: "big-banner", label: "แบนเนอร์ใหญ่ + ป้ายราคา" },
  { id: "minimal", label: "มินิมอล เรียบๆ" },
] as const;
export type LayoutId = typeof LAYOUTS[number]["id"];

/** What the products mostly are, from their names and facts. */
const CATEGORIES: { id: string; label: string; words: string[]; tones: string[]; heads: string[] }[] = [
  { id: "beauty", label: "ความสวยความงาม", tones: ["sweet", "lux", "fresh"], heads: ["💄 LIVE · ของดีผิวสวย", "✨ LIVE · บิวตี้ของแพรว"],
    words: ["เซรั่ม", "ครีม", "ลิป", "แป้ง", "มาสก์", "สกิน", "ผิว", "บำรุง", "น้ำหอม", "เครื่องสำอาง", "โลชั่น", "กันแดด", "รองพื้น", "แชมพู", "serum", "cream", "lip", "skin"] },
  { id: "health", label: "สุขภาพ", tones: ["fresh", "natural", "lux"], heads: ["💪 LIVE · ดูแลสุขภาพ", "🌿 LIVE · ของดีเพื่อสุขภาพ"],
    words: ["วิตามิน", "อาหารเสริม", "คอลลาเจน", "โปรตีน", "สมุนไพร", "ไฟเบอร์", "ดีท็อกซ์", "vitamin", "collagen"] },
  { id: "food", label: "ของกิน", tones: ["hot", "fun", "natural"], heads: ["😋 LIVE · ของอร่อยต้องลอง", "🍜 LIVE · ของกินของดี"],
    words: ["อาหาร", "ขนม", "กาแฟ", "ชา", "น้ำพริก", "เครื่องดื่ม", "หมู", "ไก่", "ข้าว", "เส้น", "ซอส", "อร่อย", "ผลไม้", "snack", "coffee"] },
  { id: "tech", label: "ไอที/แกดเจ็ต", tones: ["tech", "night", "hot"], heads: ["⚡ LIVE · แกดเจ็ตน่าใช้", "📱 LIVE · ของไอทีน่าใช้"],
    words: ["หูฟัง", "ชาร์จ", "สายชาร์จ", "โทรศัพท์", "มือถือ", "ลำโพง", "กล้อง", "พาวเวอร์แบงค์", "เมาส์", "คีย์บอร์ด", "usb", "bluetooth", "led", "type-c"] },
  { id: "fashion", label: "แฟชั่น", tones: ["sweet", "lux", "night"], heads: ["👗 LIVE · แฟชั่นของแพรว", "👜 LIVE · แต่งตัวสวยกับแพรว"],
    words: ["เสื้อ", "กางเกง", "กระเป๋า", "รองเท้า", "เดรส", "กระโปรง", "แฟชั่น", "หมวก", "ต่างหู", "สร้อย", "แหวน", "เครื่องประดับ"] },
  { id: "pet", label: "สัตว์เลี้ยง", tones: ["fun", "sweet", "natural"], heads: ["🐾 LIVE · ของน้องหมาน้องแมว"],
    words: ["แมว", "หมา", "สุนัข", "สัตว์เลี้ยง", "ทรายแมว", "pet"] },
  { id: "kids", label: "เด็ก/ของเล่น", tones: ["fun", "sweet", "fresh"], heads: ["🧸 LIVE · ของดีสำหรับน้องๆ"],
    words: ["เด็ก", "ของเล่น", "ทารก", "ผ้าอ้อม", "baby"] },
  { id: "home", label: "ของใช้ในบ้าน", tones: ["fresh", "fun", "natural"], heads: ["🏠 LIVE · ของใช้ในบ้าน", "🧺 LIVE · ของใช้ดีบอกต่อ"],
    words: ["กระทะ", "หม้อ", "ไม้ถู", "ผ้า", "ที่นอน", "หมอน", "กล่อง", "ชั้นวาง", "ครัว", "ทำความสะอาด", "ถังขยะ", "ไม้แขวน", "ห้องน้ำ", "พัดลม"] },
];
const GENERAL = { id: "general", label: "ทั่วไป", tones: ["hot", "fun", "tech"], heads: ["🔴 LIVE · ของดีราคาโดน", "🛍️ LIVE · ช้อปสดกับแพรว"] };
const BADGES = ["โปรในไลฟ์", "แพรวแนะนำ", "ของมันต้องมี", "ช้อปในไลฟ์", "ตัวเด็ดวันนี้"];

/** The main kind of product on the live: earlier products (Praew's best sellers) count more. */
export function productCategory(products: readonly OverlayProduct[]) {
  const score = new Map<string, number>();
  products.forEach((p, i) => {
    const text = `${p.name} ${p.facts.join(" ")}`.toLowerCase();
    const weight = 1 / (1 + i * 0.3);
    for (const c of CATEGORIES) if (c.words.some(w => text.includes(w))) score.set(c.id, (score.get(c.id) ?? 0) + weight);
  });
  let best: (typeof CATEGORIES)[number] | typeof GENERAL = GENERAL, top = 0;
  for (const c of CATEGORIES) { const s = score.get(c.id) ?? 0; if (s > top) { best = c; top = s; } }
  return best;
}

const pick = <T,>(list: readonly T[], rnd: () => number) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

/** Which tone and layout to make now: the owner's choice, else fitting the products, never the same pair as last time. */
export function chooseLook(products: readonly OverlayProduct[], look: Pick<OverlayLook, "tone" | "layout" | "last">, rnd = Math.random) {
  const category = productCategory(products);
  const fixedTone = TONES.find(t => t.id === look.tone);
  const tones = fixedTone ? [fixedTone] : category.tones.map(id => TONES.find(t => t.id === id)!).filter(Boolean);
  const hasImage = products.some(p => p.image);
  const fixedLayout = LAYOUTS.find(l => l.id === look.layout);
  const layouts: LayoutId[] = fixedLayout ? [fixedLayout.id] : LAYOUTS.map(l => l.id).filter(id => id !== "side-card" || hasImage);
  const pairs = tones.flatMap(tone => layouts.map(layout => ({ tone, layout })));
  const fresh = pairs.filter(p => `${p.tone.id}/${p.layout}` !== look.last);
  const chosen = pick(fresh.length ? fresh : pairs, rnd);
  const first = products[0];
  const heads = [...category.heads, ...(first ? [`🔴 วันนี้มี ${shorten(first.name, 12)}`] : []), ...GENERAL.heads.slice(0, 1)];
  const badge = pick(BADGES, rnd);
  return { ...chosen, category, head: pick(heads, rnd), badge, badge2: pick(BADGES.filter(b => b !== badge), rnd) };
}

/**
 * "สร้างชุดหน้าจอไลฟ์อัตโนมัติ": a ready layout from the live products (name, price, first kept fact, listing photo)
 * in the chosen or a fitting look. Replaces earlier auto items only; the owner's own pieces stay.
 */
export function autoPromoSet(config: OverlayConfig, products: readonly OverlayProduct[], rnd = Math.random,
  prefs: Partial<Pick<OverlayLook, "tone" | "layout">> = {}, now = new Date()): OverlayConfig {
  const wanted = { ...config.look, ...prefs };
  const look = chooseLook(products, wanted, rnd);
  const { tone, layout, head, badge, badge2 } = look;
  const hasPrice = products.some(p => p.price), hasImage = products.some(p => p.image);
  const make = (kind: OverlayItem["kind"], extra: Record<string, unknown>) => makeItem(kind, { ...extra, auto: true }, rnd);
  const header = (box: Record<string, number>) => make("text", { text: head, style: tone.head, ...box });
  const clock = (box: Record<string, number> = {}) => make("clock", { style: tone.clock, x: 0.7, y: 0.03, w: 0.26, h: 0.042, ...box });
  const ticker = () => make("promo", { template: "ticker", color: tone.alt });
  const emojis = (n: number, every = 2) => tone.emoji.slice(0, n).map((emoji, i) => make("emoji", { emoji, everyMin: every + i, showSec: 5, randomPos: true }));
  const cardPop = () => make("promo", { template: "card", color: tone.alt, badge: badge2, x: 0.03, y: 0.5, cycleSec: 15, everyMin: 2, showSec: 15 });

  let items: OverlayItem[];
  switch (layout) {
    case "side-card":
      items = [
        header({ x: 0.04, y: 0.025, w: 0.6, h: 0.05 }), clock(),
        make("promo", { template: "card", color: tone.main, badge, x: 0.64, y: 0.53, w: 0.33, h: 0.3, cycleSec: 12 }),
        ...(hasPrice ? [make("promo", { template: "price-tag", color: tone.alt, badge: badge2, x: 0.03, y: 0.6, cycleSec: 12, everyMin: 2, showSec: 12 })] : []),
        ticker(), ...emojis(3),
      ];
      break;
    case "full-frame":
      items = [
        // The frame's top strip holds the badge and a short title only.
        make("promo", { template: "frame", color: tone.main, badge, title: head.length <= 22 ? head : "🔥 LIVE สด ช้อปในไลฟ์", cycleSec: 12 }),
        clock({ x: 0.04, y: 0.07, w: 0.24, h: 0.038 }),
        ...(hasImage ? [cardPop()] : []),
        ...(hasPrice ? [make("promo", { template: "price-tag", color: tone.alt, badge: badge2, cycleSec: 12, everyMin: 3, showSec: 12, randomPos: true })] : []),
        ...emojis(4, 3),
      ];
      break;
    case "big-banner":
      items = [
        header({ x: 0.2, y: 0.025, w: 0.6, h: 0.05 }), clock({ x: 0.03, y: 0.09, w: 0.24, h: 0.04 }),
        make("promo", { template: "banner", color: tone.main, badge, x: 0.03, y: 0.74, w: 0.94, h: 0.18, cycleSec: 12 }),
        ...(hasPrice ? [make("promo", { template: "price-tag", color: tone.alt, badge: badge2, x: 0.03, y: 0.54, cycleSec: 12 })] : []),
        ...emojis(4),
      ];
      break;
    case "minimal":
      items = [
        header({ x: 0.04, y: 0.025, w: 0.5, h: 0.042 }), clock({ x: 0.74, y: 0.03, w: 0.22, h: 0.036 }),
        make("promo", { template: "banner", color: tone.main, badge, cycleSec: 12, everyMin: 3, showSec: 20 }),
        ticker(), ...emojis(2, 4),
      ];
      break;
    default:
      items = [
        header({ x: 0.04, y: 0.025, w: 0.6, h: 0.05 }), clock(),
        make("promo", { template: "banner", color: tone.main, badge, cycleSec: 12 }), ticker(),
        ...(hasImage ? [cardPop()] : []),
        ...(hasPrice ? [make("promo", { template: "price-tag", color: tone.main, badge: badge2, cycleSec: 12 })] : []),
        ...emojis(4),
      ];
  }
  const own = config.items.filter(i => !i.auto);
  return {
    ...config,
    items: [...own, ...items].slice(0, MAX_ITEMS),
    look: { ...wanted, last: `${tone.id}/${layout}`, at: now.toISOString() },
  };
}

/** A label for the look last made, e.g. "ชมพูหวาน · การ์ดสินค้าข้างจอ". */
export function lookLabel(last: string) {
  const [t, l] = last.split("/");
  const tone = TONES.find(x => x.id === t), layout = LAYOUTS.find(x => x.id === l);
  return tone && layout ? `${tone.label} · ${layout.label}` : "";
}

/** The OBS page opening for a new live makes a new look, at most once per 20 minutes (a reload mid-live keeps it). */
export const NEW_LOOK_GAP_MS = 20 * 60_000;
export function wantsNewLook(config: OverlayConfig, now: Date) {
  if (!config.look.autoNew) return false;
  const at = Date.parse(config.look.at);
  return !Number.isFinite(at) || now.getTime() - at >= NEW_LOOK_GAP_MS;
}
