import type {VariationPlan,VideoRenderInput} from "./types";

export const COMMERCE_TEMPLATES=["PRICE_SHOCK","PROMOTION","PROBLEM_SOLUTION","MUST_HAVE","REVIEW_DISCOVERY","DEMONSTRATION","COMPARISON","POV"] as const;
export function templateFor(angleType:string){return COMMERCE_TEMPLATES.includes(angleType as typeof COMMERCE_TEMPLATES[number])?angleType:"DEMONSTRATION"}
const motions:VariationPlan["motionPattern"][]=["ZOOM_IN","PAN_LEFT","ZOOM_OUT","PAN_RIGHT","STATIC"];
const positions:VariationPlan["overlayPosition"][]=["TOP","CENTER","BOTTOM"];
const backgrounds:VariationPlan["background"][]=["LIGHT","DARK","ACCENT"];
export function variationPlan(index:number,base:VideoRenderInput):VariationPlan {
  const variant=index%3;
  return {
    variationIndex:index,
    variationType:index===1?"HOOK":index===2?"MOTION":"COMPOSITE",
    hook:variant===1?`${base.hook} — ดูให้จบ`:variant===2?`8 วิ: ${base.hook}`:base.hook,
    cta:variant===0?`${base.cta} ตอนนี้`:base.cta,
    overlayPosition:positions[index%positions.length],
    motionPattern:motions[index%motions.length],
    transition:index%2?"CUT":"CROSSFADE",
    background:backgrounds[index%backgrounds.length],
    speed:index%2?1:1.02,
  };
}
