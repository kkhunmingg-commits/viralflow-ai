/**
 * "สาวไทย AI" channel (16 Nov, owner): the old faceless clips brought almost no follows, so the channel is rebuilt
 * around ONE recurring AI Thai girl. Flow first makes 4 candidate faces (a short selfie take each; its last frame
 * becomes the face picture), the owner picks one, and every clip after that attaches that picture as Flow's
 * ingredient image so it is always the same girl: outfit flips, before/after, dances and daily life.
 * Pure: prompts, concepts and the batch plan, tested without a database.
 */

export const FACE_CANDIDATES = 4;
export const MAX_FACE_ATTEMPTS = 2;

export type CandidateStatus = "QUEUED" | "DONE" | "FAILED";
export interface FaceCandidate {
  key: string; clipId: string | null; attempts: number; status: CandidateStatus; stillPath: string | null; error: string | null;
}
export type CharacterStatus = "FACES" | "PICK" | "READY";
export interface GirlCharacter {
  id: string; name: string; look: string; status: CharacterStatus; candidates: FaceCandidate[];
  facePath: string | null; createdAt: string; updatedAt: string;
}
export interface GirlState {
  version: 1; character: GirlCharacter | null;
  /** When the owner cleared the old clips and stats: the learning loop only reads clips made after this. */
  resetAt: string | null;
}
export const emptyGirlState = (): GirlState => ({ version: 1, character: null, resetAt: null });

export const characterStatusLabels: Record<CharacterStatus, string> = {
  FACES: "กำลังสร้างหน้าให้เลือก", PICK: "เลือกหน้าที่ชอบ", READY: "พร้อมทำคลิป",
};

/** Four different starting looks, so the owner has a real choice. The owner's own words replace them when given. */
const LOOKS = [
  "long straight dark-brown hair with soft see-through bangs, fair glowing skin, soft K-beauty style makeup with rosy blush, big bright eyes, wearing a cream knit sweater",
  "long glossy black hair with gentle waves, warm honey Thai skin tone, glossy pink lips, sweet smile with dimples, wearing a pastel pink cardigan",
  "shoulder-length black bob with a side part, porcelain skin, subtle cat-eye liner, elegant and confident, wearing a white satin blouse",
  "long dark hair in a high ponytail, healthy sun-kissed skin, bright playful smile, sporty cute look, wearing a light-blue fitted t-shirt",
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

// ---------------------------------------------------------------- Clip ideas

export const GIRL_SERIES = ["แปลงลุควับ", "ก่อน/หลัง", "เต้นเพลงฮิต", "ชีวิตน้อง"] as const;
export type GirlSeries = (typeof GIRL_SERIES)[number];

export interface GirlConcept {
  series: GirlSeries; title: string; hashtags: readonly string[];
  /** The Thai she says (short; Flow's audio step fails on long lines). */
  line: string;
  /** What happens, beat by beat. */
  start: string; turn: string; end: string;
  music: boolean;
}

export const GIRL_CONCEPTS: readonly GirlConcept[] = [
  { series: "แปลงลุควับ", title: "ชุดนอนเป็นชุดเที่ยวทะเล", hashtags: ["#แปลงร่าง", "#ชุดเที่ยว", "#outfit"], line: "ไปทะเลกันไหม", music: true,
    start: "she stands in her bedroom in loose pastel pajamas, hair messy, yawning and stretching toward the camera",
    turn: "she snaps her fingers in front of the lens and the shot cuts on the beat",
    end: "she is now on a bright sunny Thai beach in a flowy white sundress with long sleeves and a straw hat, twirling once and smiling at the camera" },
  { series: "แปลงลุควับ", title: "เสื้อยืดตัวโคร่งเป็นชุดไทย", hashtags: ["#ชุดไทย", "#แปลงร่าง", "#thaidress"], line: "สวยแบบไทยๆ ค่ะ", music: true,
    start: "she stands at a mirror in an oversized grey t-shirt with her hair tied up casually, making a cute shy face",
    turn: "she spins around quickly and the shot cuts on the beat mid-spin",
    end: "she finishes the spin wearing an elegant gold-and-cream Thai traditional silk dress with a neatly draped sash, hair in a neat bun with a flower, on an old Thai street with warm lanterns at dusk" },
  { series: "แปลงลุควับ", title: "ชุดออกกำลังเป็นสาวคาเฟ่", hashtags: ["#แปลงร่าง", "#คาเฟ่", "#outfit"], line: "เหงื่อหมดแล้ว ไปคาเฟ่ต่อค่ะ", music: true,
    start: "she jogs in place in a modest black sports set and a zip-up jacket, ponytail swinging, wiping her forehead",
    turn: "she flips her ponytail toward the lens and the shot cuts on the beat",
    end: "she sits in a sunny minimal café in a soft beige knit cardigan and long skirt, hair down in soft waves, sipping an iced latte and smiling" },
  { series: "แปลงลุควับ", title: "ชุดทำงานเป็นชุดปาร์ตี้", hashtags: ["#แปลงร่าง", "#ปาร์ตี้", "#ootd"], line: "เลิกงานแล้ว ไปปาร์ตี้", music: true,
    start: "she stands by an office window in a navy blazer and white shirt, holding a folder and checking her watch",
    turn: "she tosses the folder off-screen and the shot cuts on the beat",
    end: "she is on a city rooftop at night with bokeh lights, wearing a sparkly long-sleeve knee-length party dress, swaying to the music and laughing" },
  { series: "แปลงลุควับ", title: "ฮู้ดดี้วันฝนตกเป็นสาวตลาดนัด", hashtags: ["#แปลงร่าง", "#ตลาดนัด", "#ootd"], line: "ฝนหยุดแล้ว ไปเดินตลาดกัน", music: true,
    start: "she sits by a rainy window in a big hoodie with the hood up, pouting at the rain",
    turn: "she pulls the hood down toward the lens and the shot cuts on the beat",
    end: "she walks through a lively Thai night market with neon signs in a cute denim jacket and white top, waving at the camera" },
  { series: "ก่อน/หลัง", title: "หน้าสดเป็นหน้าแต่ง", hashtags: ["#ก่อนหลัง", "#แต่งหน้า", "#makeup"], line: "หน้าสดกับหน้าแต่ง ชอบแบบไหน", music: true,
    start: "she sits at a vanity with a fluffy headband, bare natural skin, looking into the camera and shrugging playfully",
    turn: "she swipes a big makeup brush across the lens and the shot cuts on the beat",
    end: "she now has soft glam makeup with glowing skin, rosy lips and her hair down in glossy waves, blowing a small kiss to the camera" },
  { series: "ก่อน/หลัง", title: "ตื่นนอนเป็นพร้อมออกเดต", hashtags: ["#ก่อนหลัง", "#ออกเดต", "#grwm"], line: "สิบนาทีพร้อมออกเดต", music: true,
    start: "she sits up in bed under a white duvet in pajamas, hair messy, rubbing her eyes sleepily",
    turn: "she pulls the duvet up over the lens and the shot cuts on the beat",
    end: "she stands at the front door in a pretty floral midi dress with a small handbag, hair styled, giving a confident smile" },
  { series: "ก่อน/หลัง", title: "ผมยุ่งเป็นผมลอนสวย", hashtags: ["#ก่อนหลัง", "#ทำผม", "#hair"], line: "ผมพังแค่ไหนก็เอาอยู่", music: true,
    start: "she looks at the camera with frizzy, messy morning hair, pulling a funny face",
    turn: "she covers the lens with her palm and the shot cuts on the beat",
    end: "she pulls her hand away revealing shiny bouncy long waves, flipping her hair in slow motion with a sweet smile" },
  { series: "เต้นเพลงฮิต", title: "เต้นมือตามเพลงในห้องนอน", hashtags: ["#เต้น", "#handdance", "#เต้นตามเทรนด์"], line: "เต้นตามกันได้นะ", music: true,
    start: "she sits facing the camera on her bed in a cute oversized sweater, already doing a fast, catchy hand-dance choreography with finger hearts",
    turn: "the moves speed up with the beat, small head tilts and winks",
    end: "she ends the move by framing her face with both hands and smiling at the camera" },
  { series: "เต้นเพลงฮิต", title: "เต้นบนดาดฟ้าตอนพระอาทิตย์ตก", hashtags: ["#เต้น", "#sunset", "#เต้นตามเทรนด์"], line: "เต้นกันค่ะ", music: true,
    start: "she dances easy, cute TikTok steps on a rooftop at sunset in high-waisted jeans and a cropped-length but modest white t-shirt, city skyline behind",
    turn: "she does a little spin and a shoulder bounce on the beat",
    end: "she finishes with a peace sign and a laugh, the sun glowing behind her" },
  { series: "เต้นเพลงฮิต", title: "เต้นในคาเฟ่กับแก้วกาแฟ", hashtags: ["#เต้น", "#คาเฟ่", "#เต้นตามเทรนด์"], line: "กาแฟแก้วนี้ต้องเต้น", music: true,
    start: "she stands at a cute café counter in a pastel cardigan, holding an iced coffee and bobbing to the beat",
    turn: "she does a playful side-step dance while keeping the cup steady",
    end: "she sips through the straw and gives the camera a thumbs-up" },
  { series: "เต้นเพลงฮิต", title: "เต้นริมทะเลชุดเดรส", hashtags: ["#เต้น", "#ทะเล", "#เต้นตามเทรนด์"], line: "ทะเลสวยมากเลย", music: true,
    start: "she dances barefoot on the sand in a flowing long-sleeve sundress, waves rolling behind her",
    turn: "she kicks a little splash of water on the beat and laughs",
    end: "she turns back to the camera, holding her hat against the breeze and smiling" },
  { series: "ชีวิตน้อง", title: "ตำส้มตำกินเอง", hashtags: ["#ส้มตำ", "#อาหารไทย", "#ชีวิตประจำวัน"], line: "เผ็ดแค่ไหนก็ไหว", music: false,
    start: "she pounds green papaya salad in a clay mortar in a bright home kitchen, wearing an apron over a striped t-shirt",
    turn: "she tastes a spoonful and her eyes go wide at the spice, fanning her mouth",
    end: "she laughs, gives a thumbs-up and holds the plate toward the camera" },
  { series: "ชีวิตน้อง", title: "กอดแมวส้มตอนเช้า", hashtags: ["#แมว", "#แมวส้ม", "#ชีวิตประจำวัน"], line: "ตื่นแล้วเหรอลูก", music: false,
    start: "she sits on a sunny sofa in a soft cardigan as a fluffy orange cat climbs into her lap",
    turn: "the cat pats her cheek with a paw and she giggles",
    end: "she hugs the cat and both look at the camera" },
  { series: "ชีวิตน้อง", title: "วาดหัวใจบนกระจกวันฝนตก", hashtags: ["#ฝนตก", "#ชีวิตประจำวัน", "#mood"], line: "ฝนตกแบบนี้ คิดถึงใครอยู่", music: false,
    start: "she stands at a misty window on a rainy evening in a cozy sweater, holding a warm mug",
    turn: "she draws a small heart on the fogged glass with one finger",
    end: "she looks at the camera through the heart with a soft smile" },
  { series: "ชีวิตน้อง", title: "ข้าวเหนียวมะม่วงตลาดนัด", hashtags: ["#ข้าวเหนียวมะม่วง", "#ตลาดนัด", "#ของกิน"], line: "อร่อยจนต้องบอกต่อ", music: false,
    start: "she walks through a Thai night market in a denim jacket holding a box of mango sticky rice",
    turn: "she takes a bite and closes her eyes happily",
    end: "she points at the box and nods at the camera" },
];

const CTAS = [
  "กดติดตามไว้ เจอกันทุกวันนะคะ",
  "อยากให้ใส่ชุดไหนต่อ คอมเมนต์มาเลย กดติดตามไว้ด้วยนะ",
  "ตอนต่อไปมาพรุ่งนี้ ติดตามไว้ไม่พลาด",
  "ให้คะแนนลุคนี้เต็ม 10 กี่คะแนน ติดตามไว้นะคะ",
] as const;

export const girlTitle = (concept: Pick<GirlConcept, "title">) => `สาว AI: ${concept.title}`;
/** The series a girl clip's title belongs to, for the learning loop. */
export function girlSeriesOfTitle(title: string): GirlSeries | null {
  return GIRL_CONCEPTS.find(c => girlTitle(c) === title)?.series ?? null;
}

export function girlPrompt(concept: GirlConcept, options: { strict?: boolean } = {}) {
  return [
    "Vertical 9:16 TikTok video, a full 8 seconds, photoreal like a real smartphone video.",
    "The young Thai woman in the reference image is the only person in the video: keep her exact face, eyes, nose, lips, skin tone and hair colour from the picture in every frame.",
    `0–3 s: ${concept.start}.`,
    `3–4 s: ${concept.turn}.`,
    `4–8 s: ${concept.end}. Keep moving naturally until the last frame.`,
    "STYLE: cute, stylish and tasteful; she is an adult; every outfit fully covers her (no cleavage, no lingerie, no swimwear, no see-through); flattering soft light, rich colour, crisp focus on her face; smooth natural motion; hands with five fingers.",
    ...(options.strict ? ["EXTRA CARE: keep movements simple and slow, her face clearly visible and unchanged throughout."] : []),
    `AUDIO: ${concept.music ? "an upbeat, catchy instrumental pop beat that her moves follow, and " : "natural room sound, and "}she says only "${concept.line}" in Thai.`,
    "AVOID: on-screen text, captions, logos, watermarks, other people, her face changing, extra limbs, distorted hands.",
  ].join("\n");
}

export interface GirlGuide { recentTitles?: readonly string[]; seriesWeights?: Record<string, number>; episodes?: Record<string, number>; strictSeries?: readonly string[] }
export interface PlannedGirlClip { title: string; prompt: string; caption: string; hashtags: string[]; series: GirlSeries }

/**
 * Picks `count` girl clips: series rotate (never the same twice in a row when another has ideas left), ideas
 * not made recently come first, and series the results liked are picked more often.
 */
export function planGirlClips(count: number, name: string, guide: GirlGuide = {}, random: () => number = Math.random): PlannedGirlClip[] {
  const recent = new Set(guide.recentTitles ?? []), episodes = { ...guide.episodes }, out: PlannedGirlClip[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const last = out.at(-1)?.series;
    const open = (series: GirlSeries) => GIRL_CONCEPTS.filter(c => c.series === series && !used.has(c.title));
    let pool = GIRL_SERIES.filter(s => s !== last && open(s).length);
    if (!pool.length) pool = GIRL_SERIES.filter(s => open(s).length);
    if (!pool.length) { used.clear(); pool = GIRL_SERIES.filter(s => s !== last); }
    const total = pool.reduce((sum, s) => sum + Math.max(0.1, guide.seriesWeights?.[s] ?? 1), 0);
    let roll = random() * total, series = pool[pool.length - 1];
    for (const s of pool) { roll -= Math.max(0.1, guide.seriesWeights?.[s] ?? 1); if (roll <= 0) { series = s; break; } }
    const options = open(series), fresh = options.filter(c => !recent.has(girlTitle(c)));
    const order = guide.recentTitles ?? [];
    const concept = fresh.length ? fresh[Math.floor(random() * fresh.length)]
      : options.toSorted((a, b) => order.indexOf(girlTitle(b)) - order.indexOf(girlTitle(a)))[0];
    used.add(concept.title);
    const episode = (episodes[series] ?? 0) + 1; episodes[series] = episode;
    const who = name.trim() || "น้อง";
    out.push({
      series, title: girlTitle(concept), prompt: girlPrompt(concept, { strict: guide.strictSeries?.includes(series) }),
      caption: `${who} · ${concept.title} EP.${episode}\n${concept.line} ${CTAS[Math.floor(random() * CTAS.length)]}\n(ตัวละคร AI)`,
      hashtags: [...concept.hashtags, "#สาวไทย", "#AIgirl", "#AI", "#fyp"],
    });
  }
  return out;
}

// ---------------------------------------------------------------- Face candidates

export function newCandidates(): FaceCandidate[] {
  return Array.from({ length: FACE_CANDIDATES }, (_, i) => ({ key: `face-${i + 1}`, clipId: null, attempts: 0, status: "QUEUED" as const, stillPath: null, error: null }));
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
    if (clip?.status === "SKIPPED_NO_CREDIT") return; // every Google account is out of credits: waits; the owner can press "สร้างใหม่"
    if (c.attempts >= MAX_FACE_ATTEMPTS) { steps.push({ kind: "GIVE_UP", index, reason: clip?.error ?? clip?.status ?? "ไม่พบคลิป" }); return; }
    steps.push({ kind: "QUEUE", index });
  });
  return steps;
}

/** Faces are done once none is still being made; the owner then picks from those that came out. */
export const facesSettled = (candidates: FaceCandidate[]) => candidates.every(c => c.status !== "QUEUED");
