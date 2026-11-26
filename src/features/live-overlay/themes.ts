import { MAX_ITEMS, makeItem, overTikTokUi, shorten, type OverlayConfig, type OverlayItem, type OverlayLook, type OverlayProduct, type PromoColor, type TEXT_STYLES } from "./model";

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
  { id: "classic", label: "แบนเนอร์สินค้า" },
  { id: "side-card", label: "การ์ดสินค้าข้างจอ" },
  { id: "full-frame", label: "กรอบรอบตัวแพรว (เลือกเองเท่านั้น)" },
  { id: "big-banner", label: "แบนเนอร์ใหญ่ + ป้ายราคาเด้ง" },
  { id: "minimal", label: "มินิมอล แถบวิ่ง" },
] as const;
export type LayoutId = typeof LAYOUTS[number]["id"];

/** What the products mostly are, from their names and facts. */
const CATEGORIES: { id: string; label: string; words: string[]; tones: string[]; heads: string[] }[] = [
  { id: "beauty", label: "ความสวยความงาม", tones: ["sweet", "lux", "fresh"], heads: ["💄 LIVE · บิวตี้ช้อปสด", "✨ LIVE · บิวตี้ของแพรว"],
    words: ["เซรั่ม", "ครีม", "ลิป", "แป้ง", "มาสก์", "สกิน", "ผิว", "บำรุง", "น้ำหอม", "เครื่องสำอาง", "โลชั่น", "กันแดด", "รองพื้น", "แชมพู", "serum", "cream", "lip", "skin"] },
  { id: "health", label: "สุขภาพ", tones: ["fresh", "natural", "lux"], heads: ["💪 LIVE · ดูแลสุขภาพ", "🌿 LIVE · ช้อปสายสุขภาพ"],
    words: ["วิตามิน", "อาหารเสริม", "คอลลาเจน", "โปรตีน", "สมุนไพร", "ไฟเบอร์", "ดีท็อกซ์", "vitamin", "collagen"] },
  { id: "food", label: "ของกิน", tones: ["hot", "fun", "natural"], heads: ["😋 LIVE · ของกินน่าลอง", "🍜 LIVE · ของกินของดี"],
    words: ["อาหาร", "ขนม", "กาแฟ", "ชาเขียว", "ชานม", "น้ำพริก", "เครื่องดื่ม", "หมูหยอง", "ไก่ทอด", "ข้าวสาร", "บะหมี่", "ซอส", "อร่อย", "ผลไม้", "snack", "coffee"] },
  { id: "tech", label: "ไอที/แกดเจ็ต", tones: ["tech", "night", "hot"], heads: ["⚡ LIVE · แกดเจ็ตน่าใช้", "📱 LIVE · ของไอทีน่าใช้"],
    words: ["หูฟัง", "ชาร์จ", "สายชาร์จ", "โทรศัพท์", "มือถือ", "ลำโพง", "กล้อง", "พาวเวอร์แบงค์", "เมาส์", "คีย์บอร์ด", "usb", "bluetooth", "led", "type-c"] },
  { id: "fashion", label: "แฟชั่น", tones: ["sweet", "lux", "night"], heads: ["👗 LIVE · แฟชั่นของแพรว", "👜 LIVE · แต่งตัวสวยกับแพรว"],
    words: ["เสื้อ", "กางเกง", "กระเป๋า", "รองเท้า", "เดรส", "กระโปรง", "แฟชั่น", "หมวก", "ต่างหู", "สร้อย", "แหวน", "เครื่องประดับ"] },
  { id: "pet", label: "สัตว์เลี้ยง", tones: ["fun", "sweet", "natural"], heads: ["🐾 LIVE · ของน้องหมาน้องแมว"],
    words: ["แมว", "หมา", "สุนัข", "สัตว์เลี้ยง", "ทรายแมว", "pet"] },
  { id: "kids", label: "เด็ก/ของเล่น", tones: ["fun", "sweet", "fresh"], heads: ["🧸 LIVE · ของดีสำหรับน้องๆ"],
    words: ["เด็ก", "ของเล่น", "ทารก", "ผ้าอ้อม", "baby"] },
  { id: "home", label: "ของใช้ในบ้าน", tones: ["fresh", "fun", "natural"], heads: ["🏠 LIVE · ของใช้ในบ้าน", "🧺 LIVE · ช้อปของใช้กับแพรว"],
    words: ["กระทะ", "หม้อ", "ไม้ถู", "ผ้าปู", "ผ้านวม", "ผ้าห่ม", "เครื่องนอน", "ที่นอน", "หมอน", "ปลอกหมอน", "bedsheet", "กล่อง", "ชั้นวาง", "ครัว", "ทำความสะอาด", "ถังขยะ", "ไม้แขวน", "ห้องน้ำ", "พัดลม"] },
];
const GENERAL = { id: "general", label: "ทั่วไป", tones: ["hot", "fun", "tech"], heads: ["🔴 LIVE · ช้อปสดในไลฟ์", "🛍️ LIVE · ช้อปสดกับแพรว"] };
// Plain labels only: no promo is promised and nothing is called the best (TikTok: no misleading claims).
const BADGES = ["แพรวแนะนำ", "ช้อปในไลฟ์", "สินค้าในไลฟ์", "มีในตะกร้า"];

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
  // The full frame sits round Praew, so it is used only when picked by hand.
  const layouts: LayoutId[] = fixedLayout ? [fixedLayout.id] : LAYOUTS.map(l => l.id).filter(id => id !== "full-frame" && (id !== "side-card" || hasImage));
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
  const clock = (box: Record<string, number> = {}) => make("clock", { style: tone.clock, x: 0.73, y: 0.125, w: 0.24, h: 0.042, ...box });
  const ticker = () => make("promo", { template: "ticker", color: tone.alt, x: 0, y: 0.125, w: 0.7, h: 0.045 });
  const emojis = (n: number, every = 2) => tone.emoji.slice(0, n).map((emoji, i) => make("emoji", { emoji, everyMin: every + i, showSec: 5, randomPos: true }));

  // Like the shopping lives people are used to (27 Nov, Lucky): a bold header under TikTok's host bar, the clock beside it,
  // a big product banner in the lower half (TikTok's comments scroll over it, which is fine), a "tap the cart" call above
  // TikTok's cart button now and then, and a price burst or product card on the right. TikTok's host bar and bottom
  // buttons stay clear. Praew's face (upper middle) is never covered.
  const head1 = { x: 0.03, y: 0.125, w: 0.66, h: 0.055 };
  const clockBox = { x: 0.72, y: 0.128, w: 0.25, h: 0.048 };
  const cta = () => make("text", { text: "👇 กดตะกร้าสีส้มด้านล่างได้เลย", style: tone.id === "lux" ? "gold-lux" : "yellow-pop",
    x: 0.03, y: 0.835, w: 0.7, h: 0.05, everyMin: 2, showSec: 15 });
  const banner = (box: Record<string, number>, extra: Record<string, unknown> = {}) =>
    make("promo", { template: "banner", color: tone.main, badge, cycleSec: 12, ...box, ...extra });
  const priceBurst = (extra: Record<string, unknown> = {}) =>
    make("promo", { template: "price-tag", color: tone.alt, badge: badge2, x: 0.69, y: 0.44, w: 0.28, h: 0.15, cycleSec: 12, everyMin: 3, showSec: 12, ...extra });
  let items: OverlayItem[];
  switch (layout) {
    case "side-card":
      items = [
        header(head1), clock(clockBox),
        make("promo", { template: "card", color: tone.main, badge, x: 0.66, y: 0.38, w: 0.31, h: 0.3, cycleSec: 12 }),
        ...(hasPrice ? [priceBurst({ x: 0.04, y: 0.66, w: 0.28, h: 0.15, everyMin: 4 })] : []),
        cta(), ...emojis(2, 4),
      ];
      break;
    case "full-frame":
      // Only when picked by hand: the frame goes round Praew between TikTok's host bar and the cart buttons.
      items = [
        make("promo", { template: "frame", color: tone.main, badge, title: head.length <= 22 ? head : "🔥 LIVE สด ช้อปในไลฟ์", x: 0, y: 0.115, w: 1, h: 0.78, cycleSec: 12 }),
        ...emojis(2, 4),
      ];
      break;
    case "big-banner":
      items = [
        header(head1), clock(clockBox),
        banner({ x: 0.03, y: 0.6, w: 0.94, h: 0.17 }),
        ...(hasPrice ? [priceBurst({ y: 0.43 })] : []),
        cta(), ...emojis(2, 4),
      ];
      break;
    case "minimal":
      items = [
        clock(clockBox), ticker(),
        banner({ x: 0.03, y: 0.64, w: 0.94, h: 0.13 }, { everyMin: 3, showSec: 25 }),
        cta(), ...emojis(1, 5),
      ];
      break;
    default:
      items = [
        header(head1), clock(clockBox),
        banner({ x: 0.03, y: 0.63, w: 0.94, h: 0.15 }),
        ...(hasImage ? [make("promo", { template: "card", color: tone.alt, badge: badge2, x: 0.66, y: 0.34, w: 0.31, h: 0.27, cycleSec: 15, everyMin: 4, showSec: 15 })] : []),
        cta(), ...emojis(2, 4),
      ];
  }
  const own = config.items.filter(i => !i.auto);
  return {
    ...config,
    items: [...own, ...items].slice(0, MAX_ITEMS),
    look: { ...wanted, last: `${tone.id}/${layout}`, at: now.toISOString(), v: LOOK_VERSION },
  };
}

/** A label for the look last made, e.g. "ชมพูหวาน · การ์ดสินค้าข้างจอ". */
export function lookLabel(last: string) {
  const [t, l] = last.split("/");
  const tone = TONES.find(x => x.id === t), layout = LAYOUTS.find(x => x.id === l);
  return tone && layout ? `${tone.label} · ${layout.label}` : "";
}

/** Nothing on screen yet and no set ever made: the screen gets arranged automatically from the start. */
export const needsFirstSet = (config: OverlayConfig) => !config.items.length && !config.look.last;

/**
 * An automatic set from before TikTok's own menus were kept clear (a piece sits under the host bar, the comments or the
 * bottom buttons) and the owner has not arranged it by hand: it is made again in the new places.
 */
export const autoUnderTikTokUi = (config: OverlayConfig) =>
  config.look.autoNew && config.items.some(i => i.auto && !i.randomPos && overTikTokUi(i));
/** Bumped when the automatic sets change shape (v2: lighter sets; v3: plain words, no promo promised; v4: bigger, shopping-live layout); an older automatic set is made again. */
export const LOOK_VERSION = 4;
const autoOutdated = (config: OverlayConfig) => config.look.autoNew && config.look.v < LOOK_VERSION && config.items.some(i => i.auto);
/** Arrange now (not waiting for the next live): never arranged, or an old automatic set under TikTok's menus. */
export const needsArranging = (config: OverlayConfig) => needsFirstSet(config) || autoUnderTikTokUi(config) || autoOutdated(config);

/** The OBS page opening for a new live makes a new look, at most once per 20 minutes (a reload mid-live keeps it). */
export const NEW_LOOK_GAP_MS = 20 * 60_000;
export function wantsNewLook(config: OverlayConfig, now: Date) {
  if (!config.look.autoNew) return false;
  if (needsArranging(config)) return true;
  const at = Date.parse(config.look.at);
  return !Number.isFinite(at) || now.getTime() - at >= NEW_LOOK_GAP_MS;
}
