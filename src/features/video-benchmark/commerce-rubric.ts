import {benchmarkLiability} from "./journal";
import {FAL_PRODUCTION_CANDIDATES} from "./catalog";
import type {BenchmarkModel,BenchmarkSample} from "./types";

/** Commercial assessment is independent of the owner's separate Flow comparison; it never assigns a Flow label. */
export interface CommerceScores {
  productIdentity:number;packagingFidelity:number;motion:number;anatomy:number|null;
  temporalConsistency:number;commercialAppeal:number;composition:number;
  notes:string[];reviewedBy:"CODEX_VISUAL_REVIEW"|"OWNER";
}
export function evaluateCommerce(input:CommerceScores){
  const values=[input.productIdentity,input.packagingFidelity,input.motion,input.temporalConsistency,input.commercialAppeal,input.composition,...(input.anatomy===null?[]:[input.anatomy])];
  if(values.some(value=>!Number.isFinite(value)||value<0||value>100))throw new Error("Commerce scores must be between 0 and 100");
  const score=Number((.30*input.productIdentity+.20*input.packagingFidelity+.15*input.motion+.15*input.temporalConsistency+.10*input.commercialAppeal+.10*input.composition).toFixed(2));
  return{score,passed:score>=85&&input.productIdentity>=90&&input.packagingFidelity>=85&&input.temporalConsistency>=85&&(input.anatomy===null||input.anatomy>=85)};
}
export function rankCommerceCandidates(samples:BenchmarkSample[],reviews:Record<string,CommerceScores>){
  return [...new Set(samples.map(row=>row.candidateId))].map(candidateId=>{
    const rows=samples.filter(row=>row.candidateId===candidateId),attempted=rows.filter(row=>row.generationCount>0);
    const completed=attempted.filter(row=>row.status==="COMPLETED"),usable=completed.filter(row=>row.technical?.passed&&reviews[row.id]&&evaluateCommerce(reviews[row.id]).passed);
    const totalCostUsd=attempted.reduce((sum,row)=>sum+benchmarkLiability(row),0);
    const eligible=FAL_PRODUCTION_CANDIDATES.includes(candidateId)&&attempted.length>0&&attempted.every(row=>row.sourceKind==="PROVIDER_API")&&usable.length===attempted.length&&completed.length===attempted.length;
    return{candidateId,attempted:attempted.length,completed:completed.length,usable:usable.length,totalCostUsd,usableCostUsd:usable.length?totalCostUsd/usable.length:null,successRate:attempted.length?completed.length/attempted.length:null,usableRate:attempted.length?usable.length/attempted.length:null,
      averageLatencyMs:completed.every(row=>row.latencyMs!==null)&&completed.length?completed.reduce((sum,row)=>sum+row.latencyMs!,0)/completed.length:null,eligible};
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(a.usableCostUsd??Infinity)-(b.usableCostUsd??Infinity)||(a.averageLatencyMs??Infinity)-(b.averageLatencyMs??Infinity));
}
export function chooseCommerceStrategy(samples:BenchmarkSample[],reviews:Record<string,CommerceScores>){
  const ranking=rankCommerceCandidates(samples,reviews),passed=ranking.filter(row=>row.eligible);
  return{primary:passed[0]?.candidateId??null as BenchmarkModel|null,fallback:passed[1]?.candidateId??null as BenchmarkModel|null,premium:null,ranking,
    status:passed.length?"BENCHMARK_PASS_PENDING_OWNER_REVIEW":"BENCHMARK_REQUIRED",reason:passed.length?"Lowest all-attempt cost per technically and commercially usable clip; observed samples only, no Flow equivalence or production approval implied.":"Real outputs and commercial quality review are still required."};
}
