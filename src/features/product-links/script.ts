import { categoryPlaybook, type AdFormat, type CategoryFamily } from "@/features/creative/category-insight";
import { shoppingMoment, trendFormatsFor, type TrendFormat } from "@/features/creative/trend-playbook";
import { claimIssues } from "@/features/creative/claims";
import { ACTIONS, SETS, type HandAction, type SetStyle } from "@/features/creative/flow-native";
import { checkProductTruth } from "@/features/compliance/compliance";
import { PLATFORM_LABEL, type ProductPlatform } from "./link";

/**
 * The script writer for clips made from a pasted Shopee / Lazada link. It is deliberately plain: it only repeats
 * what the product page says (the facts the owner kept), never adds results, rankings, prices or urgency, and sends
 * people to the link for price and details. A longer clip is several 8-second Flow takes cut together: every take
 * shares one set, light and pair of hands (continuity), while the framing, the hand action and the listing photo
 * used as reference change from take to take, so the product is seen from different sides.
 */
export const PRODUCT_SCRIPT_VERSION = "product-link-script-v2";
export const CLIP_LENGTHS = [8, 16, 24, 32, 40] as const;
export type ClipLength = typeof CLIP_LENGTHS[number];
export type ShotRole = "HERO" | "HOOK" | "DETAIL" | "IN_USE" | "OVERVIEW" | "CLOSE";

export interface ProductShot {
  position: number; role: ShotRole; roleTh: string; action: HandAction; camera: string;
  /** What the Thai voice says in this take; also burned in as the subtitle (Reels autoplay muted). */
  narration: string;
  /** Which of the chosen listing photos Flow gets as the reference image for this take. */
  imageIndex: number;
  prompt: string;
}
export interface DroppedFact { text: string; reason: string }
export interface ProductClipScript {
  version: string; lengthSeconds: ClipLength; family: CategoryFamily; setId: string; setTh: string;
  shortName: string; facts: string[]; dropped: DroppedFact[]; shots: ProductShot[];
  /** Caption for Facebook / Instagram / YouTube description (product link included). */
  caption: string; hashtags: string[];
  /** The first comment posted under the clip: the product link. */
  comment: string;
  youtubeTitle: string;
  compliance: { status: "PASS" | "REVIEW" | "REJECT"; issues: string[] };
  disclosure: string;
  /** The short-video format the clip is built around (trend playbook), its big on-screen opening line, and the shopping moment. */
  format?: AdFormat; formatTh?: string; hookText?: string; moment?: string | null;
}
export interface ScriptInput {
  platform: ProductPlatform; link: string; title: string; facts: string[]; imageCount: number; lengthSeconds: ClipLength;
  /** Picks among equally good sets/hooks, so two clips of one product do not look the same. */
  variant?: number;
  /** For the seasonal / payday shopping moment (Bangkok date). */
  now?: Date;
}

const ROLE_TH: Record<ShotRole, string> = { HERO: "โชว์สินค้า", HOOK: "เปิดเรื่อง", DETAIL: "ซูมรายละเอียด", IN_USE: "มุมใช้งาน", OVERVIEW: "มุมกว้างอีกด้าน", CLOSE: "ปิดท้าย + ลิงก์" };
/** One 8-second Flow take per role; each added take shows the product from a new side. */
export const ROLES: Record<ClipLength, ShotRole[]> = {
  8: ["HERO"], 16: ["HOOK", "CLOSE"], 24: ["HOOK", "DETAIL", "CLOSE"], 32: ["HOOK", "DETAIL", "IN_USE", "CLOSE"], 40: ["HOOK", "DETAIL", "IN_USE", "OVERVIEW", "CLOSE"],
};

/** Per-role framing and how each take starts and ends, so the cut from one take to the next reads as one movement. */
const ROLE_SHOT: Record<ShotRole, { action: HandAction; camera: string; framing: string; start: string; end: string; timing: string }> = {
  HERO: { action: "LIFT_AND_PRESENT", camera: "slow, smooth push-in with very slight natural handheld drift",
    framing: "medium close-up, the product is the hero in the middle third of the frame",
    start: "the product rests on the set and a hand is already reaching for it", end: "the product is held steady facing the camera, fully visible and sharp",
    timing: "the hand is moving within the first half second; the product is lifted and facing the camera by second 3; hold it steady and sharp from second 3 to second 8" },
  HOOK: { action: "LIFT_AND_PRESENT", camera: "slow, smooth push-in with very slight natural handheld drift",
    framing: "medium close-up opening shot, product in the middle third of the frame",
    start: "the product rests on the set and a hand is already reaching for it", end: "the product is held facing the camera, close to the lens",
    timing: "the hand is moving within the first half second; the product is lifted toward the camera by second 3 and held steady to the end" },
  DETAIL: { action: "POINT_TO_DETAIL", camera: "locked-off macro shot with a gentle rack focus onto the detail",
    framing: "macro close-up on the product's most distinctive detail exactly as it appears in the reference image",
    start: "the product is already held in the hand close to the camera (continuing from the previous shot)", end: "the hand keeps the product still with the detail in sharp focus",
    timing: "the finger reaches the detail by second 2 and hovers there without pressing; hold still from second 4 to second 8" },
  IN_USE: { action: "TURN_TO_LIGHT", camera: "slow lateral slide at table height from a three-quarter angle",
    framing: "three-quarter angle from a lower camera height, showing the product's shape and size against the hands",
    start: "the product is held in both hands in the same set", end: "the product faces the camera again, steady",
    timing: "a slow quarter turn between second 1 and second 5, then hold still facing the camera to the end" },
  OVERVIEW: { action: "LIFT_AND_PRESENT", camera: "slow arc around the product from a high three-quarter angle",
    framing: "wider shot from a higher angle showing the whole product and its other side on the same set",
    start: "the product is held a little above the set, turned to show the side not seen yet", end: "the product is held steady, whole shape visible",
    timing: "the camera arc and a slight lift happen between second 1 and second 5; hold steady to the end" },
  CLOSE: { action: "PLACE_ON_SURFACE", camera: "slow pull-back that settles into a locked-off hero frame",
    framing: "clean hero shot, the product centred on the set with space above it for the end caption",
    start: "the hand is holding the product just above the set", end: "the product sits centred on the set, hands gone, frame perfectly still",
    timing: "the product is placed down by second 3 and the hand leaves by second 4; the last 3 seconds are perfectly still" },
};

const NEGATIVE = [
  "any change to the product's shape, colours, logo, model name or printed text versus the reference image",
  "changing, animating or flickering digits or screen content", "extra buttons, extra text, extra logos or a different product",
  "gloves or covered hands", "faces, testimonials, captions, subtitles, watermarks, price tags or any on-screen text",
  "the product performing a function, result or before/after effect not shown in the reference", "cuts or scene changes inside the take",
  "objects morphing, duplicating, or appearing and vanishing on their own",
  // 10 Nov (KAGE cushion "พร้อมสปาตูล่า"): Flow turned the bundled spatula into a spoon waved through every take.
  "spoons, spatulas, cutlery, brushes, applicators, cables or any other accessory or tool next to the product",
];
/** A bundled extra ("ตลับจริงพร้อมสปาตูล่า", "แถมฟรี…"): never the subject of a take or a spoken line. */
const ACCESSORY = /(^|\s)(มา)?(พร้อม|แถม|ฟรี|free\b|with\b)|สปาตูล่า|spatula|ช้อน|spoon|พัฟ|puff|แปรง|brush|applicator/i;
/** The product itself, without the shop's second half of the title or the bundled extras. */
export function mainProductTitle(title: string) {
  const first = title.split(/[|｜]/)[0] ?? title;
  const words = cleanTitle(first).split(" "), cut = words.findIndex(w => ACCESSORY.test(` ${w}`));
  return (cut > 1 ? words.slice(0, cut) : words).join(" ").trim() || cleanTitle(title);
}

/** Words a seller page uses that this clip must never repeat (unverifiable, exaggerated, or sales pressure). */
const EXAGGERATION = /ที่สุด|อันดับ\s*1|no\.?\s*1|ขายดี|ยอดขาย|แท้\s*100|ของแท้|เหนือกว่า|ปัง|เวอร์|มหัศจรรย์|ทันใจ|ทันที|ถาวร|การันตี|guarantee|best|#1|100\s*%|ไม่ผิดหวัง|ทุกคนต้องมี|จำนวนจำกัด|ด่วน|หมดแล้วหมดเลย/i;
const PRICE = /฿|บาท|ราคา|ลด\s*\d|ส่วนลด|โปร|sale|flash|ฟรี|แถม|cod|ปลายทาง/i;
const EFFECT = /ขาว|ใส|ลดสิว|สิว|ฝ้า|กระ|ริ้วรอย|ตีนกา|กระชับ|หน้าเด็ก|ผอม|ลดน้ำหนัก|เผาผลาญ|ลดไขมัน|ลดพุง|บำรุง|รักษา|บรรเทา|แก้ปวด|ภูมิคุ้มกัน|ป้องกัน|ฆ่าเชื้อ\s*99|เชื้อโรค|ฟื้นฟู|ชะลอวัย|ผมร่วง|ผมดก|อาการ|โรค/i;
const EFFECT_FAMILIES: CategoryFamily[] = ["BEAUTY", "HEALTH_SUPPLEMENT", "FOOD_SNACK", "BABY_TOY", "PET"];

const FAMILY_TAG: Record<CategoryFamily, string> = {
  WATCH_ACCESSORY: "#นาฬิกา", BEAUTY: "#บิวตี้", HOME_KITCHEN: "#ของใช้ในบ้าน", GADGET: "#แกดเจ็ต", FASHION: "#แฟชั่น", FOOD_SNACK: "#ของกิน",
  HEALTH_SUPPLEMENT: "#สุขภาพ", BABY_TOY: "#ของเล่นเด็ก", PET: "#ของใช้สัตว์เลี้ยง", GENERAL: "#ของน่าใช้",
};

const chars = (text: string) => [...text.normalize("NFC")].length;
/** Cuts at the last space before `max` characters, or hard at `max` when the text has no spaces (Thai). */
export function shorten(text: string, max: number) {
  const value = text.replace(/\s+/g, " ").trim();
  if (chars(value) <= max) return value;
  const head = [...value].slice(0, max).join("");
  const space = head.lastIndexOf(" ");
  return (space > max * 0.5 ? head.slice(0, space) : head).replace(/[\s,;:–-]+$/, "");
}

/** A speakable product name from a keyword-stuffed marketplace title: no brackets, emoji, shipping words or SKU noise. */
export function cleanTitle(title: string) {
  return title.normalize("NFC")
    .replace(/[【\[(（{《][^】\])）}》]*[】\])）}》]/g, " ")
    .replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}]/gu, " ")
    .replace(/พร้อมส่ง|ส่งไว|ส่งฟรี|ของแท้|แท้\s*100%?|ราคาถูก|ถูกที่สุด|ขายดี|มีประกัน|ประกันศูนย์|ใหม่ล่าสุด|hot\s*sale|best\s*seller|flash\s*sale|cod/gi, " ")
    .replace(/[|｜/\\]+/g, " ").replace(/\s+/g, " ").trim() || title.trim();
}
export function shortProductName(title: string) {
  return shorten(cleanTitle(title), 34) || "สินค้านี้";
}

/** Keeps only plain, checkable product facts; everything else is dropped with the reason shown to the owner. */
export function screenFacts(facts: string[], family: CategoryFamily) {
  const kept: string[] = [], dropped: DroppedFact[] = [], seen = new Set<string>();
  for (const raw of facts) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    if (EXAGGERATION.test(text) || checkProductTruth(text, []).status !== "PASS") { dropped.push({ text, reason: "เกินจริงหรือพิสูจน์ไม่ได้" }); continue; }
    if (ACCESSORY.test(text)) { dropped.push({ text, reason: "ของแถม/อุปกรณ์เสริม ไม่ใช่ตัวสินค้า" }); continue; }
    if (PRICE.test(text)) { dropped.push({ text, reason: "ราคา/โปรเปลี่ยนได้ ให้คนดูที่ลิงก์" }); continue; }
    if (EFFECT_FAMILIES.includes(family) && EFFECT.test(text)) { dropped.push({ text, reason: "อ้างผลลัพธ์/สรรพคุณ ต้องมีเอกสารรับรอง" }); continue; }
    kept.push(shorten(text, 48));
    if (kept.length >= 5) break;
  }
  return { kept, dropped };
}

function pick<T>(items: readonly T[], seed: number) { return items[((seed % items.length) + items.length) % items.length]; }
function hash(text: string) { let h = 0; for (const c of text) h = (h * 31 + c.codePointAt(0)!) | 0; return Math.abs(h); }

/** Comment and share prompts: they lift reach on every platform and never promise price, stock or results. */
const ENGAGE = ["คอมเมนต์บอกหน่อย ชอบแบบนี้ไหม 👇", "เซฟไว้ก่อนลืม 📌", "แท็กเพื่อนที่ต้องมีอันนี้ 👀", "ชอบสีไหน/แบบไหน คอมเมนต์บอกได้ 💬"];
const plain = (text: string) => text.replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

/**
 * The format the clip is built around, from the trend playbook: the category's strongest formats first, rotated by
 * variant so a remake looks different. Its hook lines are filled from the name and the kept facts only and dropped
 * if they hit the exaggeration list or the category's forbidden claims.
 */
export function pickTrend(title: string, family: CategoryFamily, name: string, facts: string[], seed: number) {
  const playbook = categoryPlaybook("", title);
  const ok = (text: string) => !EXAGGERATION.test(text) && !playbook.forbiddenClaims.some(re => re.test(text));
  const fact = family === "HEALTH_SUPPLEMENT" ? undefined : facts.find(f => /\d/.test(f)) ?? facts[0];
  const fill = (t: string) => t.includes("{fact}") && !fact ? null : t.replaceAll("{product}", name).replaceAll("{fact}", fact ?? "");
  const formats = trendFormatsFor(playbook).slice(0, 5);
  const format = pick(formats, seed);
  const spokenHooks = format.hooks.map(fill).filter((h): h is string => !!h && ok(h));
  const captionHooks = format.captionHooks.map(fill).filter((h): h is string => !!h && ok(h));
  const spoken = spokenHooks.length ? shorten(pick(spokenHooks, seed >> 3), 64) : "";
  const captionHook = captionHooks.length ? pick(captionHooks, seed >> 5) : `${name} ✨`;
  // The big words on screen for the first seconds: Reels and Shorts start muted. Thai has no spaces to cut at, so a
  // line that does not fit whole is never cut: the next one that fits is used.
  const fits = (t: string) => !!t && chars(t) <= 30;
  const hookText = [plain(captionHook), ...captionHooks.map(plain), plain(spoken), name].find(fits) ?? shorten(name, 30);
  return { format, spoken, captionHook, hookText };
}

const HOOKS = ["เจอ{n}ตัวนี้มา ขอโชว์ให้ดูหน่อย", "ใครกำลังหา{n}อยู่ ดูตัวนี้ก่อน", "{n} หน้าตาแบบนี้ ดูกันชัด ๆ"];
const CTA_SHORT = "ลิงก์สินค้าอยู่ในคอมเมนต์";
const CTA_LONG = "รายละเอียดกับราคาล่าสุด ดูที่ลิงก์ในคอมเมนต์นะ";

/** The Thai line spoken in each take, from the product name and the kept facts only. */
export function narrationFor(role: ShotRole, name: string, facts: string[], seed: number, family: CategoryFamily, total = 1, trendHook?: string) {
  // Supplements: the name and the link only. A spoken benefit is a health claim on every platform.
  const usable = family === "HEALTH_SUPPLEMENT" ? [] : facts;
  const hook = trendHook || pick(HOOKS, seed).replace("{n}", name);
  switch (role) {
    case "HERO": return shorten(usable[0] ? `${name} ${usable[0]} ${CTA_SHORT}` : `${hook} ${CTA_SHORT}`, 70);
    case "HOOK": return shorten(hook, 64);
    case "DETAIL": return shorten(usable[0] ?? "ดูรายละเอียดตรงนี้กันชัด ๆ", 50);
    case "IN_USE": return shorten(usable[1] ?? usable[0] ?? "มุมนี้ให้เห็นทรงกับขนาดชัด ๆ", 50);
    case "OVERVIEW": return shorten(usable[2] ?? "อีกมุม ให้เห็นทรงเต็ม ๆ", 50);
    // In a 16-second clip the closing take is the only one left to carry a fact; in 32 seconds the facts came earlier.
    case "CLOSE": return shorten(total === 2 && usable[0] ? `${usable[0]} ${CTA_SHORT}` : CTA_LONG, 70);
  }
}

export function shotPrompt(input: { title: string; style: SetStyle; role: ShotRole; position: number; total: number; narration: string; trend?: TrendFormat; setTouch?: string }) {
  const shot = ROLE_SHOT[input.role], s = input.style, first = input.position === 0, last = input.position === input.total - 1;
  return [
    `Use the attached reference image as the exact product (${input.title}). Show only this product itself: leave out anything else in the reference photo (spatula, spoon, brush, puff, box, cable or other bundled extra). Photoreal vertical 9:16 video, 8 seconds, one continuous take.`,
    // The first second decides whether people keep watching: open on the format's scroll-stopping beat, already in motion.
    ...(first && input.trend ? [`OPENING (first second, made to stop the scroll on Reels/Shorts/TikTok): ${input.trend.opening}. Never start on a still frame.`] : []),
    ...(last && input.total > 1 ? ["LOOP: the final frame mirrors the composition of the advert's first frame, so the clip loops seamlessly when it replays."] : []),
    ...(input.total > 1 ? [`ADVERT CONTINUITY: this is shot ${input.position + 1} of ${input.total} of one product advert that is cut together. Every shot uses the same set, props, light, palette and the same hands and sleeve, so the cuts feel like one place and one person. START: ${shot.start}. END: ${shot.end}.`] : []),
    `SET: ${s.set}; props: ${s.props}${input.setTouch ? `; ${input.setTouch}` : ""}. Styled like a premium product advert, uncluttered.`,
    `SHOT: ${shot.framing}.`,
    `ACTION: ${ACTIONS[shot.action].en}. Hands: ${s.hands}.`,
    "CONTINUITY: there is exactly one product, the same single object from the moment it is in frame to the last frame; it never appears, multiplies or changes on its own. The set and props stay fixed for the whole take.",
    `CAMERA: ${first && input.trend ? input.trend.camera : shot.camera}. Shallow depth of field, product always in sharp focus.`,
    `TIMING: ${shot.timing}.`,
    `LIGHT & COLOUR: ${s.lighting}; palette ${s.palette}; mood ${s.mood}.`,
    "PRODUCT FIDELITY: keep the product identical to the reference — same shape, proportions, colours, logo and every printed word; any display shows exactly the same characters as the reference and stays perfectly still.",
    `AUDIO: a warm, natural, upbeat Thai voice (like a friend sharing a find, not an announcer) says only: "${input.narration}" — nothing else; soft room ambience and crisp, satisfying handling sounds${first && input.trend ? `; ${input.trend.audio}` : ""}, no music.`,
    `AVOID: ${NEGATIVE.join("; ")}.`,
  ].join("\n");
}

export function writeProductClip(input: ScriptInput): ProductClipScript {
  const family = categoryPlaybook("", input.title).family;
  const seed = hash(input.title) + (input.variant ?? 0);
  const sets = SETS[family] ?? SETS.GENERAL, style = pick(sets, seed);
  // Beauty, supplements, food, baby and pet names often carry an effect claim ("หน้าใส"): it is not spoken.
  const name = EFFECT_FAMILIES.includes(family)
    ? shorten(cleanTitle(input.title).split(" ").filter(w => !EFFECT.test(w)).join(" "), 34) || shortProductName(input.title) : shortProductName(input.title);
  const { kept, dropped } = screenFacts(input.facts, family);
  const roles = ROLES[input.lengthSeconds];
  const images = Math.max(1, input.imageCount);
  const trend = pickTrend(input.title, family, name, kept, seed);
  const moment = shoppingMoment(input.now ?? new Date());
  const shots: ProductShot[] = roles.map((role, position) => {
    const narration = narrationFor(role, name, kept, seed, family, roles.length, trend.spoken);
    const shot = ROLE_SHOT[role];
    // The watch family shows the product worn for the use-angle take; the face is never shown.
    const action: HandAction = role === "IN_USE" && family === "WATCH_ACCESSORY" ? "WRIST_GLANCE" : shot.action;
    return { position, role, roleTh: ROLE_TH[role], action, camera: shot.camera, narration, imageIndex: position % images,
      prompt: shotPrompt({ title: mainProductTitle(input.title).slice(0, 200), style, role, position, total: roles.length, narration, trend: trend.format, setTouch: moment?.setTouch || undefined }) };
  });
  const store = PLATFORM_LABEL[input.platform];
  const hashtags = [...new Set([`#${store}`, "#ป้ายยา", FAMILY_TAG[family], ...(moment ? [moment.hashtag] : []), `#${store}Affiliate`, "#Reels", "#Shorts"])];
  const disclosure = "คลิปนี้สร้างด้วย AI จากภาพสินค้าในหน้าร้าน · มีลิงก์ affiliate (อาจได้ค่าคอมมิชชั่นเมื่อมีการสั่งซื้อ)";
  const caption = [
    // First line = the scroll-stopping hook (it is all people see before "more"), then what it is.
    trend.captionHook,
    name,
    ...kept.slice(0, 3).map(f => `• ${f}`),
    ...(moment ? [moment.captionLine] : []),
    ENGAGE[seed % ENGAGE.length],
    "",
    `🛒 ดูสินค้าใน ${store}: ${input.link}`,
    "ราคาและโปรโมชันดูที่ลิงก์ (อาจเปลี่ยนตามร้านค้า)",
    disclosure,
    hashtags.join(" "),
  ].join("\n").slice(0, 2000);
  const comment = `🛒 ลิงก์สินค้า (${store}): ${input.link}`;
  const youtubeTitle = shorten(`${trend.hookText} | ${name} #Shorts`, 95);
  const spoken = [...shots.map(s => s.narration), trend.hookText];
  const truth = checkProductTruth([...spoken, caption].join("\n"), kept);
  const claims = claimIssues(spoken, "GENERATIVE", [input.title, ...kept]);
  const issues = [...truth.issues.map(i => `${i.code}: ${i.message}`), ...claims.map(c => `${c.code}: ${c.text}`)];
  const status = truth.status === "REJECT" ? "REJECT" : truth.status === "REVIEW" || claims.length ? "REVIEW" : "PASS";
  return { version: PRODUCT_SCRIPT_VERSION, lengthSeconds: input.lengthSeconds, family, setId: style.id, setTh: style.nameTh, shortName: name, facts: kept, dropped,
    shots, caption, hashtags, comment, youtubeTitle, compliance: { status, issues }, disclosure,
    format: trend.format.format, formatTh: trend.format.nameTh, hookText: trend.hookText, moment: moment?.key ?? null };
}
