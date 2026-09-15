import type { CreativeContext, ScoredConcept } from "./types";
import type { CreativeConcept } from "./schemas";
import { evaluateCreativeRisk } from "./risk";
const clamp=(n:number)=>Math.min(100,Math.max(0,n));
const words=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim().split(/\s+/).filter(Boolean);
export function conceptSimilarity(a:CreativeConcept,b:CreativeConcept) {
  const left=new Set(words([a.angleType,a.hook,a.cta,...a.scenePlan.map(s=>s.visual)].join(" ")));
  const right=new Set(words([b.angleType,b.hook,b.cta,...b.scenePlan.map(s=>s.visual)].join(" ")));
  const intersection=[...left].filter(x=>right.has(x)).length,union=new Set([...left,...right]).size;
  return union?intersection/union:1;
}
export function validateDiversity(concepts:CreativeConcept[]) {
  const pairs=concepts.flatMap((a,i)=>concepts.slice(i+1).map(b=>conceptSimilarity(a,b)));
  const angleCount=new Set(concepts.map(c=>c.angleType)).size;
  const hookCount=new Set(concepts.map(c=>c.hook.toLowerCase())).size;
  const ctaCount=new Set(concepts.map(c=>c.cta.toLowerCase())).size;
  const sceneCount=new Set(concepts.map(c=>c.scenePlan.map(s=>s.visual).join("|").toLowerCase())).size;
  return {valid:Math.max(...pairs,0)<.72&&angleCount>=3&&hookCount>=4&&ctaCount>=3&&sceneCount>=4,maxSimilarity:Math.max(...pairs,0),angleCount,hookCount,ctaCount,sceneCount};
}
export function scoreCreativeConcept(concept:CreativeConcept,context:CreativeContext,others:CreativeConcept[]=[]):ScoredConcept {
  const risk=evaluateCreativeRisk(concept,JSON.stringify(context));
  const growthCta=/ติดตาม|เซฟ|คอมเมนต์|ดูอีก/i.test(concept.cta);
  const affiliateCta=/ตะกร้า|กดดู|เช็กราคา|สั่ง/i.test(concept.cta);
  const modeFit=context.account.mode==="GROWTH"?(growthCta?100:55):(affiliateCta?100:50);
  const clarity=concept.coreMessage.length<=120?100:70;
  const timing=concept.scenePlan[0].start===0&&concept.scenePlan.at(-1)?.end===8?100:0;
  const duplicate=others.length?Math.max(...others.map(o=>conceptSimilarity(concept,o))):0;
  const ruleScore=.20*concept.modelSignals.hookStrength+.20*modeFit+.15*context.signals.accountProductFit+.10*(context.account.mode==="GROWTH"?context.category.momentum:context.category.commercialOpportunity)+.10*clarity+.10*timing+.08*concept.modelSignals.visualFeasibility+.07*(context.account.mode==="GROWTH"?(growthCta?100:60):(affiliateCta?100:40));
  const penalty=(risk.status==="REJECT"?100:risk.status==="REVIEW"?20:0)+Math.max(0,duplicate-.45)*60;
  const score=Math.round(clamp(ruleScore-penalty)*10000)/10000;
  return {concept,score,confidence:Math.round(100*Math.sqrt(context.signals.productConfidence*context.signals.categoryConfidence))/100,riskStatus:risk.status,riskReasons:risk.reasons,explanation:{modeFit,clarity,timing,duplicationRisk:Math.round(duplicate*100),policyPenalty:penalty,scoreVersion:"creative-concept-v1"}};
}

