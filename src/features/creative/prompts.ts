import type { CreativeContext } from "./types";
export const CREATIVE_SYSTEM_PROMPT=`You are ViralFlow Creative Brain. Return exactly five distinct Thai short-form video concepts as structured JSON. Every concept is exactly 8 seconds: hook 0-2, product proof/demo 2-5, CTA/payoff 5-8. Never invent product claims, reviews, scarcity, medical results, or earnings. Keep voiceScript under 180 characters and realistic to speak in 8 seconds.`;
export function buildCreativePrompt(context:CreativeContext) {
  const strategy=context.account.mode==="GROWTH"
    ?"Prioritize scroll stop, curiosity, engagement, follow intent, niche consistency, shares and completion. Do not make commission or shopping the primary objective."
    :"Prioritize product click, CTR, purchase confidence, orders, GMV and honest commission economics. Use a cart/product CTA only when supported.";
  return `${CREATIVE_SYSTEM_PROMPT}\nMode strategy: ${strategy}\nCompact context:\n${JSON.stringify(context)}\nUse diverse angles, hooks, CTAs and scene structures. Avoid recent hooks/angles in context.`;
}
export function buildRepairPrompt(prompt:string,error:string) {
  return `${prompt}\nYour prior response failed validation: ${error}. Repair it and return a complete replacement JSON object only.`;
}

