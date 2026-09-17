import type {RenderedVideo} from "../video/types";
import type {BenchmarkSample,CandidateRanking,HumanScores,TechnicalEvaluation} from "./types";

const within=(value:number,target:number,tolerance:number)=>Math.abs(value-target)<=tolerance;
export function evaluateTechnical(media:RenderedVideo):TechnicalEvaluation {
  const checks={duration:within(media.duration,8,.12),portrait:within(media.width/media.height,9/16,.015),resolution:media.width>=540&&media.height>=960,videoCodec:media.videoCodec==="h264",nonEmpty:media.sizeBytes>20_000};
  const score=Object.values(checks).filter(Boolean).length*20;
  return {passed:score===100,score,checks,media};
}
export function scoreHuman(input:HumanScores){
  for(const value of Object.values(input))if(!Number.isFinite(value)||value<0||value>100)throw new Error("Human rubric values must be between 0 and 100");
  return Number((.25*input.productIdentity+.20*input.motionRealism+.15*input.promptAdherence+.15*input.commerceClarity+.15*input.artifactControl+.10*input.visualPolish).toFixed(2));
}
export function applyHumanScores(samples:BenchmarkSample[],scores:Record<string,HumanScores>){return samples.map(sample=>{const human=scores[sample.id];return human?{...sample,human,humanScore:scoreHuman(human)}:sample})}
export function rankCandidates(samples:BenchmarkSample[]):CandidateRanking[]{
  const ids=[...new Set(samples.map(sample=>sample.candidateId))];
  return ids.map(candidateId=>{
    const rows=samples.filter(sample=>sample.candidateId===candidateId),completed=rows.filter(row=>row.status==="COMPLETED"),technicalPass=completed.filter(row=>row.technical?.passed),reviewed=technicalPass.filter(row=>row.humanScore!==null),scores=reviewed.map(row=>row.humanScore as number),totalCostUsd=Number(rows.reduce((sum,row)=>sum+(row.actualCostUsd??0),0).toFixed(4));
    const passRate=rows.length?technicalPass.length/rows.length:0,average=scores.length?Number((scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2)):null,minimum=scores.length?Math.min(...scores):null,effective=reviewed.length?Number((totalCostUsd/reviewed.length).toFixed(4)):null;
    return {candidateId,attempted:rows.length,completed:completed.length,technicalPassRate:Number(passRate.toFixed(4)),reviewed:reviewed.length,averageHumanScore:average,minimumHumanScore:minimum,totalCostUsd,effectiveCostPerPassUsd:effective,eligible:rows.length>0&&passRate>=.8&&reviewed.length===technicalPass.length&&reviewed.length>0&&(average??0)>=85&&(minimum??0)>=80};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(a.effectiveCostPerPassUsd??Infinity)-(b.effectiveCostPerPassUsd??Infinity)||(b.averageHumanScore??0)-(a.averageHumanScore??0));
}
export function chooseWinner(ranking:CandidateRanking[]){const winner=ranking.find(row=>row.eligible);return winner?{winner:winner.candidateId,reason:`Lowest effective cost among candidates with >=80% technical pass rate, complete human review, average visual score >=85, and no fixture below 80: $${winner.effectiveCostPerPassUsd?.toFixed(4)} per reviewed pass.`}:{winner:null,reason:"No provider has complete real outputs and human review that meets the Flow-quality gate."}}
