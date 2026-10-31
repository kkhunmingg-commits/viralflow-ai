/** Hybrid Creative Brain: the local language model proposes several ideas, every idea goes through the same
 * evidence and quality gates, and the best one that passed is produced. When none passed (or the model failed),
 * the rule-based storyteller's plan is used instead. Which system's plan was used is always recorded. */
import { noveltyScore, type CopyHistory } from "./copy-quality";
import { strategyFingerprint, type CreativeStrategyPlan } from "./strategist";

export const HYBRID_CREATIVE_VERSION = "HYBRID_LOCAL_LLM_RULE_FALLBACK_V1";
export type HybridSource = "AI_OWN_PICK" | "AI_RANKED" | "RULE_FALLBACK";
export interface HybridChoice {
  source: HybridSource; plan: CreativeStrategyPlan; aiProposed: number; aiPassed: number;
  ranking: Array<{ id: string; score: number; reasons: string[] }>; fallbackReason: string | null;
}
interface AiIdea { id: string; topic: string }

/** Passing AI ideas, best first: an untold topic, a fresh format, then the model's own preference. */
export function rankPassingIdeas(plan: CreativeStrategyPlan, ideas: AiIdea[], history: CopyHistory) {
  return plan.concepts.filter(c => c.status === "REVIEW_REQUIRED" && c.production.ready).map(c => {
    const { score, reasons } = noveltyScore({ topic: ideas.find(i => i.id === c.id)?.topic ?? null, format: c.production.story?.format ?? null,
      modelPick: c.id === plan.selectedConceptId }, history);
    return { id: c.id, score, reasons };
  }).sort((a, b) => b.score - a.score);
}

export function chooseHybrid(ai: { plan: CreativeStrategyPlan; ideas: AiIdea[] } | null, aiError: string | null,
  rule: CreativeStrategyPlan, history: CopyHistory): HybridChoice {
  const ranking = ai ? rankPassingIdeas(ai.plan, ai.ideas, history) : [];
  const aiProposed = ai?.plan.concepts.length ?? 0;
  if (ai && ranking.length) {
    const best = ranking[0], own = best.id === ai.plan.selectedConceptId;
    const topic = ai.ideas.find(i => i.id === best.id)?.topic ?? ai.plan.topic;
    const concepts = ai.plan.concepts.map(c => c.id === best.id && !own ? { ...c, reasons: [...c.reasons, `ระบบเลือกไอเดียนี้ของ AI เพราะ${best.reasons.join(" ")}`] } : c);
    const plan: CreativeStrategyPlan = { ...ai.plan, concepts, selectedConceptId: best.id, topic,
      warnings: [...ai.plan.warnings, own ? "ใช้ไอเดียที่ AI เลือกเองและผ่านการตรวจ" : "ไอเดียอันดับแรกของ AI ไม่ใช่ตัวที่ดีที่สุดที่ผ่านการตรวจ ระบบจึงเลือกไอเดียอื่นของ AI แทน"] };
    plan.fingerprint = strategyFingerprint(plan);
    return { source: own ? "AI_OWN_PICK" : "AI_RANKED", plan, aiProposed, aiPassed: ranking.length, ranking, fallbackReason: null };
  }
  const fallbackReason = aiError ? `AI ทำงานไม่สำเร็จ (${aiError})` : "ไม่มีไอเดียของ AI ที่ผ่านการตรวจ";
  const plan: CreativeStrategyPlan = { ...rule, warnings: [...rule.warnings, `ใช้แผนจากระบบ Rule-Based สำรอง เพราะ${fallbackReason}`] };
  return { source: "RULE_FALLBACK", plan, aiProposed, aiPassed: 0, ranking, fallbackReason };
}
