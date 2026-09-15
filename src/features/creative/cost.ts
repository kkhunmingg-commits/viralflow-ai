const RATES:Record<string,{input:number;output:number}>={"gpt-5.4-nano":{input:.20,output:1.25},"viralflow-deterministic-v1":{input:0,output:0}};
export function estimateCreativeGenerationCost(model:string,inputTokens:number,outputTokens:number){
  const rate=RATES[model]??{input:0,output:0};
  return Math.round(((inputTokens/1_000_000)*rate.input+(outputTokens/1_000_000)*rate.output)*1e6)/1e6;
}

