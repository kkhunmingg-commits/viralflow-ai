/** Compiles a provider-neutral storyboard into Google Flow requests. Only scenes the storyboard marks as
 * AI_SCENE are sent to Flow, and only as context or atmosphere: the product, its logo, model, colours,
 * packaging and mechanism are never generated. Real product pixels are added by the local editor.
 * Compiling spends nothing; each request still needs the owner's explicit credit approval. */
import type { Storyboard, StoryboardScene } from "../creative/storyboard";

export const FLOW_PROMPT_COMPILER_VERSION = "flow-prompt-compiler-v1";
export interface FlowPromptSections {
  scene: string; composition: string; cinematography: string; lighting: string; motion: string; framing: string;
  atmosphere: string; narration: string; timing: string; referenceMedia: string; negative: string[];
}
export interface FlowSceneRequest {
  sceneId: string; role: StoryboardScene["role"]; useSeconds: { start: number; end: number };
  settings: { aspect: "9:16"; durationSeconds: 8; resolution: "720p"; outputs: 1 };
  sections: FlowPromptSections; prompt: string;
}
export interface FlowGenerationPlan {
  version: string; storyboardConcept: string; requests: FlowSceneRequest[]; generations: number;
  /** Observed price at the last inspection, if supplied; Flow pricing is not a guaranteed constant. */
  estimatedCredits: number | null; withinBudget: boolean; requiresOwnerApproval: true;
  localOnlyScenes: string[]; notes: string[];
}

const NEVER_GENERATE = ["the product itself or any look-alike", "logos, brand names, model numbers or readable text", "watch faces, digits, dials, screens or packaging",
  "hands or people using, wearing or holding a product", "a demonstration of any product mechanism", "price tags, ratings, reviews or testimonial captions"];
const MOTION: Record<StoryboardScene["camera"], string> = {
  AI_DOLLY: "slow forward dolly, steady and smooth", STATIC_TYPE: "locked-off camera with subtle parallax", SLOW_PUSH: "slow push-in",
  RISE_REVEAL: "gentle crane-up", MACRO_PAN: "slow lateral macro slide", LIGHT_SWEEP: "static camera while a soft light band sweeps across", PULL_BACK: "slow pull-back",
};

export function compileFlowScene(board: Storyboard, scene: StoryboardScene, productTitle: string): FlowSceneRequest {
  if (scene.background.kind !== "AI_SCENE") throw new Error("FLOW_SCENE_NOT_AI");
  if (scene.product && scene.layout === "CONTEXT_FULL") throw new Error("FLOW_SCENE_CONTAINS_PRODUCT");
  const seconds = scene.end - scene.start, palette = scene.palette.join(", ");
  const sections: FlowPromptSections = {
    scene: `Context scene for a ${board.format.toLowerCase().replace(/_/g, " ")} advert: ${scene.background.brief}. It sets up the viewer's everyday situation; it does not show any product.`,
    composition: "Vertical 9:16. Keep the top 12% and bottom 25% visually quiet for captions and app UI. Strong single focal area in the middle third.",
    cinematography: "Natural, believable live-action look, shallow depth of field, 24 fps, no fisheye, no text overlays.",
    lighting: scene.lighting, motion: MOTION[scene.camera], framing: "Medium-wide establishing framing that reads instantly on a phone.",
    atmosphere: `Colour palette ${palette}; mood matches the advert's tone; clean and uncluttered.`,
    narration: board.audioPlan === "FLOW_NARRATION" && scene.narration ? `A clear, natural Thai narrator says exactly: ${JSON.stringify(scene.narration)} — no extra words, do not translate.` : "No speech. Quiet ambient sound only; the editor adds music and captions.",
    timing: `Exactly 8 seconds; the editor uses about ${seconds.toFixed(1)} seconds from the most stable section. Avoid hard cuts inside the clip.`,
    referenceMedia: "No product reference image is supplied on purpose: the real product photograph is composited later by the editor.",
    negative: [...NEVER_GENERATE, `anything resembling "${productTitle}"`],
  };
  const prompt = [`Create exactly 8 seconds of vertical 9:16 video at 720p.`, `SCENE: ${sections.scene}`, `COMPOSITION: ${sections.composition}`, `CINEMATOGRAPHY: ${sections.cinematography}`,
    `LIGHTING: ${sections.lighting}`, `MOTION: ${sections.motion}`, `FRAMING: ${sections.framing}`, `ATMOSPHERE: ${sections.atmosphere}`, `AUDIO: ${sections.narration}`,
    `TIMING: ${sections.timing}`, `REFERENCE: ${sections.referenceMedia}`, `DO NOT SHOW: ${sections.negative.join("; ")}.`].join("\n");
  return { sceneId: scene.id, role: scene.role, useSeconds: { start: scene.start, end: scene.end }, settings: { aspect: "9:16", durationSeconds: 8, resolution: "720p", outputs: 1 }, sections, prompt };
}

export function compileFlowPlan(board: Storyboard, productTitle: string, budget: { maxGenerations: number; observedCreditsPerGeneration: number | null }): FlowGenerationPlan {
  const ai = board.scenes.filter(s => s.background.kind === "AI_SCENE");
  const requests = ai.map(s => compileFlowScene(board, s, productTitle));
  const credits = budget.observedCreditsPerGeneration === null ? null : requests.length * budget.observedCreditsPerGeneration;
  return { version: FLOW_PROMPT_COMPILER_VERSION, storyboardConcept: board.conceptId, requests, generations: requests.length, estimatedCredits: credits,
    withinBudget: requests.length <= budget.maxGenerations, requiresOwnerApproval: true, localOnlyScenes: board.scenes.filter(s => s.background.kind !== "AI_SCENE").map(s => s.id),
    notes: [requests.length ? `ส่ง Flow เฉพาะฉากบริบท ${requests.length} ฉาก; ฉากสินค้าทั้งหมดใช้ภาพจริงและตัดต่อในเครื่อง` : "ไม่ต้องใช้ Flow: ทุกฉากสร้างจากภาพจริงและกราฟิกในเครื่อง (0 เครดิต)",
      "ห้ามกด Generate โดยไม่ได้รับอนุมัติเครดิตจากเจ้าของ และห้าม Generate ซ้ำงานที่ส่งไปแล้ว"] };
}
