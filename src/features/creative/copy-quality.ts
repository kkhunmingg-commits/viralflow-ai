/** Copy problems a viewer notices in an 8-second Thai clip, checked the same way whoever wrote the story
 * (the rule-based storyteller or a language model), so their pass rates can be compared fairly. */
import { groundedShare } from "./local-agent";

export interface CopyBeat { role: "HOOK" | "POINT" | "CTA"; text: string }
export interface CopyHistory { lines?: string[]; topics?: string[]; formats?: string[] }

// A Growth close invites the viewer to stay, keep, answer or share. It never sends them to a link, a how-to or a purchase.
const GROWTH_CLOSE = /ติดตาม|เซฟ|คอมเมนต์|เมนต์|แชร์|ส่งต่อ|บอกเพื่อน|เล่าต่อ|ตอนต่อไป|ตอนหน้า|ตอบ|ทาย|เดา|บอกมา|บอกหน่อย|เคยรู้|รู้มาก่อน/;
const OFF_CLOSE = /คลิก|คลิ้ก|ลิงก์|ลิ้ง|ลิงค์|วิธีใช้|ลองใช้|สั่ง|ซื้อ|ตะกร้า|ราคา|ดูวิดีโอ|เปิดวิดีโอ|คุณค่ามาก|เรียนรู้เพิ่มเติม/;
const RECENT_LINES = 12;

/** Empty means the copy reads like one clip with one idea: a hook that opens a question instead of saying the
 * answer, a close that fits a Growth clip, and points that are not a story the account just told in other words. */
export function copyQualityIssues(beats: CopyBeat[], mode: "GROWTH" | "AFFILIATE", history: CopyHistory = {}) {
  const issues: string[] = [];
  const hook = beats.find(b => b.role === "HOOK")?.text ?? "", cta = beats.findLast(b => b.role === "CTA")?.text ?? "";
  const points = beats.filter(b => b.role === "POINT").map(b => b.text);
  // A hook that already contains most of the first point gives the answer away, so the point only repeats it.
  // Naming the topic in a question is fine; saying the point is not.
  if (hook && points[0] && groundedShare(points[0], [hook]) >= .6) issues.push(`hook "${hook}" พูดซ้ำกับเนื้อหา ควรชวนสงสัยแทนการบอกคำตอบ`);
  // A hook from another subject ("this star is strange" over an octopus fact) misleads the viewer.
  const digits = (t: string) => t.match(/[0-9]+(?:[.,][0-9]+)?/g) ?? [];
  if (hook && points.length && groundedShare(hook, points) === 0 && !digits(hook).some(d => points.some(p => digits(p).includes(d))))
    issues.push(`hook "${hook}" ไม่เกี่ยวกับเรื่องในคลิป`);
  if (mode === "GROWTH" && cta && (OFF_CLOSE.test(cta) || !GROWTH_CLOSE.test(cta))) issues.push(`ประโยคปิด "${cta}" ไม่เข้ากับคลิปปั้นบัญชี ควรชวนติดตาม เซฟ คอมเมนต์ หรือแชร์`);
  // Rewording the hook does not make a new story: the same facts as a recent clip are the same clip.
  const recent = new Set((history.lines ?? []).slice(0, RECENT_LINES).map(norm));
  if (points.length && points.every(p => recent.has(norm(p)))) issues.push("เนื้อหาเป็นข้อเท็จจริงชุดเดียวกับคลิปล่าสุด แค่เปลี่ยน hook ไม่นับเป็นเรื่องใหม่");
  return issues;
}
const norm = (text: string) => text.replace(/[\s\p{P}]/gu, "");

/** How much a passing idea adds to the account, from facts the system can check: an untold topic, a format not
 * used in the last clips, and the model's own preference as a tie-break. Not a prediction of views. */
export function noveltyScore(idea: { topic: string | null; format: string | null; modelPick: boolean }, history: CopyHistory) {
  const topics = history.topics ?? [], formats = history.formats ?? [];
  const reasons: string[] = [];
  let score = 0;
  if (idea.topic && !topics.slice(0, 5).includes(idea.topic)) { score += 2; reasons.push("หัวข้อยังไม่ได้เล่าใน 5 คลิปล่าสุด"); }
  if (idea.format && !formats.slice(0, 2).includes(idea.format)) { score += 1; reasons.push("รูปแบบต่างจาก 2 คลิปล่าสุด"); }
  if (idea.modelPick) { score += .5; reasons.push("โมเดลเลือกเป็นอันดับแรก"); }
  return { score, reasons };
}
