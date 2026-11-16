/**
 * "สาวไทย AI" channel (16 Nov, owner): the old faceless clips brought almost no follows, so the channel is rebuilt
 * around ONE recurring AI Thai girl. Flow makes one candidate face at a time (a short selfie take; its last frame
 * becomes the picture, 10 credits each), the owner makes more until one is right and picks it, and every clip after
 * that attaches that picture as Flow's ingredient image so it is always the same girl. Clips come as short story
 * arcs (stories.ts) that continue across days. Pure: prompts, state shapes and the batch plan.
 */
import { GIRL_SERIES, episodeTitle, newArc, seriesFromTitle, type Arc, type Episode, type GirlSeries } from "./stories";

export { GIRL_SERIES, type GirlSeries } from "./stories";
/** Flow refuses fast and refunds the credits, so a face gets a few reworded tries before giving up. */
export const MAX_FACE_ATTEMPTS = 4;
/** Faces kept on the page to choose from (newest first); older pictures stay in storage. */
export const MAX_FACES_SHOWN = 8;

/** DELETED: removed by the owner; kept in the list only so its number (and Flow clip ids) are never used again. */
export type CandidateStatus = "QUEUED" | "DONE" | "FAILED" | "DELETED";
export interface FaceCandidate {
  key: string; clipId: string | null; attempts: number; status: CandidateStatus; stillPath: string | null; error: string | null;
}
export type CharacterStatus = "FACES" | "PICK" | "READY";
export interface GirlCharacter {
  id: string; name: string; look: string; status: CharacterStatus; candidates: FaceCandidate[];
  facePath: string | null; createdAt: string; updatedAt: string;
}
/** The story being told: episodes left to make continue in the next batch, even on the next day. */
/** `v`: story version. Stories saved before the 16 Nov sexier rewrite (no v) are dropped instead of continued. */
export interface ArcProgress { series: GirlSeries; name: string; episodes: Episode[]; next: number; v?: number }
export const ARC_VERSION = 2;
export interface GirlState {
  version: 1; character: GirlCharacter | null;
  /** When the owner cleared the old clips and stats: the learning loop only reads clips made after this. */
  resetAt: string | null;
  arc?: ArcProgress | null;
  /** Titles already made (newest last, capped) so no episode is ever repeated. */
  made?: string[];
}
export const MAX_MADE_KEPT = 400;
export const emptyGirlState = (): GirlState => ({ version: 1, character: null, resetAt: null, arc: null, made: [] });

export const characterStatusLabels: Record<CharacterStatus, string> = {
  FACES: "กำลังสร้างหน้า", PICK: "เลือกหน้าที่ชอบ", READY: "พร้อมทำคลิป",
};
/** READY once a face is picked; otherwise still making one, or waiting for the owner to pick. */
export function characterStatus(candidates: FaceCandidate[], facePath: string | null): CharacterStatus {
  if (facePath) return "READY";
  return candidates.some(c => c.status === "QUEUED") ? "FACES" : "PICK";
}

// ---------------------------------------------------------------- Names

const NICK = ["Mild", "Mint", "Ploy", "Fern", "Bow", "Nam", "Praew", "Pang", "Kaew", "Mook", "Aom", "Fah", "Bam", "Nene", "Jane", "Gift", "Prim", "Mewnie",
  "Pear", "Bell", "Cream", "Kwan", "Plai", "Toey", "Bua", "Pim", "Noey", "Fon", "Ice", "May"] as const;
const SWEET = ["Milk", "Mochi", "Peach", "Honey", "Latte", "Berry", "Cocoa", "Candy", "Bubble", "Sugar", "Kiwi", "Matcha", "Toffee", "Cookie", "Yuzu",
  "Pudding", "Mango", "Cherry", "Melon", "Muffin", "Boba", "Caramel", "Daisy", "Sunny"] as const;
/** A nickname like "MildMilk": a Thai nickname plus a sweet word, alliterating when possible. */
export function randomNickname(random: () => number = Math.random) {
  const nick = NICK[Math.floor(random() * NICK.length) % NICK.length];
  const same = SWEET.filter(w => w[0] === nick[0]);
  const pool = same.length && random() < 0.7 ? same : SWEET;
  return nick + pool[Math.floor(random() * pool.length) % pool.length];
}

// ---------------------------------------------------------------- Faces

/**
 * Different looks, so each new face is a real alternative and not the same girl with another haircut (16 Nov, owner:
 * "หน้าเหมือนกันเลยแค่เปลี่ยนทรงผม", with pictures of the wanted style: glossy Thai/Asian beauty-creator portraits in real
 * places, not a stock-photo studio smile). Each look carries its own face shape, makeup, outfit and place. Outfits stay
 * covered (no cleavage). The owner's own words replace the look when given.
 */
const LOOKS = [
  "small V-line face, large double-lidded doe eyes, slim high nose, porcelain glass skin, coral gradient lips; long silky jet-black hair; a white smocked puff-sleeve top; on a soft grey sofa by dark curtains, moody warm evening light",
  "doll-like round face, big sparkly eyes with aegyo-sal, tiny nose, rosy blush, see-through bangs and long wavy black hair with two navy satin ribbons; a black high-neck qipao-style dress with a blue dragon print; in a modern apartment with warm ceiling lights",
  "oval face, sultry almond eyes, full lips with a red tint, light freckles, long layered chestnut-brown hair; small gold hoops and a thin gold necklace; a cream lace blouse with a modest neckline; in a sunny tropical garden, film-photo look",
  "heart-shaped face, bright eye-smile, dimples, fair skin, long straight brown hair with a centre part; a crisp lilac blouse and black pencil skirt; on a green park bench, soft daylight",
  "delicate fox-eye shape with winged liner, sharp jawline, pale skin, nude-pink lips, shoulder-length ash-brown waves; pearl earrings, oversized cream knit cardigan; in a cosy cafe by the window, golden-hour light",
  "striking mixed Thai-Korean features, sleek high black ponytail, glossy cherry lips, light tan glowing skin; a fitted black ribbed long-sleeve top; on a city rooftop at sunset, warm rim light",
  "soft innocent baby face, wide round eyes, peachy blush, honey-brown hair with curtain bangs; a pastel blue puff-sleeve dress; in a flower shop full of pink roses, bright soft light",
  "cool chic face with sharp cheekbones, monolid eyes with smoky liner, red lips, blunt black bob with bangs; a white collared shirt under a beige vest; in a minimalist white room, clean daylight",
] as const;
const DEFAULT_PLACE = "in a cosy, stylish room with soft warm light";

/** Only what the owner typed: no quotes or instructions. */
export function cleanLook(look: string) {
  return look.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * A portrait photo made in Flow's image mode (16 Nov, owner: the video takes' last frames all gave the same stock face;
 * "make the model as a picture, then make videos from the picture"). No sound, so Flow's audio step cannot fail it.
 * `attempt` = tries already made; a retry changes the camera wording a little.
 */
export function facePrompt(look: string, index: number, attempt = 0) {
  const own = cleanLook(look);
  const who = own ? `${own}; ${DEFAULT_PLACE}` : LOOKS[index % LOOKS.length];
  const camera = ["shot on a full-frame camera with an 85mm lens", "shot on an iPhone in portrait mode", "editorial photo, 50mm lens"][attempt % 3];
  return `Photorealistic vertical 9:16 portrait photo of a stunning young Asian woman in her twenties, a top Thai Instagram and TikTok beauty creator: ${who}. `
    + `Waist-up, she looks straight into the camera with a soft confident expression, her whole face clearly visible and in sharp focus, ${camera}, `
    + "flattering soft light, natural skin texture with a light glow, shallow depth of field, high-end beauty photography. One person only, no text, no watermark.";
}

/** What the owner reads when Flow gave up on a face. */
export function faceFailureLabel(reason: string) {
  if (/FLOW_REPORTED_FAILURE/.test(reason)) return "Flow สร้างไม่ผ่าน (ไม่เสียเครดิต) ลองกดสร้างใหม่ หรือเปลี่ยนคำบรรยายหน้าให้สั้นลง";
  if (/NO_CREDIT/.test(reason)) return "เครดิต Flow หมด รอเครดิตวันใหม่";
  return reason;
}

export function newCandidate(index: number): FaceCandidate {
  return { key: `face-${index + 1}`, clipId: null, attempts: 0, status: "QUEUED", stillPath: null, error: null };
}

type ClipView = { status: string; error: string | null; storage_path: string | null; updated_at?: string | null };
/** A failure that is Flow's verdict on the take itself; anything else (an account problem) the worker may still hand to another account. */
const flowVerdict = (error: string | null) => /FLOW_REPORTED_FAILURE|FLOW_UNUSUAL_ACTIVITY|POLICY/i.test(error ?? "");
/** How long a face waits on an account-side failure before making a new take (16 Nov: a take marked GENERATE_BUTTON_DISABLED was finished by the
 * second Google account two minutes later, after a new take had already been queued: 10 credits spent twice). */
export const ACCOUNT_RETRY_WAIT_MS = 10 * 60_000;
export type FaceStep =
  | { kind: "QUEUE"; index: number }
  | { kind: "KEEP"; index: number; storagePath: string }
  | { kind: "GIVE_UP"; index: number; reason: string };

/** What to do with each face candidate given its Flow clip. Pure. */
export function decideFaces(candidates: FaceCandidate[], clips: Map<string, ClipView>, now = Date.now()): FaceStep[] {
  const steps: FaceStep[] = [];
  candidates.forEach((c, index) => {
    if (c.status !== "QUEUED") return;
    if (!c.clipId) { steps.push({ kind: "QUEUE", index }); return; }
    const clip = clips.get(c.clipId);
    // DISCARDED: another tick running at the same moment already kept this take as a picture.
    if (clip && ["QUEUED", "GENERATING", "DISCARDED"].includes(clip.status)) return;
    if (clip && ["READY", "SCHEDULED"].includes(clip.status) && clip.storage_path) { steps.push({ kind: "KEEP", index, storagePath: clip.storage_path }); return; }
    if (clip?.status === "SKIPPED_NO_CREDIT") return;
    if (clip?.status === "FAILED" && !flowVerdict(clip.error) && now - Date.parse(clip.updated_at ?? "") < ACCOUNT_RETRY_WAIT_MS) return; // every Google account is out of credits: waits for tomorrow's credits
    if (c.attempts >= MAX_FACE_ATTEMPTS) { steps.push({ kind: "GIVE_UP", index, reason: faceFailureLabel(clip?.error ?? clip?.status ?? "ไม่พบคลิป") }); return; }
    steps.push({ kind: "QUEUE", index });
  });
  return steps;
}

// ---------------------------------------------------------------- Clips

/** The series a girl clip's title belongs to, for the learning loop. */
export const girlSeriesOfTitle = (title: string): GirlSeries | null => seriesFromTitle(title);

/** Shared limits: an adult, nothing TikTok keeps off For You and nothing Flow refuses to make. */
const LIMITS = "she is an adult; no nudity, no lingerie, no see-through clothing, nothing explicit; swimwear only at a beach or pool; no close-ups of body parts";
const STYLES = {
  // 16 Nov owner: every clip adds sex appeal, even the everyday ones.
  CUTE: `STYLE: pretty, sexy and stylish like a top Thai TikTok creator, fitted fashionable outfit, playful flirty eye contact; ${LIMITS}`,
  // 16 Nov owner: "more exciting, teasing, medium sexy up to the limit, to pull follows".
  FLIRTY: `STYLE: sexy, playful and flirty in a fitted fashionable outfit, she teases the viewer with eye contact, a cheeky smile and little winks; ${LIMITS}`,
  GLAM: `STYLE: confident, glamorous and alluring like a fashion model in a music video, fitted fashionable outfit, slow seductive eye contact with the lens; ${LIMITS}`,
} as const;

/**
 * 16 Nov owner: "film her from many angles like a real person, so it is never boring". Each clip gets one way of
 * filming, the way real creators shoot on a phone; every one keeps her face clear.
 */
export const CAMERAS = [
  "handheld selfie at arm's length, the phone moving a little with her, then she turns it to show more of the room",
  "phone propped on a shelf at a low angle looking slightly up at her, she steps toward it",
  "a friend films her handheld from the side, then circles slowly around to the front",
  "top-down shot from above while she lies back, then the camera tilts down to her face",
  "mirror selfie: we see her and the phone in a full-length mirror, then a cut to a close handheld shot",
  "starts as a close-up of her eyes and smile, then the camera pulls back smoothly to show the outfit",
  "over-the-shoulder shot as she glances back at the lens, then a cut to a front close-up",
  "slow push-in from waist-up to a close-up of her face, gentle natural handheld shake",
  "two quick cuts like a real TikTok edit: a medium side angle, then a close front angle on the beat",
  "low tripod shot from the floor level, then a cut to eye level as she leans toward the lens",
] as const;

export function girlPrompt(episode: Episode, options: { strict?: boolean; camera?: string } = {}) {
  return [
    "Vertical 9:16 TikTok video, a full 8 seconds, photoreal like a real smartphone video.",
    "The young Thai woman in the reference image is the only person in the video: keep her exact face, eyes, nose, lips, skin tone and hair colour from the picture in every frame.",
    // The first second decides whether a viewer stays: she meets the lens straight away.
    `0–3 s: ${episode.start}; from the very first frame she looks straight into the lens.`,
    `3–4 s: ${episode.turn}.`,
    `4–8 s: ${episode.end}. Keep moving naturally until the last frame.`,
    // 16 Nov: after the cut of a before/after the camera jumped to a far full-body shot and her face was tiny and still.
    `CAMERA: ${options.camera ?? CAMERAS[0]}; her face stays large and clearly visible, never a far wide shot; she keeps moving and posing.`,
    `${STYLES[episode.vibe ?? "CUTE"]}; flattering light, rich colour, crisp focus on her face; smooth natural motion; hands with five fingers; respectful at temples and sacred places.`,
    ...(options.strict ? ["EXTRA CARE: keep movements simple and slow, her face clearly visible and unchanged throughout."] : []),
    `AUDIO: ${episode.music ? "an upbeat, catchy instrumental pop beat that her moves follow, and " : "natural ambient sound, and "}she says only "${episode.line}" in Thai.`,
    "AVOID: on-screen text, captions, words or graphic prints on clothing, logos, brand names, watermarks, other people's faces, her face changing, extra limbs, distorted hands.",
  ].join("\n");
}

const CTAS = [
  "กดติดตามไว้ เจอกันทุกวันนะคะ",
  "ตอนต่อไปแซ่บกว่านี้ กดติดตามรอเลย",
  "ถ้าชอบน้อง กดหัวใจกับกดติดตามให้หน่อยนะ",
  "คอมเมนต์บอกหน่อย อยากเห็นน้องแบบไหนต่อ",
  "อยากให้ไปไหนหรือใส่ชุดไหนต่อ คอมเมนต์มาเลย กดติดตามไว้ด้วยนะ",
  "ตอนต่อไปมาเร็วๆ นี้ ติดตามไว้ไม่พลาด",
  "ให้คะแนนเต็ม 10 กี่คะแนน ติดตามไว้นะคะ",
] as const;

export interface GirlGuide { seriesWeights?: Record<string, number>; strictSeries?: readonly string[] }
export interface PlannedGirlClip { title: string; prompt: string; caption: string; hashtags: string[]; series: GirlSeries }

/**
 * The next `count` clips. 16 Nov owner: no more episodes ("episode 1 and 3 came out the same on one day"): every clip
 * is a stand-alone idea from a different series than the last few clips, picked at random from a fresh story draw, so
 * the channel keeps showing new content. No title in `made` is used again. `arc` is always null now (kept in the state
 * shape for older saves).
 */
export function planGirlClips(count: number, name: string, input: { guide?: GirlGuide; arc?: ArcProgress | null; made?: readonly string[] } = {},
  random: () => number = Math.random): { clips: PlannedGirlClip[]; arc: ArcProgress | null; made: string[] } {
  const made = [...(input.made ?? [])], seen = new Set(made), clips: PlannedGirlClip[] = [];
  const who = name.trim() || "น้อง";
  while (clips.length < count) {
    // 16 Nov owner ("5 clips, 3 were before/after"): every series is used once before any comes back, so even a big
    // stock made in one day never repeats a kind of clip until all of them were shown.
    const recent = made.slice(-(GIRL_SERIES.length - 1)).map(seriesFromTitle).filter((s): s is GirlSeries => Boolean(s));
    const arc: Arc = newArc(random, { made: seen, avoid: recent, weights: input.guide?.seriesWeights });
    const fresh = arc.episodes.filter(e => !seen.has(episodeTitle(arc.series, e)));
    const pool = fresh.length ? fresh : arc.episodes;
    const episode = pool[Math.floor(random() * pool.length) % pool.length];
    const title = episodeTitle(arc.series, episode);
    clips.push({
      series: arc.series, title, prompt: girlPrompt(episode, { strict: input.guide?.strictSeries?.includes(arc.series), camera: CAMERAS[Math.floor(random() * CAMERAS.length) % CAMERAS.length] }),
      caption: `${who} · ${episode.label}\n${episode.line} ${CTAS[Math.floor(random() * CTAS.length) % CTAS.length]}`,
      hashtags: [...episode.hashtags, "#สาวไทย", "#AIgirl", "#AI", "#fyp"],
    });
    made.push(title); seen.add(title);
  }
  return { clips, arc: null, made: made.slice(-MAX_MADE_KEPT) };
}
