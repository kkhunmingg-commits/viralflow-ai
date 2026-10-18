import { createHash } from "node:crypto";
import type { StoryBeat, StoryFormat, StoryPlan } from "../video/story-director";
import { spokenThai } from "../video/spoken-thai";

/** Rule-based storytelling. It reads the verified facts, the topic or product and what this account
 * published recently, then picks a narrative format and hook. It is deterministic and inspectable;
 * it is not a language model and does not claim to predict what will go viral. */
export const STORYTELLER_MODE = "RULE_BASED_STORYTELLER_V1";
/** Newest first. `lines` holds every beat the account's recent clips spoke, so a fact is not repeated while others wait. */
export interface StoryHistory { formats: string[]; hooks: string[]; topics: string[]; lines?: string[] }
export const EMPTY_HISTORY: StoryHistory = { formats: [], hooks: [], topics: [], lines: [] };
/** Facts not spoken recently go first; among spoken ones, the longest ago goes first. Order is otherwise kept. */
function freshFirst<T extends { text: string }>(facts: T[], history: StoryHistory) {
  const lines = (history.lines ?? []).map(norm), age = (t: string) => { const i = lines.indexOf(norm(t)); return i < 0 ? Infinity : i; };
  return facts.map((f, i) => ({ f, i })).toSorted((a, b) => age(b.f.text) - age(a.f.text) || a.i - b.i).map(x => x.f);
}

const base = (text: string) => [...text.normalize("NFC").replace(/\p{M}/gu, "").replace(/\s+/g, "")].length;
/** Cards stay readable at ~32 base characters. VoxCPM2 measured 8–10 base characters a second, and the
 * renderer can speed narration up by at most 12%, so ~72 characters is what reliably fits 7.8 s. */
export const CARD_MAX = 32, SPOKEN_BUDGET = 72, LIST_POINT_MAX = 16;
const fitsCard = (text: string) => base(text) > 0 && base(text) <= CARD_MAX;
const norm = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();

/** Short label for a topic or product name, cut at a word boundary. */
export function shortLabel(text: string, max = 14) {
  // Whole phrases first (names are usually "type brand size"), so a label never ends mid-compound.
  const phrases = norm(text).split(" ");
  let joined = "";
  for (const p of phrases) { const next = joined ? `${joined} ${p}` : p; if (base(next) > max) break; joined = next; }
  if (joined) return joined;
  const words = [...new Intl.Segmenter("th", { granularity: "word" }).segment(norm(text))].map(s => s.segment);
  let out = "";
  for (const w of words) { if (base(out + w) > max) break; out += w; }
  return out.trim() || null;
}
const seeded = (seed: string, n: number) => n ? createHash("sha256").update(seed).digest()[0] % n : 0;
/** First option the account has not used recently, starting from a seeded position so two
 * accounts with the same facts do not open with the same line. */
function pickFresh(options: string[], used: string[], seed: string) {
  const fitting = options.map(norm).filter(fitsCard);
  if (!fitting.length) return null;
  const start = seeded(seed, fitting.length), recent = new Set(used.map(norm));
  for (let i = 0; i < fitting.length; i++) { const o = fitting[(start + i) % fitting.length]; if (!recent.has(o)) return o; }
  return fitting[start];
}
const spoken = (beats: StoryBeat[]) => beats.reduce((n, b) => n + base(spokenThai(b.text)), 0);
const firstNumber = (text: string) => /[0-9][0-9.,]*\s*(%|°C)?/.exec(text)?.[0].trim() ?? null;

interface GrowthFact { id: string; text: string }
export interface PlannedStory { story: StoryPlan; factIds: string[] }

const FORMAT_RICHNESS: Record<string, number> = { LIST: 3, NUMBER_SPOTLIGHT: 2.5, QUIZ_REVEAL: 2, EXPLAINER: 1 };
const FORMAT_REASON: Record<string, string> = {
  LIST: "มีข้อเท็จจริงสั้นที่ตรวจแล้วอย่างน้อย 3 ข้อ จึงเล่าเป็นลิสต์ได้",
  NUMBER_SPOTLIGHT: "มีตัวเลขในข้อเท็จจริงที่ตรวจแล้ว จึงใช้ตัวเลขเป็นจุดดึงสายตา",
  QUIZ_REVEAL: "ตั้งคำถามให้ผู้ชมทายก่อนเฉลยด้วยข้อเท็จจริงที่ตรวจแล้ว",
  EXPLAINER: "อธิบายเหตุผลด้วยข้อเท็จจริงที่ตรวจแล้วแบบตรงไปตรงมา",
};

/** Growth: choose among formats the evidence supports, preferring ones this account has not used
 * lately, so a run of clips does not repeat the same template. Returns null without facts. */
export function planGrowthStory(topic: string, facts: GrowthFact[], history: StoryHistory, seed: string): PlannedStory | null {
  // Facts are recorded cause first, so a quiz answer and an explanation open with the first fact;
  // freshness only picks which further fact follows it and which number to spotlight.
  const ordered = facts.map(f => ({ ...f, text: norm(f.text) })).filter(f => fitsCard(f.text));
  if (!ordered.length) return null;
  const usable = freshFirst(ordered, history), cause = ordered[0];
  const t = shortLabel(topic) ?? "เรื่องนี้";
  const listPick = usable.filter(f => base(f.text) <= LIST_POINT_MAX).slice(0, 3), listFacts = ordered.filter(f => listPick.includes(f));
  const numeric = usable.find(f => { const n = firstNumber(f.text); return n !== null && base(n) <= 6; });
  const eligible: StoryFormat[] = ["EXPLAINER", "QUIZ_REVEAL", ...(numeric ? ["NUMBER_SPOTLIGHT" as const] : []), ...(listFacts.length === 3 ? ["LIST" as const] : [])];
  // Recency penalty: the most recent format costs the most; anything older than the window is free again.
  const window = history.formats.slice(0, 4);
  const score = (f: StoryFormat) => FORMAT_RICHNESS[f] - (window.includes(f) ? 4 - window.indexOf(f) : 0);
  const ranked = eligible.toSorted((a, b) => score(b) - score(a) || FORMAT_RICHNESS[b] - FORMAT_RICHNESS[a]);
  const ctas = ["ติดตามไว้ มีตอนต่อไป", "เซฟไว้ดูอีกที", "อยากรู้เรื่องไหน คอมเมนต์ไว้"];
  for (const format of ranked) {
    // A list carries three points, so it closes with the shortest call to action.
    const s = `${seed}:${format}`, cta = format === "LIST" ? "เซฟไว้ดูอีกที" : pickFresh(ctas, history.hooks, s) ?? ctas[0];
    let beats: StoryBeat[] | null = null, used: GrowthFact[] = [];
    if (format === "LIST") {
      const hook = pickFresh([`3 เรื่องของ${t}`, `${t} ใน 3 ข้อ`, `รู้ไว้ 3 ข้อ ${t}`], history.hooks, s);
      used = listFacts;
      if (hook) beats = [{ role: "HOOK", text: hook, badge: "3" }, ...listFacts.map((f, i) => ({ role: "POINT" as const, text: f.text, kicker: `ข้อ ${i + 1}` })), { role: "CTA", text: cta }];
    } else if (format === "NUMBER_SPOTLIGHT" && numeric) {
      const n = firstNumber(numeric.text)!;
      const hook = pickFresh([`${n} หมายถึงอะไร?`, `ทำไมต้อง ${n}?`, `${t} กับเลข ${n}`], history.hooks, s);
      used = [numeric];
      if (hook) beats = [{ role: "HOOK", text: hook, badge: n }, { role: "POINT", text: numeric.text, kicker: t }, { role: "CTA", text: cta }];
    } else if (format === "QUIZ_REVEAL") {
      const hook = pickFresh([`ทายก่อนเฉลย: ${t}`, `รู้คำตอบไหม? ${t}`, `ทายดู ${t} เพราะอะไร?`], history.hooks, s);
      used = [cause];
      if (hook) beats = [{ role: "HOOK", text: hook, kicker: "ทายก่อน", badge: "?" }, { role: "POINT", text: cause.text, kicker: "เฉลย" }, { role: "CTA", text: cta }];
    } else {
      const hook = pickFresh([`เคยสงสัยไหม ${t}`, `ความลับของ${t}`, `หลายคนไม่รู้ ${t}`], history.hooks, s);
      used = [cause, ...usable.filter(f => f !== cause && f.id !== cause.id)].slice(0, 2);
      if (hook) beats = [{ role: "HOOK", text: hook, kicker: "รู้หรือไม่" }, ...used.map(f => ({ role: "POINT" as const, text: f.text })), { role: "CTA", text: cta }];
    }
    if (!beats) continue;
    // Drop trailing points until the narration fits; never cut a point mid-sentence.
    while (spoken(beats) > SPOKEN_BUDGET && beats.filter(b => b.role === "POINT").length > 1 && format !== "LIST") {
      const last = beats.map(b => b.role).lastIndexOf("POINT"); beats.splice(last, 1); used = used.slice(0, -1);
    }
    if (spoken(beats) > SPOKEN_BUDGET) continue;
    const recentNote = window.includes(format) ? "รูปแบบนี้เคยใช้ไม่นานมานี้ แต่เป็นตัวเลือกที่หลักฐานรองรับดีที่สุด" : "ยังไม่ได้ใช้รูปแบบนี้ในคลิปล่าสุดของบัญชี";
    return { story: { format, beats, basis: `${STORYTELLER_MODE}: ${FORMAT_REASON[format]}; ${recentNote}` }, factIds: used.map(f => f.id) };
  }
  return null;
}

/** Affiliate: the production method decides what may be claimed; the storyteller only words it.
 * Spoken points come from verified selling points, never from what the footage cannot show. */
export function planProductStory(format: Extract<StoryFormat, "PRODUCT_DETAIL" | "DEMONSTRATION" | "COMPARISON">, productName: string,
  facts: GrowthFact[], history: StoryHistory, seed: string): PlannedStory {
  const n = shortLabel(productName, 18) ?? "ชิ้นนี้", s = `${seed}:${format}`;
  const hooks: Record<typeof format, string[]> = {
    PRODUCT_DETAIL: [`ก่อนซื้อ${n} ดูตรงนี้`, `${n} ดูจุดไหนดี?`, `จุดที่ควรดูของ${n}`],
    DEMONSTRATION: [`ดู${n}ทำงานจริง`, `${n} ใช้งานจริงเป็นแบบนี้`, `จังหวะใช้งานจริงของ${n}`],
    COMPARISON: [`เทียบให้เห็นชัด ๆ`, `${n} ต่างกันตรงไหน?`, `วางเทียบกันแล้วเห็นเลย`] };
  const fallbackPoint: Record<typeof format, string> = { PRODUCT_DETAIL: "ดูรายละเอียดจากภาพสินค้า", DEMONSTRATION: "ดูจังหวะนี้จากวิดีโอจริง", COMPARISON: "ดูความต่างจากวิดีโอเทียบจริง" };
  const hook = pickFresh(hooks[format], history.hooks, s) ?? `ดู${n}`;
  const cta = pickFresh(["ดูรายละเอียดสินค้าก่อนตัดสินใจ", "เช็กรายละเอียดก่อนสั่ง", "อ่านรายละเอียดในหน้าสินค้า"], history.hooks, s) ?? "ดูรายละเอียดสินค้าก่อนตัดสินใจ";
  const points = freshFirst(facts.map(f => ({ ...f, text: norm(f.text) })).filter(f => fitsCard(f.text)), history);
  const beats: StoryBeat[] = [{ role: "HOOK", text: hook }], used: GrowthFact[] = [];
  // A point that does not fit the narration budget is skipped, not the end of the list.
  for (const f of points) { if (used.length === 2) break; if (spoken([...beats, { role: "POINT", text: f.text }, { role: "CTA", text: cta }]) > SPOKEN_BUDGET) continue; beats.push({ role: "POINT", text: f.text }); used.push(f); }
  if (!used.length) beats.push({ role: "POINT", text: fallbackPoint[format] });
  beats.push({ role: "CTA", text: cta });
  return { story: { format, beats, basis: `${STORYTELLER_MODE}: ${used.length ? "พูดจุดขายจากข้อเท็จจริงที่ตรวจแล้ว" : "ไม่มีจุดขายที่ตรวจแล้วสั้นพอ จึงพูดเฉพาะสิ่งที่เห็นในภาพ"}` }, factIds: used.map(f => f.id) };
}

/** Hashtags from the topic or product and the story format. Account-level tags are added when the
 * clip enters the content bank, where the account's own categories are known. */
export function storyHashtags(format: StoryFormat, subject: string, commerce: boolean) {
  const subjectTag = `#${(shortLabel(subject, 18) ?? "").replace(/[^\p{L}\p{N}\p{M}]/gu, "")}`;
  const formatTags: Record<StoryFormat, string[]> = { EXPLAINER: ["#รู้หรือไม่", "#สาระน่ารู้"], QUIZ_REVEAL: ["#ทายดู", "#สาระน่ารู้"],
    LIST: ["#รู้ไว้ใช่ว่า", "#สาระน่ารู้"], NUMBER_SPOTLIGHT: ["#ตัวเลขน่ารู้", "#สาระน่ารู้"], PRODUCT_DETAIL: ["#ของมันต้องดู"],
    DEMONSTRATION: ["#ใช้งานจริง"], COMPARISON: ["#เทียบให้ดู"] };
  return [...new Set([...(subjectTag.length > 2 ? [subjectTag] : []), ...formatTags[format], ...(commerce ? ["#TikTokShop"] : [])])].slice(0, 5);
}
