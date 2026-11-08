/**
 * Viral engine (Lucky, 8 Nov): "the program is called Viral, but the promo clips come out chill". Every promo clip the
 * system writes on its own (warm-up clips and product ads) now goes through this layer, which turns a calm scene into a
 * retention-built, follow-earning short:
 *
 *   1. A retention angle per clip (wait-for-it, guess-it, no-way, watch-twice, debate, rate-it, tag-a-friend), rotated
 *      so a batch never repeats one trick. Each angle has a spoken hook, a caption hook and a direction for Flow.
 *   2. A VIRAL block in the prompt: pattern interrupt in frame one, escalation every two seconds, a peak at 5–7 s,
 *      speed-ramped camera, punchy sound, and an ending on motion so the loop restarts (rewatch time).
 *   3. An energetic creator voice instead of a "warm, natural" one, and captions built for comments and shares.
 *
 * Platform rules stay first: no dangerous acts anyone could copy, no violence, gore or shock, no fake news, nothing
 * presented as real footage, and product ads never claim more than the product's recorded facts. Engagement prompts
 * ask a real question (guess, rate, pick a side); they never promise anything for a like or a follow.
 */
export const VIRAL_ENGINE_VERSION = "viral-engine-v1";

export type ViralAngleId = "WAIT_FOR_IT" | "GUESS_IT" | "NO_WAY" | "WATCH_TWICE" | "PICK_A_SIDE" | "RATE_IT" | "TAG_A_FRIEND";
export interface ViralAngle {
  id: ViralAngleId;
  /** Said in the first second, before the concept's line. Short: it shares an 8-second take. */
  spokenHook: string;
  /** First caption line (the part people read before "more"). */
  captionHook: string;
  /** The comment / share line at the end of the caption: a real question, never a reward for engagement. */
  engage: string;
  /** What Flow should do with the take to land this angle. */
  direction: string;
}

export const VIRAL_ANGLES: readonly ViralAngle[] = [
  { id: "WAIT_FOR_IT", spokenHook: "รอดูวินาทีที่ห้า", captionHook: "รอดูวินาทีที่ 5 😳 ไม่มีใครเดาถูก", engage: "ใครเดาถูกบ้าง คอมเมนต์มา 👇",
    direction: "Make the viewer feel something is about to happen from second one (it visibly builds: speed, size or sound rising), then the twist at 4–5 s is bigger, faster or stranger than expected, landing on a sharp sound hit." },
  { id: "GUESS_IT", spokenHook: "ทายสิ จะเกิดอะไรขึ้น", captionHook: "ทายก่อนดูจบ จะเกิดอะไรขึ้น 👀", engage: "ทายไว้ในคอมเมนต์ก่อนดูเฉลย 👇",
    direction: "Open on a set-up that clearly asks a question (what is inside, what will it do, who wins); hold the answer back until the twist, then reveal it in one clear, satisfying beat." },
  { id: "NO_WAY", spokenHook: "เดี๋ยวนะ ได้ไงเนี่ย", captionHook: "ดูกี่รอบก็ยังงง 🤯", engage: "ใครดูซ้ำเกิน 3 รอบยกมือ 🙋",
    direction: "The twist is a physically impossible but clean, believable moment (scale, material or behaviour that cannot be real), shown in close-up with a speed-ramp into slow motion so the eye can catch it." },
  { id: "WATCH_TWICE", spokenHook: "ดูดี ๆ นะ", captionHook: "รอบแรกไม่ทันเห็น ดูอีกรอบ 👀", engage: "เห็นอะไรในรอบสอง บอกหน่อย 👇",
    direction: "Hide one small, delightful detail in the frame that pays off at the end (a tiny reaction, a hidden character, a matching object), so viewers rewatch to catch it; the last frame cuts on motion right back into the first." },
  { id: "PICK_A_SIDE", spokenHook: "ทีมไหน เลือกเลย", captionHook: "ทีมไหน? เลือกมา ⚔️", engage: "ทีมไหน คอมเมนต์มาเลย 👇",
    direction: "Stage a friendly contest or a choice between two clear sides (two characters, two textures, two moves) so the twist decides it in a funny or surprising way; keep it playful, never mean." },
  { id: "RATE_IT", spokenHook: "ให้กี่คะแนน", captionHook: "ให้เต็ม 10 กี่คะแนน? 🔥", engage: "ให้คะแนนในคอมเมนต์ 👇",
    direction: "Build to one spectacular hero moment at 5–6 s (the most satisfying, delicious or impressive frame of the clip), held a beat in slow motion with a big sound accent." },
  { id: "TAG_A_FRIEND", spokenHook: "ส่งให้เพื่อนดูด่วน", captionHook: "ส่งให้เพื่อนที่ต้องดูอันนี้ 😂", engage: "แท็กเพื่อนที่เป็นแบบนี้ 👇",
    direction: "Make it relatable and funny: the subject reacts like a person would in an everyday situation (caught, proud, sulky, shocked), with a clear expression beat right after the twist that people want to send to a friend." },
];

/** The angle for clip `index` of a batch: rotated so neighbouring clips use different tricks, seeded by day/account. */
export function viralAngle(index: number, seed = 0): ViralAngle {
  return VIRAL_ANGLES[((index + seed) % VIRAL_ANGLES.length + VIRAL_ANGLES.length) % VIRAL_ANGLES.length];
}

/** Shared by every viral prompt: what makes a short worth following, and the rules it never breaks. */
export const VIRAL_DIRECTION = [
  "VIRAL DIRECTION (this channel grows by follows: calm, slow, ambient clips fail): high energy from the very first frame, which is already the most surprising or intriguing image of the opening (a pattern interrupt, never a slow establishing shot).",
  "ESCALATION: every two seconds the action gets bigger, faster, closer or louder, rising to one peak at 5–7 s; there is no idle or calm moment anywhere in the 8 seconds.",
  "ENDING: finish on motion at or just after the peak, not on a resting pose, so the loop restarts instantly and people watch it again.",
  "CAMERA ENERGY: snap push-ins, low dramatic angles and macro close-ups, with a speed-ramp (real time, then slow motion on the peak, then real time); high contrast, saturated colour, punchy light with a strong key and rim light.",
].join("\n");
export const VIRAL_SAFETY = "PLATFORM SAFE: a clearly AI-made fantasy scene, not presented as real news or real footage; no dangerous stunts or acts someone could copy and get hurt, no fire or weapons used on people or animals, no violence, gore, injury or shock imagery, no animal in distress, nothing sexual, no money, gambling or lottery.";

/** The energetic voice line: the angle's hook, then the concept's own line, short enough for one take. */
export function viralVoice(angle: ViralAngle, line: string, max = 70) {
  const text = `${angle.spokenHook} ${line}`.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max), space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}
export const VIRAL_VOICE_STYLE = "an excited, punchy young Thai TikTok creator voice (fast, confident, smiling, big energy on the first words)";

/** Product-ad angles: the hook may tease, but never claims a result, a ranking, a price or a review. */
export interface ProductAngle { id: string; captionHook: string; engage: string; direction: string }
export const PRODUCT_ANGLES: readonly ProductAngle[] = [
  { id: "STOP", captionHook: "หยุดเลื่อนแป๊บ ชิ้นนี้ต้องดู 👀", engage: "ใครอยากได้บ้าง คอมเมนต์มา 👇",
    direction: "Frame one is a bold, close, high-contrast shot of the product already in motion (a fast slide-in or a hand snapping it into frame) with a punchy whoosh." },
  { id: "REVEAL", captionHook: "ดูจนจบ ตอนท้ายมีเฉลย 😳", engage: "เดาถูกไหม คอมเมนต์มา 👇",
    direction: "Start on a mystery close-up the viewer cannot place, then a fast, satisfying reveal of the whole product on a sound hit at about second 3." },
  { id: "FRIEND", captionHook: "ส่งให้เพื่อนที่ต้องมีอันนี้ 😂", engage: "แท็กเพื่อนที่ควรมี 👇",
    direction: "Play it like a friend excitedly showing their new find: quick, lively hand movement and a proud final hold on the product facing the camera." },
  { id: "RATE", captionHook: "ให้กี่คะแนน ชิ้นนี้? 🔥", engage: "ให้คะแนนเต็ม 10 ในคอมเมนต์ 👇",
    direction: "Build to one hero moment at 5–6 s where light sweeps across the product in slow motion with a big sound accent, then snap back to real time." },
];
export function productAngle(index: number, seed = 0): ProductAngle {
  return PRODUCT_ANGLES[((index + seed) % PRODUCT_ANGLES.length + PRODUCT_ANGLES.length) % PRODUCT_ANGLES.length];
}
export const PRODUCT_VIRAL_DIRECTION = [
  "VIRAL AD DIRECTION (a fast, high-energy TikTok ad, not a calm catalogue shot): the first frame already has motion and contrast; the energy rises to one hero moment at 5–6 s; finish on motion so the loop restarts.",
  "CAMERA ENERGY: snap push-ins and a speed-ramp into slow motion on the hero moment; bold, saturated light with a strong key and rim light on the product.",
  "HONEST: the product only does what its reference image and listed facts show; no before/after, no results, no rankings, no prices, no discounts, no reviews or testimonials.",
].join("\n");
