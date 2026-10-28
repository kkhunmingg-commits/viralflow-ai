/** AI Storyboard Director: turns the selected concept into an editable, provider-neutral shot plan.
 * Every scene has a communication job (hook, context, reveal, benefit, detail, hero, CTA). Real product
 * pixels come only from rights-cleared assets; AI may only supply context and atmosphere around them. */
import type { AdConcept, DirectorAsset, DirectorFact, DirectorInput } from "./ad-director";
import type { AdFormat } from "./category-insight";

export const STORYBOARD_VERSION = "storyboard-director-v1";
export type SceneRole = "HOOK" | "CONTEXT" | "REVEAL" | "BENEFIT" | "DETAIL" | "HERO" | "CTA";
export type SceneLayout = "KINETIC_TYPE" | "CONTEXT_FULL" | "PRODUCT_REVEAL" | "CALLOUT_DETAIL" | "SPEC_BADGE" | "CHECKLIST" | "HERO_LIGHT_SWEEP" | "END_CARD";
export type CameraMove = "STATIC_TYPE" | "SLOW_PUSH" | "RISE_REVEAL" | "MACRO_PAN" | "LIGHT_SWEEP" | "PULL_BACK" | "AI_DOLLY";
export type Transition = "CUT" | "WHIP" | "FADE" | "SLIDE_UP" | "ZOOM";
export type SceneBackground = { kind: "AI_SCENE"; brief: string } | { kind: "GRAPHIC"; palette: [string, string] };
export interface StoryboardScene {
  id: string; role: SceneRole; start: number; end: number; layout: SceneLayout; camera: CameraMove;
  shot: string; product: { assetId: string; framing: "FULL" | "DETAIL" } | null; background: SceneBackground;
  lighting: string; palette: [string, string, string]; narration: string;
  onScreen: { headline: string; sub?: string; badge?: string; checklist?: string[] };
  sound: string; transitionIn: Transition; evidenceIds: string[];
}
export type AudioPlan = "FLOW_NARRATION" | "OWNER_VOICE" | "CAPTION_ONLY_WITH_MUSIC";
export interface Storyboard {
  version: string; conceptId: string; format: AdFormat; angle: string; audience: string; hook: string;
  sellingPoints: Array<{ factId: string; text: string }>; durationSeconds: number; audioPlan: AudioPlan;
  scenes: StoryboardScene[]; cta: string; evidenceIds: string[]; mediaRights: Array<{ assetId: string; credit: string }>;
  disclosure: string; grade: AdConcept["style"]["grade"];
}
export interface StoryboardOptions { durationSeconds?: number; audioPlan?: AudioPlan; maxAiScenes?: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Scene count follows the content: 3 to 4 beats for 8 seconds, more only when there are facts to carry them. */
function middleRoles(format: AdFormat, facts: number, duration: number): SceneRole[] {
  const extra = duration >= 16 ? 2 : duration >= 12 ? 1 : 0;
  const base: Record<AdFormat, SceneRole[]> = {
    LIFESTYLE: ["REVEAL"], PROBLEM_SOLUTION: ["REVEAL", "BENEFIT"], CURIOSITY: ["REVEAL", "BENEFIT"], PRODUCT_DETAIL: ["DETAIL", "BENEFIT"],
    BUYING_GUIDE: ["BENEFIT"], CINEMATIC_HERO: ["DETAIL"], COMPARISON: ["BENEFIT", "DETAIL"], UGC_STORY: ["CONTEXT", "BENEFIT"], ASMR_SENSORY: ["DETAIL", "DETAIL"],
  };
  const roles = [...base[format]];
  for (let i = 0; i < extra; i++) roles.push(i % 2 ? "CONTEXT" : facts > roles.filter(r => r === "BENEFIT").length ? "BENEFIT" : "DETAIL");
  return roles;
}

function timeline(count: number, duration: number) {
  // Hook gets the first ~2 s, the close ~3 s at 8 s; middle beats share the rest.
  const hook = r2(Math.min(2, duration * .25)), close = r2(Math.min(3.5, Math.max(2.5, duration * .3))), mid = (duration - hook - close) / Math.max(1, count - 2);
  const out: Array<{ start: number; end: number }> = []; let t = 0;
  for (let i = 0; i < count; i++) { const len = i === 0 ? hook : i === count - 1 ? duration - t : mid; out.push({ start: r2(t), end: i === count - 1 ? duration : r2(t + len) }); t = r2(t + len); }
  return out;
}

const short = (text: string) => text.length > 24 ? `${text.slice(0, 23)}…` : text;
/** Pulls the first figure+unit out of a fact so it can be a badge ("21 กรัม"); no figure, no badge. */
export const factBadge = (text: string) => /([0-9][0-9.,]*\s*(?:กรัม|g|มม\.?|mm|ซม\.?|cm|มล\.?|ml|ชม\.?|ชั่วโมง|วัน|ปี|%|นิ้ว|W|mAh)?)/i.exec(text)?.[1]?.trim();

export function buildStoryboard(concept: AdConcept, input: Pick<DirectorInput, "product" | "facts" | "assets">, options: StoryboardOptions = {}): Storyboard {
  const duration = options.durationSeconds ?? 8;
  if (duration < 8 || duration > 24) throw new Error("STORYBOARD_DURATION_OUT_OF_RANGE");
  const images = input.assets.filter(a => a.rightsCleared && a.kind !== "LICENSED_AUDIO");
  if (!images.length) throw new Error("STORYBOARD_REQUIRES_CLEARED_PRODUCT_MEDIA");
  const facts = concept.sellingPoints.map(p => input.facts.find(f => f.id === p.factId)).filter((f): f is DirectorFact => Boolean(f));
  const roles: SceneRole[] = ["HOOK", ...middleRoles(concept.format, facts.length, duration), concept.format === "BUYING_GUIDE" || concept.format === "CINEMATIC_HERO" ? "HERO" : "CTA"];
  const times = timeline(roles.length, duration), [c0, c1, c2] = concept.style.palette;
  const hex = (c: string) => `0x${c.replace("#", "")}`;
  let aiLeft = options.maxAiScenes ?? 1, factCursor = 0, assetCursor = 0;
  const asset = () => images[(assetCursor++) % images.length];
  const nextFact = () => facts[(factCursor++) % Math.max(1, facts.length)];
  const contextFormats: AdFormat[] = ["LIFESTYLE", "PROBLEM_SOLUTION", "UGC_STORY"];
  const scenes = roles.map((role, i): StoryboardScene => {
    const { start, end } = times[i], transitionIn: Transition = i === 0 ? "CUT" : (["WHIP", "SLIDE_UP", "ZOOM", "FADE"] as Transition[])[(i - 1) % 4];
    const gfx: SceneBackground = { kind: "GRAPHIC", palette: i % 2 ? [hex(c1), hex(c0)] : [hex(c0), hex(c1)] };
    const common = { id: `s${i + 1}`, role, start, end, lighting: concept.style.lighting, palette: concept.style.palette, transitionIn };
    if (role === "HOOK") {
      const context = contextFormats.includes(concept.format) && aiLeft > 0;
      if (context) aiLeft--;
      if (context || concept.format === "BUYING_GUIDE") return { ...common, layout: context ? "CONTEXT_FULL" : "KINETIC_TYPE", camera: context ? "AI_DOLLY" : "STATIC_TYPE", product: null,
        background: context ? { kind: "AI_SCENE", brief: concept.hook.visual } : gfx, shot: context ? `ฉากบริบท (AI, ไม่มีสินค้า): ${concept.hook.visual}` : "Kinetic typography คำถามเปิด",
        narration: concept.hook.text, onScreen: { headline: concept.hook.text }, sound: "เสียง whoosh เปิด + จังหวะดนตรีเริ่ม", evidenceIds: [] };
      const a = asset();
      return { ...common, layout: "CALLOUT_DETAIL", camera: concept.format === "CINEMATIC_HERO" ? "LIGHT_SWEEP" : "MACRO_PAN", product: { assetId: a.id, framing: "DETAIL" }, background: gfx,
        shot: "เปิดด้วยมาโครรายละเอียดสินค้าจริง ยังไม่เฉลยทั้งชิ้น", narration: concept.hook.text, onScreen: { headline: concept.hook.text }, sound: "hit สั้นตอนตัดเข้า", evidenceIds: [] };
    }
    if (role === "CONTEXT") return { ...common, layout: "KINETIC_TYPE", camera: "STATIC_TYPE", product: null, background: gfx, shot: "การ์ดกราฟิกบริบทการใช้งาน (ไม่จำลองการใช้จริง)",
      narration: concept.insight.replace(/\s*\(HYPOTHESIS\)/, ""), onScreen: { headline: short(concept.audience) }, sound: "ดนตรีต่อเนื่อง", evidenceIds: [] };
    if (role === "REVEAL") { const a = asset(), f = nextFact();
      return { ...common, layout: "PRODUCT_REVEAL", camera: "RISE_REVEAL", product: { assetId: a.id, framing: "FULL" }, background: gfx, shot: "Reveal ภาพสินค้าจริงขึ้นจากล่าง พร้อมเงา",
        narration: f ? `${input.product.title} ${f.text}` : input.product.title, onScreen: { headline: input.product.title, sub: f?.text, badge: f ? factBadge(f.text) : undefined },
        sound: "riser สั้นก่อน reveal", evidenceIds: f ? [f.id] : [] }; }
    if (role === "BENEFIT" || role === "DETAIL") { const a = asset(), f = nextFact(), badge = f ? factBadge(f.text) : undefined;
      if (concept.format === "BUYING_GUIDE") return { ...common, layout: "CHECKLIST", camera: "SLOW_PUSH", product: { assetId: a.id, framing: "FULL" }, background: gfx,
        shot: "เช็กลิสต์ข้อเท็จจริงข้างภาพสินค้าจริง", narration: facts.map(x => x.text).join(" "), onScreen: { headline: "เช็กก่อนซื้อ", checklist: facts.map(x => short(x.text)) },
        sound: "tick ตามแต่ละข้อ", evidenceIds: facts.map(x => x.id) };
      return { ...common, layout: badge && role === "BENEFIT" ? "SPEC_BADGE" : "CALLOUT_DETAIL", camera: role === "DETAIL" ? "MACRO_PAN" : "SLOW_PUSH",
        product: { assetId: a.id, framing: role === "DETAIL" ? "DETAIL" : "FULL" }, background: gfx,
        shot: badge && role === "BENEFIT" ? `ตัวเลขข้อเท็จจริงใหญ่ "${badge}" ข้างภาพสินค้าจริง` : "ซูมรายละเอียดจริงพร้อม callout",
        narration: f?.text ?? input.product.title, onScreen: { headline: f ? short(f.text) : input.product.title, badge: role === "BENEFIT" ? badge : undefined },
        sound: "pop ตอนตัวเลขขึ้น", evidenceIds: f ? [f.id] : [] }; }
    const a = asset();
    return { ...common, layout: role === "HERO" ? "HERO_LIGHT_SWEEP" : "END_CARD", camera: role === "HERO" ? "LIGHT_SWEEP" : "PULL_BACK", product: { assetId: a.id, framing: "FULL" },
      background: { kind: "GRAPHIC", palette: [hex(c0), hex(c2 === "#F5F7FA" || c2 === "#F8FAFC" ? c1 : c2)] }, shot: "Hero shot สินค้าจริง แสงกวาด + ข้อความจำง่าย + CTA",
      narration: concept.cta, onScreen: { headline: input.product.title, sub: concept.cta }, sound: "ดนตรีจบแบบ resolve", evidenceIds: [] };
  });
  const usedAssets = [...new Set(scenes.flatMap(s => s.product ? [s.product.assetId] : []))];
  return { version: STORYBOARD_VERSION, conceptId: concept.id, format: concept.format, angle: concept.angle, audience: concept.audience, hook: concept.hook.text,
    sellingPoints: concept.sellingPoints, durationSeconds: duration, audioPlan: options.audioPlan ?? "CAPTION_ONLY_WITH_MUSIC", scenes, cta: concept.cta,
    evidenceIds: [...new Set(scenes.flatMap(s => s.evidenceIds))],
    mediaRights: usedAssets.map(id => ({ assetId: id, credit: (input.assets.find(a => a.id === id) as DirectorAsset | undefined)?.credit ?? "" })),
    disclosure: scenes.some(s => s.background.kind === "AI_SCENE") ? "ภาพสินค้าจริง · ฉากประกอบบางส่วนสร้างด้วย AI" : "ภาพสินค้าจริง · กราฟิกประกอบ", grade: concept.style.grade };
}

export interface StoryboardIssue { code: string; detail: string }
/** Structural gate before any credit or render time is spent. */
export function validateStoryboard(board: Storyboard, input: Pick<DirectorInput, "facts" | "assets" | "account" | "product">): StoryboardIssue[] {
  const issues: StoryboardIssue[] = [], s = board.scenes;
  if (s.length < 3) issues.push({ code: "TOO_FEW_SCENES", detail: `${s.length} ฉาก (ต้องอย่างน้อย 3)` });
  if (s[0]?.start !== 0 || s.at(-1)?.end !== board.durationSeconds || s.some((x, i) => x.end <= x.start || (i > 0 && Math.abs(s[i - 1].end - x.start) > .01)))
    issues.push({ code: "TIMING_GAP", detail: "ฉากต้องต่อกันตั้งแต่ 0 ถึงจบคลิป" });
  if (s[0] && (s[0].role !== "HOOK" || !s[0].onScreen.headline.trim() || s[0].end > 2.6)) issues.push({ code: "HOOK_MISSING", detail: "ต้องมี Hook ชัดใน 0–2 วินาที" });
  if (new Set(s.map(x => x.layout)).size < Math.min(3, s.length)) issues.push({ code: "NOT_VISUALLY_VARIED", detail: "ต้องมีองค์ประกอบภาพที่ต่างกันอย่างน้อย 3 แบบ ไม่ใช่ซูมภาพเดิมซ้ำ" });
  if (new Set(s.map(x => x.camera)).size < 2) issues.push({ code: "SINGLE_CAMERA_MOVE", detail: "ทุกฉากใช้การเคลื่อนกล้องเดียวกัน" });
  if (!s.some(x => x.product)) issues.push({ code: "NO_REAL_PRODUCT", detail: "ต้องมีฉากภาพสินค้าจริงอย่างน้อย 1 ฉาก" });
  if (!s.some(x => x.role === "BENEFIT" || x.role === "REVEAL" || x.role === "DETAIL")) issues.push({ code: "NO_BENEFIT", detail: "ไม่มีฉากสื่อประโยชน์/รายละเอียด" });
  for (const x of s) {
    if (x.product && !input.assets.some(a => a.id === x.product!.assetId && a.rightsCleared)) issues.push({ code: "ASSET_RIGHTS", detail: `${x.id} ใช้สื่อที่ยังไม่ผ่านสิทธิ์` });
    for (const id of x.evidenceIds) if (!input.facts.some(f => f.id === id)) issues.push({ code: "EVIDENCE_MISSING", detail: `${x.id} อ้างหลักฐาน ${id} ที่ไม่มี` });
    const figures = [x.onScreen.headline, x.onScreen.sub ?? "", x.onScreen.badge ?? "", ...(x.onScreen.checklist ?? [])].join(" ").match(/[0-9][0-9.,]*/g) ?? [];
    const supported = new Set(x.evidenceIds.flatMap(id => input.facts.find(f => f.id === id)?.text.match(/[0-9][0-9.,]*/g) ?? []));
    const title: string[] = `${input.product.title} ${input.product.model ?? ""}`.match(/[0-9][0-9.,]*/g) ?? [];
    for (const n of figures) if (!supported.has(n) && !title.includes(n)) issues.push({ code: "UNSUPPORTED_FIGURE", detail: `${x.id}: ตัวเลข ${n} ไม่มีหลักฐาน` });
    if (x.background.kind === "AI_SCENE" && x.product && x.layout === "CONTEXT_FULL") issues.push({ code: "AI_PRODUCT_SCENE", detail: `${x.id}: ห้ามให้ AI สร้างฉากที่มีตัวสินค้า` });
  }
  if (/ตะกร้า/.test(board.cta) && !(input.account.mode === "AFFILIATE" && input.account.affiliateEligible)) issues.push({ code: "CTA_NOT_ALLOWED", detail: "บัญชีนี้ยังไม่มีสิทธิ์ CTA ตะกร้า" });
  return issues;
}
