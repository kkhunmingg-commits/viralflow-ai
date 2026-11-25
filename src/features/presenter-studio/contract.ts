import { z } from "zod";

/**
 * "สร้างพรีเซนเตอร์ใหม่": the owner makes a new AI LIVE presenter on the website (photo or AI face, voice, personality) and
 * the presenter worker on the owner's PC (D:\ViralFlowAI\workspace\presenter-lab\photo_presenter\presenter_worker.py) builds
 * it with the same free local tools Praew was made with: photo checks + cut-out, MuseTalk mouth assets, Wan2.2 motion clips.
 * Presenters belong to the ViralFlow account, not to a TikTok channel.
 *
 * Two small JSON files in the private state bucket, one per side, so the two never overwrite each other:
 *   desired.json  written by the website  (the presenters the owner wants + which one goes live)
 *   report.json   written by the PC       (build progress of each presenter + what the live uses now)
 */

/** Free voices only (Lucky: no paid TTS). Each id is a TTS backend name in live/tts_backends.py on the PC. */
export const VOICES = [
  { id: "edge-niwat", label: "นิวัฒน์ · ผู้ชาย", gender: "male", hint: "เสียงผู้ชายไทย ชัด สุภาพ (Microsoft Edge ฟรี ต้องต่อเน็ต)" },
  { id: "edge-premwadee-plain", label: "เปรมวดี · ผู้หญิง", gender: "female", hint: "เสียงผู้หญิงไทย ชัด สุภาพ (Microsoft Edge ฟรี ต้องต่อเน็ต)" },
  { id: "vachana-f2", label: "วาจนะ C · ผู้หญิง ใส", gender: "female", hint: "เสียงผู้หญิงในเครื่อง ไม่ต้องต่อเน็ต" },
  { id: "vachana-f1", label: "วาจนะ B · ผู้หญิง นุ่ม", gender: "female", hint: "เสียงผู้หญิงในเครื่อง ไม่ต้องต่อเน็ต" },
  { id: "voxcpm-praew6", label: "เสียงแพรว (เสียง 6)", gender: "female", hint: "เสียงเดียวกับแพรว ใช้การ์ดจอมาก" },
] as const;
export type VoiceId = typeof VOICES[number]["id"];
const voiceIds = VOICES.map(v => v.id) as [VoiceId, ...VoiceId[]];
export const defaultVoice = (gender: Gender): VoiceId => gender === "male" ? "edge-niwat" : "edge-premwadee-plain";

export const GENDERS = ["male", "female"] as const;
export type Gender = typeof GENDERS[number];
export const TONES = ["low", "normal", "high"] as const;
export const QUALITIES = ["quick", "full", "both"] as const;
export type Quality = typeof QUALITIES[number];
export const QUALITY_INFO: Record<Quality, { label: string; hint: string }> = {
  both: { label: "ใช้ได้ก่อน แล้วอัปเกรดเอง", hint: "ใช้ไลฟ์ได้ใน ~5 นาที แล้วเครื่องทำท่าทางแบบแพรวต่ออีก ~2-3 ชม. เปลี่ยนให้เองเมื่อเสร็จ" },
  quick: { label: "แบบเร็ว", hint: "~5 นาที ตัวนิ่ง หายใจเบาๆ ขยับปาก" },
  full: { label: "แบบเต็มเหมือนแพรว", hint: "~2-3 ชม. ขยับหัว พยักหน้า ก้มอ่านคอมเมนต์" },
};

/**
 * Shop sets behind the cut-out presenter. Each id is a theme in photo_presenter/pp_bg.py, made once on the PC (Wan2.2 text to
 * image, free) into praew/bg_lib/<id>.png; the PC uploads a small preview of each one it has. "auto" = by gender (male: general,
 * female: beauty, as before), "custom" = the owner's own shop photo.
 */
export const BACKGROUNDS = [
  { id: "beauty", label: "ร้านความงาม", hint: "ชั้นสกินแคร์ เครื่องสำอาง" },
  { id: "general", label: "ร้านของใช้ทั่วไป", hint: "ชั้นสินค้าหลากสี ของใช้ ขนม" },
  { id: "shop", label: "หน้าร้านค้า", hint: "เคาน์เตอร์กระจก ชั้นวางของ" },
  { id: "warehouse", label: "โกดังแพ็กของ", hint: "ชั้นกล่องพัสดุ โต๊ะแพ็ก" },
  { id: "fashion", label: "ร้านเสื้อผ้า", hint: "ราวเสื้อ กระเป๋า กระจก" },
  { id: "food", label: "อาหาร ขนม เครื่องดื่ม", hint: "ชั้นขนม ซอส เครื่องดื่ม" },
  { id: "gadget", label: "มือถือ ไอที", hint: "ชั้นมือถือ หูฟัง แกดเจ็ต" },
  { id: "home", label: "ของใช้ในบ้าน", hint: "เครื่องครัว ภาชนะ ของแต่งบ้าน" },
  { id: "studio", label: "สตูดิโอไลฟ์", hint: "ผนังเรียบ ไฟประดับ สะอาดตา" },
  { id: "luxury", label: "บูติกหรู", hint: "กรอบทอง กระจก โทนพรีเมียม" },
] as const;
export type BackgroundId = typeof BACKGROUNDS[number]["id"];
const backgroundIds = BACKGROUNDS.map(b => b.id) as [BackgroundId, ...BackgroundId[]];
export const BG_CHOICES = ["auto", ...backgroundIds, "custom"] as const;
export type BgChoice = typeof BG_CHOICES[number];
export const bgChoiceSchema = z.enum(BG_CHOICES);
/** The theme the PC builds with ("custom" = the owner's photo at bgPath). */
export const autoBackground = (gender: Gender): BackgroundId => gender === "male" ? "general" : "beauty";
export const resolveBackground = (p: { background?: BgChoice; gender: Gender }): BackgroundId | "custom" =>
  !p.background || p.background === "auto" ? autoBackground(p.gender) : p.background;
export const backgroundLabel = (id: string) => id === "custom" ? "รูปร้านของฉัน" : BACKGROUNDS.find(b => b.id === id)?.label ?? id;

/** Praew is built in; every other presenter id is `p` + 8 lowercase letters/digits (the PC folder is praew/user_<id>). */
export const PRAEW_ID = "praew";
export const presenterId = z.string().regex(/^p[a-z0-9]{8}$/);
export const MAX_PRESENTERS = 12;

/** Paths the owner uploaded: only their own presenter-studio folder. */
export const ownsPhoto = (owner: string, path: string) =>
  path.startsWith(`owner/${owner}/presenter-studio/`) && !path.includes("..") && /^[A-Za-z0-9/_.-]{1,300}$/.test(path);

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("photo"), path: z.string().min(1).max(300) }),
  // The PC makes 4 candidate faces from the description; the owner picks one (pick = 0..3), then the build starts.
  z.object({ kind: z.literal("generate"), look: z.string().trim().min(3).max(300), pick: z.number().int().min(0).max(3).optional() }),
]);

export const presenterSchema = z.object({
  id: presenterId,
  name: z.string().trim().min(1).max(30),
  gender: z.enum(GENDERS),
  voice: z.enum(voiceIds),
  tone: z.enum(TONES).default("normal"),
  personality: z.string().trim().max(300).default(""),
  quality: z.enum(QUALITIES).default("both"),
  source: sourceSchema,
  background: bgChoiceSchema.default("auto"),
  /** The owner's own shop photo (background "custom"). */
  bgPath: z.string().min(1).max(300).optional(),
  createdAt: z.string().max(40),
  consentAt: z.string().max(40),
  /** Raised to make the PC build this presenter again from scratch (e.g. after a failure). */
  rev: z.number().int().min(0).max(1000).default(0),
});
export type Presenter = z.infer<typeof presenterSchema>;

/**
 * Praew's scene (2026-11-25): Praew was filmed in one real shop, so "original" keeps those frames (avatar3b). Any other choice makes
 * the PC cut Praew out of every frame and put her in front of that set (praew/avatar3b_bg_<id>), used from the next live.
 */
export const PRAEW_BG_CHOICES = ["original", ...backgroundIds, "custom"] as const;
export type PraewBg = typeof PRAEW_BG_CHOICES[number];
export const praewSceneSchema = z.object({
  background: z.enum(PRAEW_BG_CHOICES).default("original"),
  bgPath: z.string().min(1).max(300).optional(),
  /** Raised on every change so the PC (re)builds even when the same choice is picked again (e.g. a new shop photo). */
  rev: z.number().int().min(0).max(100000).default(0),
});
export type PraewScene = z.infer<typeof praewSceneSchema>;
export const praewBackgroundLabel = (id: PraewBg) => id === "original" ? "ฉากเดิมของแพรว" : backgroundLabel(id);

export interface StudioDesired { presenters: Presenter[]; active: string; updatedAt: string | null; praew?: PraewScene }
export const emptyStudio = (): StudioDesired => ({ presenters: [], active: PRAEW_ID, updatedAt: null });

/** What the owner fills in on the page. */
export const createInputSchema = z.object({
  name: z.string().trim().min(1, "ใส่ชื่อพรีเซนเตอร์").max(30, "ชื่อยาวเกิน 30 ตัวอักษร"),
  gender: z.enum(GENDERS),
  voice: z.enum(voiceIds),
  tone: z.enum(TONES).default("normal"),
  personality: z.string().trim().max(300).default(""),
  quality: z.enum(QUALITIES).default("both"),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("photo"), path: z.string().min(1).max(300) }),
    z.object({ kind: z.literal("generate"), look: z.string().trim().min(3, "บอกลักษณะหน้าตาสั้นๆ").max(300) }),
  ]),
  background: bgChoiceSchema.default("auto"),
  bgPath: z.string().min(1).max(300).optional(),
  consent: z.literal(true),
});
export type CreateInput = z.infer<typeof createInputSchema>;

export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), presenter: createInputSchema }),
  z.object({ action: z.literal("uploadUrl"), type: z.enum(["image/jpeg", "image/png"]) }),
  z.object({ action: z.literal("pickFace"), id: presenterId, pick: z.number().int().min(0).max(3) }),
  z.object({ action: z.literal("rebuild"), id: presenterId }),
  z.object({ action: z.literal("delete"), id: presenterId }),
  z.object({ action: z.literal("activate"), id: z.union([presenterId, z.literal(PRAEW_ID)]) }),
  z.object({ action: z.literal("update"), id: presenterId, voice: z.enum(voiceIds).optional(), tone: z.enum(TONES).optional(), personality: z.string().trim().max(300).optional(), name: z.string().trim().min(1).max(30).optional(),
    /** A new shop set is baked into every clip: changing it rebuilds the presenter. */
    background: bgChoiceSchema.optional(), bgPath: z.string().min(1).max(300).optional() }),
  z.object({ action: z.literal("praewScene"), background: z.enum(PRAEW_BG_CHOICES), bgPath: z.string().min(1).max(300).optional() }),
]);
export type StudioAction = z.infer<typeof actionSchema>;

export class StudioError extends Error {}

function checkBackground(owner: string, background: BgChoice, bgPath: string | undefined) {
  if (background !== "custom") return;
  if (!bgPath) throw new StudioError("BG_PHOTO_MISSING");
  if (!ownsPhoto(owner, bgPath)) throw new StudioError("PHOTO_NOT_YOURS");
}

/** Applies one owner action to the desired state (pure, so the rules are tested). */
export function applyAction(d: StudioDesired, action: Exclude<StudioAction, { action: "uploadUrl" }>, owner: string, now: Date, newId: () => string): StudioDesired {
  const at = now.toISOString();
  const find = (id: string) => {
    const p = d.presenters.find(x => x.id === id);
    if (!p) throw new StudioError("PRESENTER_NOT_FOUND");
    return p;
  };
  const put = (p: Presenter) => ({ ...d, presenters: d.presenters.map(x => x.id === p.id ? p : x), updatedAt: at });
  switch (action.action) {
    case "create": {
      if (d.presenters.length >= MAX_PRESENTERS) throw new StudioError("TOO_MANY_PRESENTERS");
      const input = action.presenter;
      if (input.source.kind === "photo" && !ownsPhoto(owner, input.source.path)) throw new StudioError("PHOTO_NOT_YOURS");
      if (d.presenters.some(p => p.name === input.name)) throw new StudioError("NAME_TAKEN");
      checkBackground(owner, input.background, input.bgPath);
      const presenter: Presenter = {
        id: newId(), name: input.name, gender: input.gender, voice: input.voice, tone: input.tone, personality: input.personality,
        quality: input.quality, source: input.source, background: input.background,
        ...(input.background === "custom" ? { bgPath: input.bgPath } : {}), createdAt: at, consentAt: at, rev: 0,
      };
      return { ...d, presenters: [...d.presenters, presenter], updatedAt: at };
    }
    case "pickFace": {
      const p = find(action.id);
      if (p.source.kind !== "generate") throw new StudioError("NOT_GENERATED");
      return put({ ...p, source: { ...p.source, pick: action.pick } });
    }
    case "rebuild": {
      const p = find(action.id);
      const source = p.source.kind === "generate" ? { kind: "generate" as const, look: p.source.look } : p.source;
      return put({ ...p, source, rev: p.rev + 1 });
    }
    case "update": {
      const p = find(action.id);
      if (action.name && d.presenters.some(x => x.id !== p.id && x.name === action.name)) throw new StudioError("NAME_TAKEN");
      let next: Presenter = p;
      if (action.background !== undefined) {
        const bgPath = action.background === "custom" ? action.bgPath ?? p.bgPath : undefined;
        checkBackground(owner, action.background, bgPath);
        if (action.background !== p.background || bgPath !== p.bgPath) {
          const { bgPath: _old, ...rest } = p; void _old;
          const source = p.source.kind === "generate" && p.source.pick === undefined ? { kind: "generate" as const, look: p.source.look } : p.source;
          next = { ...rest, background: action.background, ...(bgPath ? { bgPath } : {}), source, rev: p.rev + 1 };
        }
      }
      return put({ ...next, ...(action.voice ? { voice: action.voice } : {}), ...(action.tone ? { tone: action.tone } : {}),
        ...(action.personality !== undefined ? { personality: action.personality } : {}), ...(action.name ? { name: action.name } : {}) });
    }
    case "delete": {
      find(action.id);
      return { presenters: d.presenters.filter(p => p.id !== action.id), active: d.active === action.id ? PRAEW_ID : d.active, updatedAt: at };
    }
    case "praewScene": {
      const was = d.praew ?? { background: "original" as const, rev: 0 };
      const bgPath = action.background === "custom" ? action.bgPath ?? was.bgPath : undefined;
      if (action.background === "custom") checkBackground(owner, "custom", bgPath);
      // picking the same choice again is a retry (e.g. after a failed build): it still raises rev
      return { ...d, praew: { background: action.background, ...(bgPath ? { bgPath } : {}), rev: was.rev + 1 }, updatedAt: at };
    }
    case "activate": {
      if (action.id !== PRAEW_ID) find(action.id);
      return { ...d, active: action.id, updatedAt: at };
    }
  }
}

// ---------------------------------------------------------------- what the PC reports

export const JOB_STATES = ["waiting", "faces", "pick_face", "building", "ready_quick", "ready", "failed"] as const;
export type JobState = typeof JOB_STATES[number];
const short = (n: number) => z.string().max(n).nullish();
export const jobReportSchema = z.object({
  state: z.enum(JOB_STATES),
  rev: z.number().int().min(0).default(0),
  /** Thai, one line, for the owner (e.g. "กำลังสร้างท่าทาง 3/6"). */
  message: short(200),
  error: short(300),
  percent: z.number().min(0).max(100).nullish(),
  etaMin: z.number().min(0).max(1000).nullish(),
  /** How many candidate faces the PC uploaded (generate mode). */
  faces: z.number().int().min(0).max(4).nullish(),
  /** A face picture of the built presenter was uploaded (face.jpg). */
  face: z.boolean().nullish(),
  voiceSample: z.boolean().nullish(),
  quick: z.boolean().nullish(),
  full: z.boolean().nullish(),
  warnings: z.array(z.string().max(40)).max(8).nullish(),
  updatedAt: short(40),
});
export type JobReport = z.infer<typeof jobReportSchema>;
export const studioReportSchema = z.object({
  jobs: z.record(z.string().max(12), jobReportSchema).default({}),
  /** The presenter the live uses now (applied while the live was off). */
  active: short(12),
  /** The live is on air: builds and presenter switches wait until it stops (both need the graphics card). */
  liveRunning: z.boolean().default(false),
  /** The PC has a local face generator for the "AI makes the face" option. */
  faceGenerator: z.boolean().default(false),
  worker: short(40),
  /** Shop sets the PC has made and uploaded a preview of (library/bg_<id>.jpg). */
  // the PC sends [{id, label}] (or plain ids); unknown ids are dropped so a newer PC never breaks the report
  backgrounds: z.preprocess(v => Array.isArray(v)
    ? [...new Set(v.map(x => typeof x === "string" ? x : (x as { id?: unknown } | null)?.id).filter((id): id is BackgroundId => backgroundIds.includes(id as BackgroundId)))]
    : [], z.array(z.enum(backgroundIds))).default([]),
  /** Praew's scene change (pp_praew_bg.py on the PC). */
  praew: z.object({
    state: z.enum(["waiting", "building", "ready", "failed"]),
    rev: z.number().int().min(0).default(0),
    background: short(20),
    message: short(200),
    error: short(300),
    percent: z.number().min(0).max(100).nullish(),
    etaMin: z.number().min(0).max(1000).nullish(),
    updatedAt: short(40),
  }).nullish(),
});
export type StudioReport = z.infer<typeof studioReportSchema> & { receivedAt: string };
export type PraewSceneReport = NonNullable<StudioReport["praew"]>;

/** The worker reports every ~10 s: seen in the last 60 s means it is running. */
export const WORKER_ONLINE_MS = 60_000;
export const workerOnline = (r: Pick<StudioReport, "receivedAt"> | null, now = Date.now()) => r !== null && now - Date.parse(r.receivedAt) < WORKER_ONLINE_MS;

/** The status the page shows for one presenter, from the owner's wish + the PC's report. */
export function presenterStatus(p: Presenter, job: JobReport | undefined, online: boolean) {
  if (!job || job.rev < p.rev) {
    return { tone: "wait", label: online ? "รอคิวในเครื่อง" : "รอเครื่องออนไลน์", usable: false };
  }
  if (job.state === "pick_face" && p.source.kind === "generate" && p.source.pick !== undefined) return { tone: "busy", label: "เลือกหน้าแล้ว รอเริ่มสร้าง", usable: false };
  const map: Record<JobState, { tone: string; label: string; usable: boolean }> = {
    waiting: { tone: "wait", label: "รอปิดไลฟ์ก่อน (ใช้การ์ดจอ)", usable: false },
    faces: { tone: "busy", label: "AI กำลังสร้างหน้า 4 แบบ", usable: false },
    pick_face: { tone: "ask", label: "เลือกหน้าที่ชอบ", usable: false },
    building: { tone: "busy", label: "กำลังสร้าง", usable: false },
    ready_quick: { tone: "ok", label: "ใช้ได้แล้ว · กำลังอัปเกรดท่าทาง", usable: true },
    ready: { tone: "ok", label: "พร้อมใช้", usable: true },
    failed: { tone: "bad", label: "สร้างไม่สำเร็จ", usable: false },
  };
  return map[job.state];
}

/** What Praew's row shows about her scene: nothing while the PC has caught up with the owner's choice and it is the original. */
export function praewSceneStatus(scene: PraewScene | undefined, job: PraewSceneReport | null | undefined, online: boolean) {
  if (!scene || scene.rev === 0) return null;
  if (!job || job.rev < scene.rev) return { tone: "wait", label: online ? "รอเปลี่ยนฉากในเครื่อง" : "รอเครื่องออนไลน์", message: null, percent: null };
  const map = {
    waiting: { tone: "wait", label: "รอปิดไลฟ์ก่อน (ใช้การ์ดจอ)" },
    building: { tone: "busy", label: "กำลังเปลี่ยนฉาก" },
    ready: { tone: "ok", label: "ฉากใหม่พร้อม" },
    failed: { tone: "bad", label: "เปลี่ยนฉากไม่สำเร็จ" },
  } as const;
  return { ...map[job.state], message: job.state === "failed" ? job.error ?? null : job.message ?? null, percent: job.state === "building" ? job.percent ?? null : null };
}

export const ERRORS_TH: Record<string, string> = {
  PRESENTER_NOT_FOUND: "ไม่พบพรีเซนเตอร์นี้",
  TOO_MANY_PRESENTERS: `สร้างได้สูงสุด ${MAX_PRESENTERS} คน ลบคนที่ไม่ใช้ก่อน`,
  PHOTO_NOT_YOURS: "รูปนี้ไม่ใช่ของบัญชีนี้ อัปโหลดใหม่",
  NAME_TAKEN: "มีพรีเซนเตอร์ชื่อนี้แล้ว",
  NOT_GENERATED: "พรีเซนเตอร์นี้ใช้รูปที่อัปโหลด",
  NOT_READY: "พรีเซนเตอร์นี้ยังสร้างไม่เสร็จ",
  BG_PHOTO_MISSING: "อัปโหลดรูปร้านก่อน หรือเลือกฉากสำเร็จรูป",
};
