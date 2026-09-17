import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {FFmpegVideoRenderer} from "../video/renderer";
import {forecastCost} from "./catalog";
import {chooseWinner,evaluateTechnical,rankCandidates} from "./rubric";
import {ProviderGenerationError,RunwayBenchmarkProvider} from "./runway-provider";
import {VIDEO_PROVIDER_BENCHMARK_VERSION,type BenchmarkCandidate,type BenchmarkFixture,type BenchmarkReport,type BenchmarkSample} from "./types";

export interface RunBenchmarkInput {candidates:BenchmarkCandidate[];fixtures:BenchmarkFixture[];repeats:number;execute:boolean;budgetCapUsd:number;apiKey?:string;outputDir:string;resumeSamples?:BenchmarkSample[]}
const safeError=(error:unknown)=>error instanceof Error?error.message.slice(0,500):"Benchmark failed";
export async function runVideoProviderBenchmark(input:RunBenchmarkInput):Promise<BenchmarkReport>{
  if(input.repeats<1||input.repeats>5)throw new Error("Benchmark repeats must be between 1 and 5");if(!input.fixtures.length)throw new Error("At least one fixture is required");
  const forecast=forecastCost(input.candidates,input.fixtures.length,input.repeats);if(input.execute&&forecast>input.budgetCapUsd)throw new Error(`Forecast $${forecast.toFixed(2)} exceeds benchmark cap $${input.budgetCapUsd.toFixed(2)}`);if(input.execute&&!input.apiKey)throw new Error("RUNWAYML_API_SECRET is unavailable");
  await mkdir(input.outputDir,{recursive:true});const samples:BenchmarkSample[]=[],previous=new Map((input.resumeSamples??[]).map(sample=>[sample.id,sample])),spentBefore=(input.resumeSamples??[]).reduce((sum,sample)=>sum+(sample.actualCostUsd??0),0);let spent=spentBefore;
  for(const candidate of input.candidates)for(const fixture of input.fixtures)for(let repeat=1;repeat<=input.repeats;repeat++){
    const id=`${candidate.id}:${fixture.id}:${repeat}`,prior=previous.get(id);if(prior?.status==="COMPLETED"){samples.push(prior);continue}const seed=1000+repeat,sample:BenchmarkSample={id,fixtureId:fixture.id,candidateId:candidate.id,repeat,seed,expectedCostUsd:candidate.expectedCostUsd,actualCostUsd:null,latencyMs:null,taskId:null,outputPath:null,technical:null,human:null,humanScore:null,status:"PLANNED",error:null};samples.push(sample);if(!input.execute)continue;
    if(spent+candidate.expectedCostUsd>input.budgetCapUsd){sample.status="FAILED";sample.error="Hard benchmark budget cap reached";continue}
    try{const outputPath=join(input.outputDir,`${candidate.id}-${fixture.id}-${repeat}.mp4`),provider=new RunwayBenchmarkProvider(candidate,input.apiKey as string),result=await provider.generate({fixture,candidate,seed,outputPath});spent+=result.costUsd;sample.actualCostUsd=result.costUsd;sample.latencyMs=result.latencyMs;sample.taskId=result.taskId;sample.outputPath=outputPath;sample.technical=evaluateTechnical(await new FFmpegVideoRenderer().probe(outputPath));sample.status="COMPLETED"}catch(error){if(error instanceof ProviderGenerationError){spent+=error.costUsd;sample.actualCostUsd=error.costUsd;sample.taskId=error.taskId}sample.status="FAILED";sample.error=safeError(error)}
  }
  const ranking=rankCandidates(samples),choice=chooseWinner(ranking);return {version:VIDEO_PROVIDER_BENCHMARK_VERSION,createdAt:new Date().toISOString(),execute:input.execute,repeats:input.repeats,budgetCapUsd:input.budgetCapUsd,forecastCostUsd:forecast,candidates:input.candidates,samples,ranking,winner:choice.winner,winnerReason:choice.reason};
}
