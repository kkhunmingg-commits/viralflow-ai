import { z } from "zod";

/**
 * What Google Flow is asked to make for one AI LIVE presenter (14 Nov, owner: "auto-generate the presenter").
 * 1 face take (no picture: its last frame becomes the face), then 12 talking takes and 2 idle takes that all start
 * from that face, so every take is the same person. The talking takes teach the CPU lip-sync which mouth goes with
 * which sound; the idle takes are the body loop shown on stream.
 */
export type TakeRole = "FACE" | "TALK" | "IDLE";
export type TakeStatus = "PLANNED" | "QUEUED" | "DONE" | "FAILED";
export interface PresenterTake {
  key: string; role: TakeRole; line: string | null; clipId: string | null; attempts: number; status: TakeStatus;
  path: string | null; error: string | null;
  /** What the server's check found on the kept take (length, voice level), or why the last one failed it. */
  check?: string | null;
}
export type PresenterStatus = "FACE" | "CLIPS" | "READY" | "FAILED";
export const presenterStatusLabels: Record<PresenterStatus, string> = {
  FACE: "กำลังสร้างหน้าพรีเซนเตอร์", CLIPS: "กำลังสร้างคลิปพูดและคลิปนิ่ง", READY: "พร้อมใช้", FAILED: "สร้างไม่สำเร็จ",
};
/** A take Flow refused or that failed checks is tried this many times in all, then the presenter stops and says why. */
export const MAX_TAKE_ATTEMPTS = 3;
export const CREDITS_PER_TAKE = 10;

export const TALK_LINES = [
  "สวัสดีค่ะทุกคน ยินดีต้อนรับเข้าไลฟ์นะคะ วันนี้มีโปรพิเศษเยอะมากเลยค่ะ",
  "ใครเพิ่งเข้ามา กดหัวใจให้หน่อยนะคะ แล้วพิมพ์ทักทายกันได้เลยค่ะ",
  "ตัวนี้ขายดีที่สุดในร้านเลยค่ะ ใช้ง่าย พกสะดวก ราคาไม่แรงด้วยนะคะ",
  "สนใจตัวไหนพิมพ์เลขสินค้ามาได้เลยค่ะ เดี๋ยวแอดมินตอบให้ทันทีนะคะ",
  "ตอนนี้ลดเหลือแค่ร้อยเก้าสิบเก้าบาท ส่งฟรีทั่วประเทศเลยค่ะ",
  "กดตะกร้าสีส้มด้านล่างได้เลยนะคะ ของมีจำนวนจำกัดค่ะ",
  "มีหลายสีให้เลือกค่ะ ทั้งสีดำ สีขาว และสีชมพูพาสเทลนะคะ",
  "คุณภาพดีมากค่ะ ลูกค้ารีวิวห้าดาวกันเยอะมาก กลับมาซื้อซ้ำด้วยค่ะ",
  "ขอบคุณสำหรับออเดอร์นะคะ คุณพี่ได้ของภายในสองถึงสามวันค่ะ",
  "ถามได้เลยค่ะ ใช้ยังไง ขนาดเท่าไหร่ หนูตอบได้ทุกคำถามนะคะ",
  "ฝากกดติดตามร้านด้วยนะคะ จะได้ไม่พลาดโปรดีๆ ในไลฟ์หน้าค่ะ",
  "โอ้โห ยอดสั่งเข้ามาเรื่อยๆ เลยค่ะ ใครยังไม่ได้รีบกดนะคะ",
] as const;
export const IDLE_TAKES = 2;

const DEFAULT_LOOK = "a friendly Thai woman live-commerce host, about 27 years old, smart-casual blouse";
const STAGE = "Vertical 9:16, chest-up, facing the camera straight on, soft even studio lighting on the face, plain softly blurred light-grey studio background. "
  + "The camera is locked on a tripod: no zoom, no pan, no camera movement. Hands stay below the frame and nothing covers the mouth.";

/** English describing the presenter's look: only what the owner typed, never their quotes or instructions. */
export function lookText(look: string) {
  const clean = look.replace(/["“”]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  return clean || DEFAULT_LOOK;
}

// 14 Nov, first live run: Flow failed the face take with "สร้างเสียงไม่สำเร็จ" (its audio step failed). Asking for "no
// sound" seems to trip it, so silent takes ask for quiet room tone instead, and each retry words the take differently.
const QUIET = ["Audio: soft quiet studio room tone only.", "Audio: gentle quiet indoor ambience.", "Audio: calm soft background hum of a quiet room."];
const pick = <T,>(list: readonly T[], attempt: number) => list[Math.max(0, attempt) % list.length];

export function facePrompt(look: string, attempt = 0) {
  return `Photorealistic video of ${lookText(look)}. ${STAGE} She sits still and looks into the lens with her lips gently closed and a soft smile, `
    + `only natural breathing and blinking, she does not speak. The final frame is a clear, sharp, front-facing shot of her face. ${pick(QUIET, attempt)}`;
}
export function talkPrompt(line: string, attempt = 0) {
  const voice = ["speaking Thai clearly and warmly", "speaking Thai in a friendly, lively voice", "speaking Thai naturally and cheerfully"];
  return `The woman in the picture talks directly to the camera like a Thai live-stream seller, ${pick(voice, attempt)}: "${line}". `
    + `${STAGE} Her head stays mostly still with small natural nods. Same person, same clothes, same lighting and background throughout.`;
}
export function idlePrompt(attempt = 0) {
  return "The woman in the picture listens to the camera and smiles softly with her lips closed, small natural breathing and blinking, tiny head movements, she does not speak. "
    + `${STAGE} Same person, same clothes, same lighting and background throughout. ${pick(QUIET, attempt)}`;
}
/** `attempt` = tries already made: a retry gets different wording, since Flow refusing a prompt tends to repeat. */
export function promptFor(take: Pick<PresenterTake, "role" | "line">, look: string, attempt = 0) {
  if (take.role === "FACE") return facePrompt(look, attempt);
  if (take.role === "TALK") return talkPrompt(take.line ?? TALK_LINES[0], attempt);
  return idlePrompt(attempt);
}

/** Flow's and the worker's failure codes in words the owner reads on the take. */
export function failureLabel(code: string | null | undefined) {
  const value = String(code ?? "");
  if (!value) return "";
  if (value.startsWith("ตรวจไม่ผ่าน")) return value;
  if (/FLOW_REPORTED_FAILURE/.test(value)) return "Flow สร้างไม่สำเร็จ (คืนเครดิตแล้ว) กำลังลองใหม่ด้วยคำสั่งแบบอื่น";
  if (/FLOW_UNUSUAL_ACTIVITY/.test(value)) return "Flow แจ้งกิจกรรมผิดปกติ รอแล้วลองใหม่";
  if (/NO_CREDIT/.test(value)) return "เครดิตหมด รอบัญชีถัดไปหรือวันพรุ่งนี้";
  if (/NEW_VIDEO_TIMEOUT|WORKER_LOST/.test(value)) return "รอวิดีโอนานเกิน กำลังลองใหม่";
  if (/LOGIN/.test(value)) return "บัญชี Google ต้องล็อกอินใหม่";
  return value.slice(0, 120);
}

export function planTakes(): PresenterTake[] {
  const blank = { clipId: null, attempts: 0, status: "PLANNED" as const, path: null, error: null };
  return [
    { key: "face", role: "FACE", line: null, ...blank },
    ...TALK_LINES.map((line, i) => ({ key: `talk-${i + 1}`, role: "TALK" as const, line, ...blank })),
    ...Array.from({ length: IDLE_TAKES }, (_, i) => ({ key: `idle-${i + 1}`, role: "IDLE" as const, line: null, ...blank })),
  ];
}
export const totalCredits = () => planTakes().length * CREDITS_PER_TAKE;

export function progressOf(takes: PresenterTake[]) {
  return { done: takes.filter(t => t.status === "DONE").length, total: takes.length, failed: takes.filter(t => t.status === "FAILED").length,
    rejected: takes.filter(t => t.status !== "DONE" && t.error?.startsWith("ตรวจไม่ผ่าน")).length };
}
/** Takes needed beyond those already made: what the Google accounts still have to pay for. */
export const takesLeft = (takes: PresenterTake[]) => takes.filter(t => t.status !== "DONE").length;

export const createPresenterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  look: z.string().trim().max(300).optional().default(""),
  credits: z.literal("on"),
});
