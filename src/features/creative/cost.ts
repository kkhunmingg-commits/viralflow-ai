import {isLocalModel} from "./local-agent";
const RATES:Record<string,{input:number;output:number}>={"gpt-5.4-nano":{input:.20,output:1.25},"viralflow-deterministic-v1":{input:0,output:0}};
/** Unknown pricing cannot authorize a new real LLM call or masquerade as free. */
export function knownCreativeGenerationCost(model:string,inputTokens:number,outputTokens:number):number|null{
  // A model on this machine has no per-token bill; its machine time is reported separately, never as zero cost of compute.
  if(isLocalModel(model))return [inputTokens,outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)?0:null;
  if(!RATES[model]||![inputTokens,outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  return estimateCreativeGenerationCost(model,inputTokens,outputTokens);
}
export function estimateCreativeGenerationCost(model:string,inputTokens:number,outputTokens:number){
  const rate=RATES[model]??{input:0,output:0};
  return Math.round(((inputTokens/1_000_000)*rate.input+(outputTokens/1_000_000)*rate.output)*1e6)/1e6;
}

