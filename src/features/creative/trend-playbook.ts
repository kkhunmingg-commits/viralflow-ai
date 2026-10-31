/** Trend playbook for Flow clips: the Thai TikTok formats that currently stop the scroll, written as one
 * continuous 8-second take, plus the shopping moments of the Thai calendar (double-date sales, payday, seasons).
 *
 * This is an editorial playbook, not live trend data: no TikTok trend or best-seller API is connected. Hooks
 * never claim results, rankings, discounts or reviews; product facts come only from the owner's recorded evidence,
 * and every line is checked against the category's forbidden claims before it is used. */
import { categoryPlaybook, type AdFormat, type CategoryPlaybook } from "./category-insight";

export const TREND_PLAYBOOK_VERSION = "trend-playbook-v1";

/** How each format plays inside a single take. `opening` is the first second, the hook beat. */
export interface TrendFormat {
  format: AdFormat; nameTh: string; opening: string; camera: string; audio: string;
  /** Spoken hooks; `{product}` and `{fact}` are filled from verified data, templates missing data are skipped. */
  hooks: string[];
  /** Caption first lines, same rules. */
  captionHooks: string[];
}
export const TREND_FORMATS: Partial<Record<AdFormat, TrendFormat>> = {
  CURIOSITY: { format: "CURIOSITY", nameTh: "ซูมปริศนาแล้วเฉลย",
    opening: "the take opens on an extreme macro of one small detail of the product so the viewer cannot yet tell what it is; within 2 seconds the camera eases back and the hand reveals the whole product",
    camera: "macro start, then a smooth pull-back to a medium close-up", audio: "a soft whoosh as the reveal lands",
    hooks: ["ทายสิ นี่คืออะไร", "คนส่วนใหญ่มองข้ามจุดนี้", "{product} มีอะไรมากกว่าที่เห็น"],
    captionHooks: ["ทายก่อนดูจบ นี่คืออะไร 👀", "จุดเล็ก ๆ ที่หลายคนไม่เคยสังเกต"] },
  ASMR_SENSORY: { format: "ASMR_SENSORY", nameTh: "ASMR เสียงชัด",
    opening: "the take opens with the hand already touching the product, close enough to hear it: crisp, satisfying handling sounds lead before any voice",
    camera: "very close macro with a slow drift along the product surface", audio: "the handling sounds are crisp and up front; the voice, if any, comes in softly after second 2",
    hooks: ["ฟังเสียงนี้ก่อน", "เปิดเสียงดูนะ"], captionHooks: ["เปิดเสียงดู 🎧", "เสียงนี้ฟังแล้วเพลิน"] },
  PROBLEM_SOLUTION: { format: "PROBLEM_SOLUTION", nameTh: "ปัญหา → ของที่ช่วย",
    opening: "the take opens for under one second on a small, relatable everyday mess in the set (no product yet); the hand then brings the product in and the set looks calmer",
    camera: "slow, smooth push-in that ends on the product", audio: "a light 'ah' moment of relief in the ambience",
    hooks: ["ใครเจอแบบนี้ทุกวันบ้าง", "เรื่องเล็กที่กวนใจ จบได้ง่าย ๆ", "ถ้ายังเจอแบบนี้ ลองดู {product}"],
    captionHooks: ["ใครเป็นแบบนี้ยกมือ 🙋", "ปัญหาเล็ก ๆ ที่เจอทุกวัน"] },
  LIFESTYLE: { format: "LIFESTYLE", nameTh: "ไลฟ์สไตล์ในชีวิตจริง",
    opening: "the take opens mid-routine in the set, as if filmed by a friend on a phone; the product is already part of the moment",
    camera: "gentle handheld phone-style framing with natural drift", audio: "everyday room ambience",
    hooks: ["วันธรรมดาที่ง่ายขึ้นนิดนึง", "ของติดโต๊ะที่หยิบใช้ทุกวัน", "{product} ในชีวิตจริงเป็นแบบนี้"],
    captionHooks: ["ของติดบ้านที่หยิบใช้ทุกวัน", "ชีวิตง่ายขึ้นนิดนึงจริง ๆ"] },
  PRODUCT_DETAIL: { format: "PRODUCT_DETAIL", nameTh: "เจาะทุกจุดก่อนซื้อ",
    opening: "the take opens with a finger already pointing at the product's key detail, sharp and well lit",
    camera: "close-up with a gentle rack focus from the detail to the whole product", audio: "soft room ambience",
    hooks: ["ดูให้ชัดก่อนกดตะกร้า", "ซูมให้ดูทีละจุด", "{product} {fact}"],
    captionHooks: ["ดูให้ชัดก่อนตัดสินใจ 🔍", "ซูมให้ดูชัด ๆ ทุกมุม"] },
  BUYING_GUIDE: { format: "BUYING_GUIDE", nameTh: "ป้ายยาแบบมีข้อมูล",
    opening: "the take opens with the hand lifting the product straight toward the camera like showing it to a friend",
    camera: "eye-level medium close-up with a slow push-in", audio: "soft room ambience",
    hooks: ["ป้ายยาแบบมีข้อมูล", "ก่อนกดซื้อ ดูตรงนี้ก่อน", "จะซื้อ {product} ดูตรงไหน"],
    captionHooks: ["ป้ายยาแบบมีข้อมูล 💊", "ก่อนกดซื้อ อ่านตรงนี้ก่อน"] },
  CINEMATIC_HERO: { format: "CINEMATIC_HERO", nameTh: "ช็อตโฆษณาสวยแบบหนัง",
    opening: "the take opens on a striking, premium hero frame: the product catches a sweep of light as the hand sets it down",
    camera: "slow lateral slide with a rack focus that lands on the product", audio: "a low, soft cinematic swell under the ambience",
    hooks: ["{product}", "เรียบ แต่จำได้"], captionHooks: ["เรียบ แต่จำได้ ✨", "ของดีไม่ต้องพูดเยอะ"] },
  UGC_STORY: { format: "UGC_STORY", nameTh: "POV เล่าแบบเพื่อน",
    opening: "the take looks like a candid phone clip: the hand picks the product up casually from the set and turns it to the camera",
    camera: "handheld first-person phone framing, natural and slightly imperfect", audio: "natural room sound, like a real phone recording",
    hooks: ["POV: เจอของที่ตามหามานาน", "บอกต่อแบบเพื่อนบอกเพื่อน"], captionHooks: ["POV: เจอของที่ตามหามานาน", "บอกต่อแบบเพื่อนบอกเพื่อน"] },
};
/** Comparison needs a measured second product, which a single Flow take cannot show honestly. */
export function trendFormatsFor(playbook: CategoryPlaybook): TrendFormat[] {
  const list = playbook.formats.map(f => TREND_FORMATS[f]).filter((f): f is TrendFormat => !!f);
  // Every category gets the always-native TikTok formats too, after its own best ones.
  for (const extra of ["UGC_STORY", "CURIOSITY", "LIFESTYLE"] as const) if (!list.some(f => f.format === extra)) list.push(TREND_FORMATS[extra]!);
  return list;
}

/** Soft calls to action; none promises price, stock or discount. */
const CTAS = ["กดตะกร้าเช็กราคาล่าสุด", "เซฟไว้ก่อนลืม", "ดูรายละเอียดในตะกร้าก่อนสั่ง", "คอมเมนต์บอกหน่อย ชอบไหม", "ส่งให้เพื่อนที่ต้องมี"];
const CATEGORY_TAGS: Record<string, string[]> = {
  WATCH_ACCESSORY: ["#นาฬิกา", "#แต่งตัว"], BEAUTY: ["#สกินแคร์", "#บิวตี้"], HOME_KITCHEN: ["#ของใช้ในบ้าน", "#บ้านน่าอยู่"],
  GADGET: ["#แกดเจ็ต", "#ของมันต้องมี"], FASHION: ["#แฟชั่น", "#outfit"], FOOD_SNACK: ["#ของกิน", "#ขนม"],
  HEALTH_SUPPLEMENT: ["#สุขภาพ"], BABY_TOY: ["#แม่และเด็ก", "#ของเล่น"], PET: ["#ทาสแมว", "#สัตว์เลี้ยง"], GENERAL: ["#ของมันต้องมี"],
};

/** A shopping or seasonal moment in Thailand, by Bangkok date. Lines invite saving to the cart; they never claim a deal. */
export interface ShoppingMoment { key: string; nameTh: string; captionLine: string; hashtag: string; setTouch: string }
export function shoppingMoment(now: Date = new Date()): ShoppingMoment | null {
  const bkk = new Date(now.getTime() + 7 * 3600000), m = bkk.getUTCMonth() + 1, d = bkk.getUTCDate();
  // Double-date sales (1.1 … 12.12): the run-up days and the day itself.
  if (d <= m && d >= m - 2) return { key: `DOUBLE_${m}`, nameTh: `${m}.${m}`, captionLine: `ใส่ตะกร้ารอ ${m}.${m} ไว้ก่อน`, hashtag: `#${m}${m}`,
    setTouch: "a small paper shopping bag sits out of focus in the background" };
  if ((m === 12 && d >= 20) || (m === 1 && d <= 3)) return { key: "NEW_YEAR", nameTh: "ปีใหม่", captionLine: "ไอเดียของขวัญปีใหม่", hashtag: "#ของขวัญปีใหม่",
    setTouch: "a few warm fairy lights glow softly out of focus in the background" };
  if (m === 4 && d <= 15) return { key: "SONGKRAN", nameTh: "สงกรานต์", captionLine: "ของติดตัวช่วงสงกรานต์", hashtag: "#สงกรานต์",
    setTouch: "bright summer light with a few water droplets on the surface nearby" };
  if ((m === 4 && d >= 20) || (m === 5 && d <= 20)) return { key: "BACK_TO_SCHOOL", nameTh: "เปิดเทอม", captionLine: "ของต้องมีก่อนเปิดเทอม", hashtag: "#เปิดเทอม",
    setTouch: "a notebook and pencil sit softly out of focus in the background" };
  if (d >= 25 || d === 1) return { key: "PAYDAY", nameTh: "เงินเดือนออก", captionLine: "เงินเดือนออกแล้ว ใส่ตะกร้าไว้ก่อน", hashtag: "#เงินเดือนออก",
    setTouch: "" };
  if (m === 11 || m === 12 || m === 1) return { key: "COOL_SEASON", nameTh: "หน้าหนาว", captionLine: "ลมหนาวมาแล้ว", hashtag: "#หน้าหนาว",
    setTouch: "a soft knit blanket edge rests in the background in cool morning light" };
  if (m >= 6 && m <= 10) return { key: "RAINY_SEASON", nameTh: "หน้าฝน", captionLine: "หน้าฝนแบบนี้ต้องมี", hashtag: "#หน้าฝน",
    setTouch: "a rain-streaked window glows softly out of focus in the background" };
  return null;
}

const fill = (template: string, product: string, fact?: string) =>
  template.includes("{fact}") && !fact ? null : template.replaceAll("{product}", product).replaceAll("{fact}", fact ?? "");
/** Cuts Thai text at a space, never mid-word, so the voice line can be said inside one 8-second take. */
export function speakable(text: string, max = 70) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max), space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}
const allowed = (playbook: CategoryPlaybook, text: string) => !playbook.forbiddenClaims.some(re => re.test(text));

/** The spoken line for one take: the format's hook, then one verified fact (numbers preferred). */
export function trendNarration(input: { title: string; categoryKey: string; facts: { text: string }[] }, format: TrendFormat, variant = 0) {
  const playbook = categoryPlaybook(input.categoryKey, input.title);
  const facts = input.facts.map(f => f.text.trim()).filter(t => t && allowed(playbook, t));
  const fact = facts.find(t => /[0-9]/.test(t)) ?? facts[0];
  const hooks = format.hooks.map(h => fill(h, input.title, fact)).filter((h): h is string => !!h && allowed(playbook, h));
  const hook = hooks[variant % Math.max(hooks.length, 1)] ?? input.title;
  const line = fact && !hook.includes(fact) ? `${hook} ${fact}` : hook;
  return speakable(line);
}

/** Caption and hashtags for a product clip: hook, fact, seasonal line, soft CTA; category and moment tags. */
export function trendCaption(input: { title: string; categoryKey: string; facts: { text: string }[] }, format: TrendFormat, variant: number, now: Date = new Date()) {
  const playbook = categoryPlaybook(input.categoryKey, input.title), moment = shoppingMoment(now);
  const facts = input.facts.map(f => f.text.trim()).filter(t => t && allowed(playbook, t));
  const hooks = format.captionHooks.map(h => fill(h, input.title, facts[0])).filter((h): h is string => !!h && allowed(playbook, h));
  const lines = [hooks[variant % Math.max(hooks.length, 1)], `${input.title}${facts.length ? ` · ${facts.slice(0, 2).join(" · ")}` : ""}`,
    moment?.captionLine, CTAS[variant % CTAS.length]].filter(Boolean);
  const hashtags = [...new Set(["#ป้ายยา", ...(CATEGORY_TAGS[playbook.family] ?? CATEGORY_TAGS.GENERAL), ...(moment ? [moment.hashtag] : []), "#tiktokshop", "#fyp"])];
  return { caption: lines.join("\n"), hashtags, moment };
}
