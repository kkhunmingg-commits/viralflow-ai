import { planFlowNative, type HandAction } from "@/features/creative/flow-native";
import type { DirectorFact } from "@/features/creative/ad-director";
import { categoryPlaybook } from "@/features/creative/category-insight";
import { shoppingMoment, trendCaption, trendFormatsFor } from "@/features/creative/trend-playbook";
import type { FlowClipKind } from "./contracts";

/** A product the one-click search found: best-selling (by stored score) with a cleared photograph. */
export interface FarmProduct {
  id: string; title: string; categoryKey: string; imagePath: string; imageAssetId: string; facts: DirectorFact[];
}
export interface PlannedClip {
  kind: FlowClipKind; productId: string | null; title: string; prompt: string; caption: string; hashtags: string[];
  referenceImagePath: string | null;
}

/** Warm-up concepts: one calm, satisfying, real-looking 8-second take that invites a follow. No products, no claims. */
const GROWTH_CONCEPTS = [
  { title: "กาแฟดริปยามเช้า", hashtags: ["#กาแฟ", "#morningroutine"], line: "เช้านี้เริ่มด้วยกาแฟแก้วโปรด",
    scene: "hands slowly pour hot water from a gooseneck kettle over a pour-over coffee dripper on a light-oak counter; steam rises in soft morning window light" },
  { title: "จัดโต๊ะทำงานให้โล่ง", hashtags: ["#จัดโต๊ะ", "#deskSetup"], line: "โต๊ะโล่ง ใจก็โล่ง",
    scene: "hands tidy a cluttered desk into a calm minimal setup, sliding a notebook into place and setting a small plant beside a lamp" },
  { title: "ฝนตกนอกหน้าต่าง", hashtags: ["#ฝนตก", "#ผ่อนคลาย"], line: "ฟังเสียงฝนสักแปดวินาที",
    scene: "rain streams down a window beside a cozy reading corner with a warm lamp, a mug and an open book; gentle rain sound" },
  { title: "หั่นผลไม้สดชื่น", hashtags: ["#ผลไม้", "#asmr"], line: "เสียงหั่นผลไม้ฟังแล้วสดชื่น",
    scene: "hands slice a ripe mango on a wooden board in bright kitchen daylight, juicy close detail, crisp knife sounds" },
  { title: "พับผ้าให้เรียบ", hashtags: ["#พับผ้า", "#satisfying"], line: "พับผ้าแบบนี้ ตู้เป็นระเบียบทันที",
    scene: "hands fold a soft white T-shirt into a neat square on a linen bed, then stack it on two others" },
  { title: "ปลูกต้นไม้เล็ก ๆ", hashtags: ["#ปลูกต้นไม้", "#plantlover"], line: "ต้นไม้เล็ก ๆ ทำให้ห้องสดชื่นขึ้น",
    scene: "hands press soil around a small succulent in a terracotta pot on a sunny windowsill, then brush the rim clean" },
  { title: "ชาเย็นแก้วโปรด", hashtags: ["#ชาไทย", "#เครื่องดื่ม"], line: "ชาเย็นแก้วนี้ ให้กี่คะแนน",
    scene: "orange Thai iced tea is poured over ice in a tall glass, milk swirls down slowly; condensation on the glass, cafe ambience" },
  { title: "ยามเย็นริมระเบียง", hashtags: ["#พระอาทิตย์ตก", "#chill"], line: "พักสายตากับแสงเย็นสักนิด",
    scene: "golden sunset light over a city balcony with a potted plant and a cup on the ledge, curtain moving in the breeze" },
  { title: "ขนมปังอบใหม่", hashtags: ["#ขนมปัง", "#homebaking"], line: "ขนมปังอบใหม่ หอมจนต้องหยุดดู",
    scene: "hands tear open a freshly baked bread roll on a wooden board, soft steam and crumb detail in warm kitchen light" },
  { title: "แมวงีบบนโซฟา", hashtags: ["#แมว", "#catlover"], line: "ใครชอบแมวขี้เซาบ้าง",
    scene: "a fluffy cat naps in a patch of sunlight on a soft sofa, ear twitching, slow breathing, calm room ambience" },
  // Formats native to Thai TikTok now: POV, restock/reset, "what I eat", ASMR, and questions that invite comments.
  { title: "POV: เช้าวันหยุด", hashtags: ["#POV", "#วันหยุด"], line: "POV เช้าวันหยุดที่ไม่ต้องรีบ",
    scene: "first-person view: hands pull back a sheer curtain to soft morning light, then lift a warm mug from the windowsill; slow, quiet weekend mood" },
  { title: "เติมของเข้าตู้เย็น", hashtags: ["#restock", "#จัดตู้เย็น"], line: "เติมตู้เย็นแบบนี้ ดูแล้วเพลิน",
    scene: "hands line up clear glass jars of colourful fruit and drinks neatly into a bright, clean fridge shelf, satisfying restock rhythm" },
  { title: "ข้าวกล่องไปทำงาน", hashtags: ["#ข้าวกล่อง", "#mealprep"], line: "ข้าวกล่องพรุ่งนี้ ให้กี่คะแนน",
    scene: "hands arrange rice, a fried egg and fresh vegetables neatly into a lunch box on a sunny kitchen counter, then close the lid" },
  { title: "เทน้ำแข็งเสียงใส", hashtags: ["#asmr", "#satisfying"], line: "ใครชอบเสียงน้ำแข็งแบบนี้บ้าง",
    scene: "clear ice cubes tumble into a tall glass in slow close-up, then sparkling soda is poured; crisp ice and fizz sounds" },
  { title: "จัดกระเป๋าไปเที่ยว", hashtags: ["#จัดกระเป๋า", "#เที่ยวไทย"], line: "จัดกระเป๋าไปเที่ยว ขาดอะไรไปไหม",
    scene: "hands neatly pack a small travel bag on a bed: folded shirt, sunglasses, a hat and a water bottle, top-down view" },
  { title: "เขียนแพลนเนอร์ยามเย็น", hashtags: ["#planner", "#productivity"], line: "พรุ่งนี้จะเป็นวันที่ดี",
    scene: "hands write a short to-do list in a paper planner under a warm desk lamp, then close it beside a cup of tea; calm evening" },
  { title: "ทำความสะอาดโต๊ะให้เงา", hashtags: ["#cleaning", "#cleantok"], line: "เช็ดทีเดียว ใจโล่งไปด้วย",
    scene: "a hand wipes a dusty glossy table in one smooth stroke, revealing a clean shine; satisfying before-and-after in one take" },
] as const;
/** Season-aware warm-up concepts, used first while their moment lasts. */
const MOMENT_CONCEPTS: Record<string, { title: string; hashtags: string[]; line: string; scene: string }> = {
  COOL_SEASON: { title: "ลมหนาวยามเช้า", hashtags: ["#หน้าหนาว", "#ลมหนาว"], line: "ลมหนาวมาแล้ว ใครชอบอากาศแบบนี้บ้าง",
    scene: "cool misty morning on a balcony: hands wrap around a steaming cup of hot cocoa, a knit blanket over the lap, soft pale sunlight" },
  RAINY_SEASON: { title: "ฝนพรำกับชาร้อน", hashtags: ["#หน้าฝน", "#ฝนตก"], line: "ฝนตกแบบนี้ ขอชาร้อนสักแก้ว",
    scene: "rain falls outside a window as hands pour hot tea into a cup on the sill; soft rain sound, warm lamp light inside" },
  NEW_YEAR: { title: "เตรียมของขวัญปีใหม่", hashtags: ["#ปีใหม่", "#ของขวัญ"], line: "ปีใหม่นี้ อยากให้อะไรใคร",
    scene: "hands wrap a small gift box with kraft paper and a red ribbon on a table with warm fairy lights glowing out of focus" },
  SONGKRAN: { title: "สงกรานต์คลายร้อน", hashtags: ["#สงกรานต์", "#คลายร้อน"], line: "สงกรานต์นี้ไปเล่นน้ำที่ไหนกัน",
    scene: "bright summer sun: water splashes gently over a bowl of jasmine and floating flowers, sparkling droplets in slow motion" },
};


export function growthPrompt(scene: string, line: string) {
  return [
    "Photoreal vertical 9:16 video, 8 seconds, one continuous take, looks filmed on a phone by a real person.",
    `SCENE: ${scene}.`,
    "TIMING: movement starts within the first half second; the most satisfying moment lands by second 3 and holds until second 8.",
    "CAMERA: slow, smooth push-in with very slight natural handheld drift; shallow depth of field.",
    `AUDIO: a warm, natural Thai voice says only: "${line}" — nothing else; natural ambient sound, no music.`,
    "AVOID: on-screen text, captions, subtitles, logos, brand names, watermarks, faces, celebrities, cuts or scene changes.",
  ].join("\n");
}

/** Plans `count` clips. A selling account with found products gets product ads (rotating products, sets and hand
 * actions); otherwise, or with no cleared product photo, it gets warm-up clips. `offset` rotates concepts by day. */
export function planBatch(input: { mode: FlowClipKind; count: number; products: FarmProduct[]; offset?: number; now?: Date }): PlannedClip[] {
  const clips: PlannedClip[] = [], now = input.now ?? new Date(), moment = shoppingMoment(now);
  const seasonal = moment ? MOMENT_CONCEPTS[moment.key] : undefined;
  // No rain clips in the cool, dry season.
  const library = moment?.key === "COOL_SEASON" ? GROWTH_CONCEPTS.filter(c => !(c.hashtags as readonly string[]).includes("#ฝนตก")) : GROWTH_CONCEPTS;
  const affiliate = input.mode === "AFFILIATE" && input.products.length > 0;
  const used = new Map<string, { styleIds: string[]; actions: HandAction[] }>();
  for (let index = 0; index < input.count; index++) {
    if (!affiliate) {
      // The season's concept leads the day's batch; the rest rotate through the library.
      const concept = seasonal && index === 0 ? seasonal : library[(index + (input.offset ?? 0)) % library.length];
      clips.push({ kind: "GROWTH", productId: null, title: concept.title, prompt: growthPrompt(concept.scene, concept.line),
        caption: `${concept.line}\nคอมเมนต์บอกหน่อย แล้วกดติดตามไว้ มีคลิปแบบนี้ทุกวัน`, hashtags: [...concept.hashtags, "#fyp", "#ฟีดดดシ"], referenceImagePath: null });
      continue;
    }
    const product = input.products[(index + (input.offset ?? 0)) % input.products.length];
    const history = used.get(product.id) ?? { styleIds: [], actions: [] };
    // Each clip of a product takes the next trend format of its category, so a batch is not five copies of one ad.
    const formats = trendFormatsFor(categoryPlaybook(product.categoryKey, product.title)), round = history.styleIds.length;
    const format = formats[(round + (input.offset ?? 0)) % formats.length], variant = round + (input.offset ?? 0);
    const plan = planFlowNative({ product: { id: product.id, title: product.title, categoryKey: product.categoryKey },
      facts: product.facts, assets: [{ id: product.imageAssetId, kind: "REAL_IMAGE", rightsCleared: true }], history },
      { trend: { format, variant, setTouch: moment?.setTouch || undefined } });
    const shot = plan.selected[0];
    history.styleIds.push(shot.style.id); history.actions.push(shot.action); used.set(product.id, history);
    const { caption, hashtags } = trendCaption(product, format, variant, now);
    clips.push({ kind: "AFFILIATE", productId: product.id, title: `${product.title} · ${format.nameTh} · ${shot.style.nameTh}`, prompt: shot.prompt,
      caption, hashtags, referenceImagePath: product.imagePath });
  }
  return clips;
}
