import {ORIGINALITY_VERSION,type OriginalityMetadata,type OriginalityResult,type OriginalityStatus} from "./types";

function canonicalize(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonicalize(item)]));
  return value;
}
const normalized=(v:unknown)=>JSON.stringify(canonicalize(v)).toLowerCase().replace(/\s+/g," ");
function tokenSimilarity(a:unknown,b:unknown){const x=new Set(normalized(a).split(/[^\p{L}\p{N}]+/u).filter(Boolean)),y=new Set(normalized(b).split(/[^\p{L}\p{N}]+/u).filter(Boolean));if(!x.size&&!y.size)return 1;const common=[...x].filter(t=>y.has(t)).length;return common/Math.max(1,new Set([...x,...y]).size)}
const round=(n:number)=>Number(n.toFixed(4));
function pair(a:OriginalityMetadata,b:OriginalityMetadata){
  const hook=tokenSimilarity(a.hook,b.hook),scene=tokenSimilarity(a.scenes,b.scenes),audio=tokenSimilarity(a.audio,b.audio),cta=tokenSimilarity(a.cta,b.cta);
  const lineage=(a.masterId===b.masterId?0.2:0)+(a.productId===b.productId?0.05:0)+(a.creativeProjectId===b.creativeProjectId?0.05:0);
  return {hook,scene,audio,overall:Math.min(1,.3*hook+.3*scene+.15*audio+.05*cta+lineage)};
}
export function checkCrossAccountDuplication(candidate:OriginalityMetadata,history:OriginalityMetadata[]){return history.filter(h=>h.accountId!==candidate.accountId).map(h=>({videoId:h.videoId,...pair(candidate,h)})).sort((a,b)=>b.overall-a.overall)}
export function calculateOriginality(candidate:OriginalityMetadata,history:OriginalityMetadata[]):OriginalityResult {
  const compared=history.filter(h=>h.videoId!==candidate.videoId).map(h=>({videoId:h.videoId,same:h.accountId===candidate.accountId,...pair(candidate,h)}));
  const same=compared.filter(x=>x.same).sort((a,b)=>b.overall-a.overall)[0],cross=compared.filter(x=>!x.same).sort((a,b)=>b.overall-a.overall)[0],top=[...compared].sort((a,b)=>b.overall-a.overall)[0];
  const sameScore=same?.overall??0,crossScore=cross?.overall??0,overall=Math.max(sameScore,crossScore),status:OriginalityStatus=overall>=.95?"REJECT":overall>=.82?"TOO_SIMILAR":overall>=.58?"ACCEPTABLE_VARIATION":"ORIGINAL";
  return {sameAccountSimilarity:round(sameScore),crossAccountSimilarity:round(crossScore),hookSimilarity:round(top?.hook??0),sceneSimilarity:round(top?.scene??0),audioSimilarity:round(top?.audio??0),overallSimilarity:round(overall),status,matchedVideoIds:compared.filter(x=>x.overall>=.58).map(x=>x.videoId),version:ORIGINALITY_VERSION};
}
