import {MAX_VARIATION_SIMILARITY,VIDEO_SIMILARITY_VERSION,type SimilarityMetadata} from "./types";

function stable(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${stable(v)}`).join(",")}}`;
  return String(value??"").toLowerCase().replace(/\s+/g," ").trim();
}
function equal(a:unknown,b:unknown){return stable(a)===stable(b)?1:0}
export function videoSimilarity(a:SimilarityMetadata,b:SimilarityMetadata){
  const score=.15*equal(a.masterId,b.masterId)+.2*equal(a.hook,b.hook)+.15*equal(a.cta,b.cta)+.2*equal(a.scenes,b.scenes)+.1*equal(a.motion,b.motion)+.1*equal(a.overlay,b.overlay)+.1*equal(a.audio,b.audio);
  return {score:Number(score.toFixed(4)),version:VIDEO_SIMILARITY_VERSION,accepted:score<MAX_VARIATION_SIMILARITY};
}
