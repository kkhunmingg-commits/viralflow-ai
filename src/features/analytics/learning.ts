import { createHash } from "node:crypto";
import type { ExperimentVariant, WinnerResult } from "./types";

export function boundedAdjustment(effect:number,confidence:number,decay:number){return Math.max(-.25,Math.min(.25,effect*Math.min(1,confidence)*Math.min(1,decay)*.2));}
export function decayedSignal(effect:number,ageDays:number,halfLifeDays=14){return effect*Math.pow(.5,Math.max(0,ageDays)/halfLifeDays);}
export function combineAccountSignals(signals:Array<{effect:number;confidence:number;decay:number;sampleSize:number}>){
  const weighted=signals.map(s=>({...s,w:s.confidence*s.decay*Math.min(1,Math.sqrt(s.sampleSize/20))}));
  const total=weighted.reduce((sum,s)=>sum+s.w,0); return total?Math.max(-1,Math.min(1,weighted.reduce((sum,s)=>sum+s.effect*s.w,0)/total)):0;
}
export function proposeControlledVariation(input:{ownerId:string;accountId:string;videoId:string;result:WinnerResult;axis:ExperimentVariant["axis"];controlValue:string;variantValue:string}):ExperimentVariant|null{
  if(input.result.decision!=="SCALE"||input.result.confidence<.45||input.controlValue===input.variantValue)return null;
  const idempotencyKey=createHash("sha256").update([input.ownerId,input.accountId,input.videoId,input.axis,input.variantValue].join(":" )).digest("hex");
  return{axis:input.axis,controlValue:input.controlValue,variantValue:input.variantValue,originalityRequired:true,idempotencyKey};
}
export function learningDecision(score:WinnerResult){return score.decision==="SCALE"?"BOOST":score.decision==="STOP"?"SUPPRESS":score.decision==="WATCH"?"PRESERVE":"PRESERVE";}
