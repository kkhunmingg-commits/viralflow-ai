/** Flow-native Shot Director: plans adverts the way the owner's approved reference looks — one continuous,
 * photoreal take per shot in which hands present the real product inside a styled set, with natural light,
 * gentle camera motion and an audible track, and no pasted cards or burned-in slides.
 *
 * The product photograph goes to Flow as the reference (ingredient) image, and every prompt pins the product's
 * exact look: shape, colours, logo, printed text and any display digits must match the reference and must not
 * animate. Hands may hold, turn, point to and rest a product; they never operate a feature the evidence does
 * not support, and nothing claims to be a customer review. Output is AI-generated and is disclosed as such. */
import { categoryPlaybook, type CategoryFamily } from "./category-insight";
import type { DirectorInput } from "./ad-director";
import { OWNER_STYLE_VERDICTS, rejectedTags } from "./owner-taste";

export const FLOW_NATIVE_VERSION = "flow-native-director-v1";
export interface SetStyle { id: string; nameTh: string; set: string; props: string; lighting: string; palette: string; hands: string; mood: string }
export type HandAction = "LIFT_AND_PRESENT" | "TURN_TO_LIGHT" | "POINT_TO_DETAIL" | "PLACE_ON_SURFACE" | "WRIST_GLANCE";
export interface ShotOption {
  id: string; family: CategoryFamily; style: SetStyle; action: HandAction; camera: string; audio: string;
  narrationTh: string | null; fidelityRisk: "LOW" | "MEDIUM" | "HIGH"; fidelityNotes: string[];
  score: number; reasons: string[]; prompt: string; negative: string[];
}
export interface FlowNativePlan {
  version: string; productTitle: string; shots: ShotOption[]; selected: ShotOption[]; durationSeconds: number; generations: number;
  estimatedCredits: number | null; settings: { model: string; aspect: "9:16"; resolution: "720p"; seconds: 8; outputs: 1; mode: "INGREDIENTS_IMAGE_TO_VIDEO" };
  referenceAssetId: string; aigcDisclosure: string; requiresOwnerApproval: true; tasteBasis: string[];
}

/** Set dressing per category, written like an art director's brief. Several per family so clips do not repeat. */
const SETS: Partial<Record<CategoryFamily, SetStyle[]>> & { GENERAL: SetStyle[] } = {
  WATCH_ACCESSORY: [
    { id: "oak-desk-morning", nameTh: "โต๊ะไม้โอ๊กยามเช้า", set: "a light-oak desk beside a sheer-curtained window", props: "a linen-bound notebook, a small ceramic coffee cup, a brass key ring, a sprig of eucalyptus in a glass", lighting: "soft diffused morning daylight from the side with a gentle warm bounce", palette: "warm neutrals, cream, oak and sage green", hands: "bare natural skin hands with short neat nails (no gloves), a light-grey knit sweater cuff visible at the wrist", mood: "calm, simple, everyday" },
    { id: "concrete-street", nameTh: "สตรีทคอนกรีตยามเย็น", set: "a matte concrete ledge by a city window at golden hour", props: "a folded denim jacket, a paper coffee cup, a pair of sunglasses", lighting: "low golden-hour sun with long soft shadows", palette: "warm amber, concrete grey and indigo denim", hands: "natural hands with a rolled-up denim sleeve", mood: "casual, retro, confident" },
    { id: "studio-paper", nameTh: "สตูดิโอกระดาษสีพาสเทล", set: "a seamless pale-blue paper sweep on a small tabletop", props: "two stacked pastel acrylic blocks and a soft shadow pattern from a plant", lighting: "large soft key light from above-left, clean highlights", palette: "pale blue, white and a hint of navy", hands: "clean natural hands, no jewellery", mood: "minimal, crisp, modern" },
  ],
  BEAUTY: [{ id: "vanity-tulips", nameTh: "โต๊ะเครื่องแป้งกับดอกทิวลิป", set: "a warm white vanity table", props: "a mushroom table lamp glowing softly, pink tulips in a glass vase, folded white towel", lighting: "soft window daylight plus the warm lamp glow", palette: "blush pink, cream and warm white", hands: "manicured natural hands with nude nails", mood: "soft, clean, self-care" }],
  HOME_KITCHEN: [{ id: "bright-kitchen", nameTh: "ครัวสว่างโทนไม้", set: "a tidy kitchen counter of light wood and white tiles", props: "a bowl of lemons, a linen towel, a small potted herb", lighting: "bright natural daylight", palette: "white, light wood and fresh green", hands: "natural hands, sleeves rolled up", mood: "fresh, organised" }],
  GADGET: [{ id: "dark-desk-neon", nameTh: "โต๊ะเทคแสงนีออน", set: "a dark walnut desk", props: "a felt desk mat, a mechanical keyboard edge out of focus", lighting: "soft key light with a cyan rim light", palette: "charcoal, walnut and cyan accents", hands: "natural hands, dark sleeve", mood: "sleek, techy" }],
  GENERAL: [{ id: "neutral-table", nameTh: "โต๊ะมินิมอลโทนอุ่น", set: "a minimal table near a bright window", props: "a small vase with greenery and a folded linen cloth", lighting: "soft natural daylight", palette: "warm neutrals", hands: "clean natural hands", mood: "simple, inviting" }],
};
const ACTIONS: Record<HandAction, { en: string; th: string; risk: "LOW" | "MEDIUM" | "HIGH" }> = {
  LIFT_AND_PRESENT: { en: "a hand slowly lifts the product from the surface and presents it toward the camera, holding it steady so it is fully visible", th: "หยิบขึ้นมาโชว์ตรงหน้ากล้อง", risk: "LOW" },
  TURN_TO_LIGHT: { en: "two hands gently turn the product a quarter turn so the light glides across its surface, then hold it still facing the camera", th: "หมุนรับแสงแล้วหยุดหันหน้าเข้ากล้อง", risk: "MEDIUM" },
  POINT_TO_DETAIL: { en: "one hand holds the product while an index finger points to and hovers over its key detail without pressing anything", th: "ชี้ให้ดูรายละเอียดเด่นโดยไม่กด", risk: "LOW" },
  PLACE_ON_SURFACE: { en: "a hand places the product down on the set and slides it slightly into the light, then withdraws", th: "วางลงบนฉากแล้วเลื่อนเข้าหาแสง", risk: "LOW" },
  WRIST_GLANCE: { en: "a person's wrist, wearing the product, rises into frame and pauses as if checking the time, face never shown", th: "ยกข้อมือขึ้นมาดูเวลา (ไม่เห็นหน้า)", risk: "HIGH" },
};
const CAMERAS = ["slow, smooth push-in with very slight natural handheld drift", "locked-off tripod shot with a gentle rack focus from prop to product", "slow lateral slide at table height"];

function fidelity(family: CategoryFamily, action: HandAction) {
  const notes: string[] = [];
  let risk = ACTIONS[action].risk;
  if (family === "WATCH_ACCESSORY") { notes.push("หน้าปัดดิจิทัลเสี่ยงตัวเลขเพี้ยน: บังคับให้ตัวเลขนิ่งตามภาพอ้างอิง และต้องตรวจทุกเฟรมก่อนใช้"); if (risk === "LOW") risk = "MEDIUM"; }
  if (action === "WRIST_GLANCE") notes.push("การสวมใส่ต้องมีคนจริงที่ได้รับอนุญาตหรือระบุชัดว่าเป็นภาพ AI และไม่อ้างเป็นรีวิว");
  if (action === "TURN_TO_LIGHT") notes.push("การหมุนทำให้ AI ต้องเดาด้านที่ไม่มีในภาพอ้างอิง");
  return { risk, notes };
}

export function flowNativePrompt(input: Pick<DirectorInput, "product" | "facts">, style: SetStyle, action: HandAction, camera: string, narrationTh: string | null) {
  const negative = ["any change to the product's shape, colours, strap, logo, model name or printed text versus the reference image",
    "changing, animating or flickering digits or screen content", "extra buttons, extra text, extra logos or a different product",
    "gloves, mittens or covered hands", "faces, testimonials, captions, subtitles, watermarks or on-screen text", "the product being used to perform a feature it is not shown performing in the reference", "cuts or scene changes"];
  const prompt = [
    `Use the attached reference image as the exact product (${input.product.title}). Photoreal vertical 9:16 video, 8 seconds, one continuous take.`,
    `SET: ${style.set}; props: ${style.props}. Styled like a premium product advert, uncluttered, product is the hero in the middle third.`,
    `ACTION: ${ACTIONS[action].en}. Hands: ${style.hands}.`,
    `CAMERA: ${camera}. Shallow depth of field, product always in sharp focus.`,
    `LIGHT & COLOUR: ${style.lighting}; palette ${style.palette}; mood ${style.mood}.`,
    `PRODUCT FIDELITY: keep the product identical to the reference — same shape, proportions, colours, strap, logo and every printed word; any display shows exactly the same characters as the reference and stays perfectly still.`,
    `AUDIO: ${narrationTh ? `a warm, natural Thai voice says only: "${narrationTh}" — nothing else; ` : ""}soft room ambience and subtle handling sounds, no music.`,
    `AVOID: ${negative.join("; ")}.`,
  ].join("\n");
  return { prompt, negative };
}

/** Ranks set × action × camera options for this product and returns the best ones for the requested length. */
export function planFlowNative(input: Pick<DirectorInput, "product" | "facts" | "assets"> & { history?: { styleIds?: string[]; actions?: HandAction[] } },
  options: { durationSeconds?: 8 | 16 | 24; creditsPerGeneration?: number | null; model?: string } = {}): FlowNativePlan {
  const reference = input.assets.find(a => a.rightsCleared && a.kind === "REAL_IMAGE");
  if (!reference) throw new Error("FLOW_NATIVE_REQUIRES_CLEARED_PRODUCT_IMAGE");
  const family = categoryPlaybook(input.product.categoryKey, input.product.title).family;
  const sets = SETS[family] ?? SETS.GENERAL, recentSets = new Set(input.history?.styleIds ?? []), recentActions = new Set(input.history?.actions ?? []);
  const actions = (Object.keys(ACTIONS) as HandAction[]).filter(a => a !== "WRIST_GLANCE" || family === "WATCH_ACCESSORY");
  // Narration only repeats verified facts, kept short enough to be said inside one take.
  const fact = input.facts.find(f => /[0-9]/.test(f.text)) ?? input.facts[0];
  const narrationTh = fact ? `${input.product.title} ${fact.text}`.slice(0, 60) : null;
  const shots: ShotOption[] = [];
  sets.forEach((style, si) => actions.forEach((action, ai) => {
    const camera = CAMERAS[(si + ai) % CAMERAS.length], f = fidelity(family, action), reasons: string[] = [];
    let score = 70;
    if (f.risk === "LOW") { score += 12; reasons.push("ความเสี่ยงสินค้าเพี้ยนต่ำ"); } else if (f.risk === "MEDIUM") { score += 4; reasons.push("ความเสี่ยงสินค้าเพี้ยนปานกลาง"); } else { score -= 15; reasons.push("ความเสี่ยงสูง: ต้องตรวจละเอียด"); }
    if (action === "LIFT_AND_PRESENT" || action === "POINT_TO_DETAIL") { score += 8; reasons.push("มือมีปฏิสัมพันธ์กับสินค้าแบบเดียวกับคลิปที่เจ้าของชอบ"); }
    if (recentSets.has(style.id)) { score -= 12; reasons.push("ฉากซ้ำกับคลิปล่าสุด"); }
    if (recentActions.has(action)) { score -= 6; reasons.push("ท่าซ้ำกับคลิปล่าสุด"); }
    score -= si * 2;
    const { prompt, negative } = flowNativePrompt(input, style, action, camera, narrationTh);
    shots.push({ id: `${style.id}:${action}`, family, style, action, camera, audio: narrationTh ? "Thai VO + ambience" : "ambience", narrationTh,
      fidelityRisk: f.risk, fidelityNotes: f.notes, score, reasons, prompt, negative });
  }));
  const ranked = shots.toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const count = (options.durationSeconds ?? 8) / 8;
  // Longer adverts are several takes; each must differ in set or action, never the same shot twice.
  const selected: ShotOption[] = [];
  for (const s of ranked) { if (selected.length >= count) break; if (!selected.some(x => x.style.id === s.style.id && x.action === s.action) && !selected.some(x => x.action === s.action)) selected.push(s); }
  const rejected = rejectedTags();
  return { version: FLOW_NATIVE_VERSION, productTitle: input.product.title, shots: ranked, selected, durationSeconds: count * 8, generations: selected.length,
    estimatedCredits: options.creditsPerGeneration == null ? null : selected.length * options.creditsPerGeneration,
    settings: { model: options.model ?? "Veo 3.1 - Lite", aspect: "9:16", resolution: "720p", seconds: 8, outputs: 1, mode: "INGREDIENTS_IMAGE_TO_VIDEO" },
    referenceAssetId: reference.id, aigcDisclosure: "เนื้อหาสร้างด้วย AI จากภาพสินค้าจริง (เปิดป้าย AI-generated ตอนโพสต์)", requiresOwnerApproval: true,
    tasteBasis: [...OWNER_STYLE_VERDICTS.filter(v => v.verdict === "APPROVED").map(v => `ชอบ: ${v.reasonTh}`), ...[...rejected].map(t => `ไม่เอา: ${OWNER_STYLE_VERDICTS.find(v => v.tag === t)!.reasonTh}`)] };
}
