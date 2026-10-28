import { planFlowNative, type HandAction } from "@/features/creative/flow-native";
import type { DirectorFact } from "@/features/creative/ad-director";
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
] as const;

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
export function planBatch(input: { mode: FlowClipKind; count: number; products: FarmProduct[]; offset?: number }): PlannedClip[] {
  const clips: PlannedClip[] = [];
  const affiliate = input.mode === "AFFILIATE" && input.products.length > 0;
  const used = new Map<string, { styleIds: string[]; actions: HandAction[] }>();
  for (let index = 0; index < input.count; index++) {
    if (!affiliate) {
      const concept = GROWTH_CONCEPTS[(index + (input.offset ?? 0)) % GROWTH_CONCEPTS.length];
      clips.push({ kind: "GROWTH", productId: null, title: concept.title, prompt: growthPrompt(concept.scene, concept.line),
        caption: `${concept.line} กดติดตามไว้ มีคลิปแบบนี้ทุกวัน`, hashtags: [...concept.hashtags, "#fyp"], referenceImagePath: null });
      continue;
    }
    const product = input.products[(index + (input.offset ?? 0)) % input.products.length];
    const history = used.get(product.id) ?? { styleIds: [], actions: [] };
    const plan = planFlowNative({ product: { id: product.id, title: product.title, categoryKey: product.categoryKey },
      facts: product.facts, assets: [{ id: product.imageAssetId, kind: "REAL_IMAGE", rightsCleared: true }], history });
    const shot = plan.selected[0];
    history.styleIds.push(shot.style.id); history.actions.push(shot.action); used.set(product.id, history);
    const fact = product.facts[0]?.text;
    clips.push({ kind: "AFFILIATE", productId: product.id, title: `${product.title} · ${shot.style.nameTh}`, prompt: shot.prompt,
      caption: [product.title, fact, "ดูรายละเอียดที่ตะกร้าก่อนสั่ง"].filter(Boolean).join(" · "),
      hashtags: ["#tiktokshop", "#ของมันต้องมี", "#fyp"], referenceImagePath: product.imagePath });
  }
  return clips;
}
