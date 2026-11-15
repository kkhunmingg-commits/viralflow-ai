/**
 * "สาวไทย AI" channel (16 Nov, owner): the old faceless clips brought almost no follows, so the channel is rebuilt
 * around ONE recurring AI Thai girl. Flow makes one candidate face at a time (a short selfie take; its last frame
 * becomes the picture, 10 credits each), the owner makes more until one is right and picks it, and every clip after
 * that attaches that picture as Flow's ingredient image so it is always the same girl. Clips come as short story
 * arcs (stories.ts) that continue across days. Pure: prompts, state shapes and the batch plan.
 */
import { episodeTitle, newArc, seriesFromTitle, type Arc, type Episode, type GirlSeries } from "./stories";

export { GIRL_SERIES, type GirlSeries } from "./stories";
export const MAX_FACE_ATTEMPTS = 2;
/** Faces kept on the page to choose from (newest first); older pictures stay in storage. */
export const MAX_FACES_SHOWN = 8;

export type CandidateStatus = "QUEUED" | "DONE" | "FAILED";
export interface FaceCandidate {
  key: string; clipId: string | null; attempts: number; status: CandidateStatus; stillPath: string | null; error: string | null;
}
export type CharacterStatus = "FACES" | "PICK" | "READY";
export interface GirlCharacter {
  id: string; name: string; look: string; status: CharacterStatus; candidates: FaceCandidate[];
  facePath: string | null; createdAt: string; updatedAt: string;
}
/** The story being told: episodes left to make continue in the next batch, even on the next day. */
export interface ArcProgress { series: GirlSeries; name: string; episodes: Episode[]; next: number }
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

/** Different starting looks, so each new face is a real alternative. The owner's own words replace them when given. */
const LOOKS = [
  "long straight dark-brown hair with soft see-through bangs, fair glowing skin, soft K-beauty style makeup with rosy blush, big bright eyes, wearing a cream knit sweater",
  "long glossy black hair with gentle waves, warm honey Thai skin tone, glossy pink lips, sweet smile with dimples, wearing a pastel pink cardigan",
  "shoulder-length black bob with a side part, porcelain skin, subtle cat-eye liner, elegant and confident, wearing a white satin blouse",
  "long dark hair in a high ponytail, healthy sun-kissed skin, bright playful smile, sporty cute look, wearing a light-blue fitted t-shirt",
  "long chestnut-brown hair with soft curtain bangs, fair skin, delicate features, peachy makeup, wearing a white lace-collar blouse",
  "long black hair with a soft middle part, tan glowing Thai skin, bold brows and a confident smile, wearing a black square-neck top with a modest neckline",
] as const;
const ROOMS = [
  "a cozy bedroom with warm fairy lights and a soft beige wall",
  "a bright minimal room with sheer white curtains and morning sunlight",
  "a cute pastel room with plush toys on a shelf, soft evening light",
  "a modern apartment by a large window, golden-hour light",
] as const;

/** Only what the owner typed: no quotes or instructions. */
export function cleanLook(look: string) {
  return look.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** A short selfie take whose last frame is a clear, front-facing face (the presenter work showed short prompts pass Flow best). */
export function facePrompt(look: string, index: number, attempt = 0) {
  const who = cleanLook(look) || LOOKS[index % LOOKS.length];
  const room = ROOMS[(index + attempt) % ROOMS.length];
  const line = ["สวัสดีค่ะ ฝากติดตามด้วยนะคะ", "หวัดดีค่ะทุกคน", "เจอกันทุกวันนะคะ"][attempt % 3];
  return `Vertical 9:16 selfie-style phone video. A very beautiful young Thai woman, 23 years old: ${who}. ` +
    `She is in ${room}, holding the phone at eye level. She smiles, tilts her head and says in Thai: "${line}", ` +
    "then looks straight into the camera with a soft smile and stays still for the last second. Her whole face is fully visible and in sharp focus, flattering soft light, natural skin texture.";
}

export function newCandidate(index: number): FaceCandidate {
  return { key: `face-${index + 1}`, clipId: null, attempts: 0, status: "QUEUED", stillPath: null, error: null };
}

type ClipView = { status: string; error: string | null; storage_path: string | null };
export type FaceStep =
  | { kind: "QUEUE"; index: number }
  | { kind: "KEEP"; index: number; storagePath: string }
  | { kind: "GIVE_UP"; index: number; reason: string };

/** What to do with each face candidate given its Flow clip. Pure. */
export function decideFaces(candidates: FaceCandidate[], clips: Map<string, ClipView>): FaceStep[] {
  const steps: FaceStep[] = [];
  candidates.forEach((c, index) => {
    if (c.status !== "QUEUED") return;
    if (!c.clipId) { steps.push({ kind: "QUEUE", index }); return; }
    const clip = clips.get(c.clipId);
    if (clip && ["QUEUED", "GENERATING"].includes(clip.status)) return;
    if (clip && ["READY", "SCHEDULED"].includes(clip.status) && clip.storage_path) { steps.push({ kind: "KEEP", index, storagePath: clip.storage_path }); return; }
    if (clip?.status === "SKIPPED_NO_CREDIT") return; // every Google account is out of credits: waits for tomorrow's credits
    if (c.attempts >= MAX_FACE_ATTEMPTS) { steps.push({ kind: "GIVE_UP", index, reason: clip?.error ?? clip?.status ?? "ไม่พบคลิป" }); return; }
    steps.push({ kind: "QUEUE", index });
  });
  return steps;
}

// ---------------------------------------------------------------- Clips

/** The series a girl clip's title belongs to, for the learning loop. */
export const girlSeriesOfTitle = (title: string): GirlSeries | null => seriesFromTitle(title);

export function girlPrompt(episode: Episode, options: { strict?: boolean } = {}) {
  return [
    "Vertical 9:16 TikTok video, a full 8 seconds, photoreal like a real smartphone video.",
    "The young Thai woman in the reference image is the only person in the video: keep her exact face, eyes, nose, lips, skin tone and hair colour from the picture in every frame.",
    `0–3 s: ${episode.start}.`,
    `3–4 s: ${episode.turn}.`,
    `4–8 s: ${episode.end}. Keep moving naturally until the last frame.`,
    "STYLE: cute, stylish and tasteful; she is an adult; every outfit fully covers her (no cleavage, no lingerie, no swimwear, no see-through); flattering soft light, rich colour, crisp focus on her face; smooth natural motion; hands with five fingers; respectful at temples and sacred places.",
    ...(options.strict ? ["EXTRA CARE: keep movements simple and slow, her face clearly visible and unchanged throughout."] : []),
    `AUDIO: ${episode.music ? "an upbeat, catchy instrumental pop beat that her moves follow, and " : "natural ambient sound, and "}she says only "${episode.line}" in Thai.`,
    "AVOID: on-screen text, captions, logos, brand names, watermarks, other people's faces, her face changing, extra limbs, distorted hands.",
  ].join("\n");
}

const CTAS = [
  "กดติดตามไว้ เจอกันทุกวันนะคะ",
  "อยากให้ไปไหนหรือใส่ชุดไหนต่อ คอมเมนต์มาเลย กดติดตามไว้ด้วยนะ",
  "ตอนต่อไปมาเร็วๆ นี้ ติดตามไว้ไม่พลาด",
  "ให้คะแนนเต็ม 10 กี่คะแนน ติดตามไว้นะคะ",
] as const;

export interface GirlGuide { seriesWeights?: Record<string, number>; strictSeries?: readonly string[] }
export interface PlannedGirlClip { title: string; prompt: string; caption: string; hashtags: string[]; series: GirlSeries }

/**
 * The next `count` episodes. The current arc continues where it stopped (yesterday's "morning" is followed by today's
 * "lunch"); when it ends, a new arc starts in a different series, chosen by what the results liked. No episode title
 * in `made` is used again. Returns the clips and the state to save.
 */
export function planGirlClips(count: number, name: string, input: { guide?: GirlGuide; arc?: ArcProgress | null; made?: readonly string[] } = {},
  random: () => number = Math.random): { clips: PlannedGirlClip[]; arc: ArcProgress | null; made: string[] } {
  const made = [...(input.made ?? [])], seen = new Set(made), clips: PlannedGirlClip[] = [];
  let arc = input.arc && input.arc.next < input.arc.episodes.length ? input.arc : null;
  const who = name.trim() || "น้อง";
  while (clips.length < count) {
    if (!arc) {
      const fresh: Arc = newArc(random, { made: seen, lastSeries: clips.at(-1)?.series ?? input.arc?.series ?? null, weights: input.guide?.seriesWeights });
      arc = { series: fresh.series, name: fresh.name, episodes: fresh.episodes, next: 0 };
    }
    const episode = arc.episodes[arc.next], number = arc.next + 1, total = arc.episodes.length;
    const title = episodeTitle(arc.series, episode);
    clips.push({
      series: arc.series, title, prompt: girlPrompt(episode, { strict: input.guide?.strictSeries?.includes(arc.series) }),
      caption: `${who} · ${arc.name} ตอนที่ ${number}/${total}\n${episode.line} ${CTAS[Math.floor(random() * CTAS.length) % CTAS.length]}\n(ตัวละคร AI)`,
      hashtags: [...episode.hashtags, "#สาวไทย", "#AIgirl", "#AI", "#fyp"],
    });
    made.push(title); seen.add(title);
    arc = { ...arc, next: arc.next + 1 };
    if (arc.next >= arc.episodes.length) arc = null;
  }
  return { clips, arc, made: made.slice(-MAX_MADE_KEPT) };
}
