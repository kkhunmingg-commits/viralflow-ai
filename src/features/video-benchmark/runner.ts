import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {BenchmarkJournal,benchmarkLiability} from "./journal";
import {forecastCost,minimumForecastCost} from "./catalog";
import {FalWan22TurboProvider,PixVerseProvider,TikTokSymphonyProvider} from "./direct-providers";
import {GoogleVeoBenchmarkProvider} from "./google-veo-provider";
import {chooseWinner,evaluateTechnical,rankCandidates} from "./rubric";
import {ProviderGenerationError,RunwayBenchmarkProvider} from "./runway-provider";
import {normalizeProviderBenchmarkClip} from "./provider-normalization";
import {VIDEO_PROVIDER_BENCHMARK_VERSION,type BenchmarkCandidate,type BenchmarkFixture,type BenchmarkReport,type BenchmarkSample,type RealVideoProvider} from "./types";

export interface RunBenchmarkInput {candidates:BenchmarkCandidate[];fixtures:BenchmarkFixture[];repeats:number;execute:boolean;budgetCapUsd:number;hardMaxUsd?:number;providerKeys?:Partial<Record<"google"|"runway"|"fal"|"pixverse",string>>;pixverseUsdPerCredit?:number;outputDir:string;resumeSamples?:BenchmarkSample[];ownerFlowReferenceProvided:boolean;secondRoundEligibleIds?:string[]}
const safeError=(error:unknown)=>error instanceof Error?error.message.slice(0,500):"Benchmark failed";
function providerFor(candidate:BenchmarkCandidate,input:RunBenchmarkInput):RealVideoProvider{if(candidate.provider==="google_veo")return new GoogleVeoBenchmarkProvider(candidate,input.providerKeys?.google??"");if(candidate.provider==="runway")return new RunwayBenchmarkProvider(candidate,input.providerKeys?.runway??"");if(candidate.provider==="fal")return new FalWan22TurboProvider(candidate,input.providerKeys?.fal??"");if(candidate.provider==="pixverse")return new PixVerseProvider(candidate,input.providerKeys?.pixverse??"",input.pixverseUsdPerCredit);return new TikTokSymphonyProvider(candidate)}
export async function runVideoProviderBenchmark(input:RunBenchmarkInput):Promise<BenchmarkReport>{
  const cap=Math.min(input.budgetCapUsd,input.hardMaxUsd??input.budgetCapUsd);
  if(input.execute&&(!Number.isFinite(cap)||cap<=0))throw new Error("Positive hard benchmark cap required");
  if(!Number.isInteger(input.repeats)||input.repeats<1||input.repeats>5)throw new Error("Benchmark repeats must be between 1 and 5");if(!input.fixtures.length)throw new Error("At least one fixture is required");
  if(new Set(input.fixtures.map(row=>row.id)).size!==input.fixtures.length||new Set(input.candidates.map(row=>row.id)).size!==input.candidates.length)throw new Error("Benchmark fixture and candidate IDs must be unique");
  if(input.candidates.some(row=>!Number.isFinite(row.expectedCostUsd)||row.expectedCostUsd<0))throw new Error("Invalid benchmark cost estimate");
  const baseForecast=forecastCost(input.candidates,input.fixtures.length,1),baseMinimum=minimumForecastCost(input.candidates,input.fixtures.length,1),eligible=new Set(input.secondRoundEligibleIds??[]),extraForecast=input.candidates.reduce((sum,candidate)=>sum+[...eligible].filter(id=>id.startsWith(`${candidate.id}:`)).length*candidate.expectedCostUsd*Math.max(0,input.repeats-1),0),extraMinimum=input.candidates.reduce((sum,candidate)=>sum+[...eligible].filter(id=>id.startsWith(`${candidate.id}:`)).length*candidate.minimumCostUsd*Math.max(0,input.repeats-1),0),forecast=Number((baseForecast+extraForecast).toFixed(4)),minimumForecast=Number((baseMinimum+extraMinimum).toFixed(4));if(input.execute&&forecast>cap)throw new Error(`Forecast ${forecast.toFixed(2)} exceeds benchmark cap ${cap.toFixed(2)}`);
  await mkdir(input.outputDir,{recursive:true});
  const journal=input.execute?await BenchmarkJournal.acquire(input.outputDir,input.resumeSamples):null;
  try{
  const samples:BenchmarkSample[]=[],previous=new Map((journal?.samples??input.resumeSamples??[]).map(sample=>[sample.id,sample])),spentBefore=[...previous.values()].reduce((sum,sample)=>sum+benchmarkLiability(sample),0);let spent=spentBefore,halted=false;
  if(input.execute&&(!Number.isFinite(spent)||spent>cap))throw new Error("Prior benchmark liability exceeds budget");
  for(const candidate of input.candidates)for(const fixture of input.fixtures)for(let repeat=1;repeat<=input.repeats;repeat++){
    const id=`${candidate.id}:${fixture.id}:${repeat}`,prior=previous.get(id);if(prior&&(prior.generationCount>0||prior.status==="COMPLETED"||prior.status==="FAILED")){await journal?.checkInput(id,candidate,fixture,repeat);samples.push(prior);continue}const seed=1000+repeat,sample:BenchmarkSample={id,fixtureId:fixture.id,candidateId:candidate.id,repeat,seed,expectedCostUsd:candidate.expectedCostUsd,actualCostUsd:null,latencyMs:null,taskId:null,inputPath:null,sourcePath:null,outputPath:null,sourceDurationSeconds:null,normalizedDurationSeconds:null,technical:null,human:null,humanScore:null,status:"PLANNED",generationCount:0,quotaUsage:null,humanLaborRequired:false,sourceKind:"PROVIDER_API",error:null};samples.push(sample);if(candidate.availability==="NOT_RUN"){sample.status="NOT_RUN";sample.error=candidate.limitation;continue}if(candidate.availability==="MANUAL_BENCHMARK_ONLY"){sample.status="MANUAL_BENCHMARK_ONLY";sample.humanLaborRequired=true;sample.sourceKind="OWNER_MANUAL_IMPORT";sample.error=candidate.limitation;continue}if(repeat>1&&!input.secondRoundEligibleIds?.includes(`${candidate.id}:${fixture.id}:1`)){sample.status="SKIPPED";sample.error="Second sample requires a passing technical gate, Flow-comparable human status, and remaining budget";continue}if(!input.execute)continue;
    if(halted||spent+candidate.expectedCostUsd>cap){sample.status="SKIPPED";sample.error=halted?"Stopped for uncertain provider liability":"Hard benchmark budget cap reached";continue}
    const provider=providerFor(candidate,input);
    await journal?.checkInput(id,candidate,fixture,repeat);
    sample.generationCount=1;sample.submissionState="ATTEMPT_RESERVED";sample.actualCostUsd=candidate.expectedCostUsd;
    sample.recordedCostUsd=null;sample.costBasis="ESTIMATED";sample.retryCount=0;spent+=candidate.expectedCostUsd;await journal?.save(sample);
    try{
      const sourcePath=join(input.outputDir,`${candidate.id}-${fixture.id}-${repeat}-source.mp4`),normalizedPath=join(input.outputDir,`${candidate.id}-${fixture.id}-${repeat}.mp4`);
      const result=await provider.generate({fixture,candidate,seed,outputPath:sourcePath,onSubmitted:async requestId=>{sample.taskId=requestId;sample.submissionState="SUBMITTED";await journal?.save(sample)}});
      if(!Number.isFinite(result.costUsd)||result.costUsd<0||result.costUsd>candidate.expectedCostUsd+.000001||result.recordedCostUsd!=null&&(!Number.isFinite(result.recordedCostUsd)||result.recordedCostUsd<0||result.recordedCostUsd>candidate.expectedCostUsd+.000001))throw new Error("Provider exceeded reserved cost; stopping benchmark");
      sample.actualCostUsd=result.costUsd;sample.recordedCostUsd=result.recordedCostUsd??null;sample.costBasis=result.costBasis??"ESTIMATED";spent+=benchmarkLiability(sample)-candidate.expectedCostUsd;
      sample.latencyMs=result.latencyMs;sample.queueTimeMs=result.queueTimeMs??null;sample.generationTimeMs=result.generationTimeMs??null;sample.retryCount=result.retryCount??0;sample.remoteUrl=result.remoteUrl;
      sample.taskId=result.taskId;sample.sourcePath=sourcePath;sample.submissionState="TERMINAL";await journal?.save(sample);
      const normalized=await normalizeProviderBenchmarkClip(sourcePath,normalizedPath);sample.sourceDurationSeconds=normalized.source.duration;sample.normalizedDurationSeconds=normalized.normalized?.duration??null;sample.outputPath=normalized.outputPath;
      const technical=evaluateTechnical(normalized.normalized??normalized.source),native=evaluateTechnical({...normalized.source,duration:8});
      sample.technical={...technical,passed:technical.passed&&Object.values(technical.checks).every(Boolean)&&native.checks.portrait&&native.checks.resolution&&normalized.source.duration>=7.88&&normalized.source.duration<=10.2};
      sample.status="COMPLETED";sample.error=normalized.reason;
    }catch(error){
      if(error instanceof ProviderGenerationError){sample.actualCostUsd=Math.max(sample.actualCostUsd??0,error.costUsd);sample.taskId=error.taskId}
      sample.status="FAILED";sample.error=safeError(error);
      for(const key of Object.values(input.providerKeys??{}))if(key)sample.error=sample.error.split(key).join("[redacted]");
      if(sample.submissionState!=="TERMINAL"){sample.submissionState="UNKNOWN";halted=true}
    }
    await journal?.save(sample);
  }
  const ranking=rankCandidates(samples),choice=chooseWinner(ranking),providerStates=Object.fromEntries(input.candidates.map(candidate=>{const rows=samples.filter(sample=>sample.candidateId===candidate.id),completed=rows.filter(sample=>sample.status==="COMPLETED"),allPass=rows.length>0&&completed.length===rows.length&&completed.every(sample=>sample.technical?.passed);return[candidate.id,!input.execute?"PRIMARY_CANDIDATE":allPass?"BENCHMARK_PASS_PENDING_OWNER_REVIEW":"BENCHMARK_FAILED"]})) as BenchmarkReport["providerStates"];
  return {version:VIDEO_PROVIDER_BENCHMARK_VERSION,createdAt:new Date().toISOString(),execute:input.execute,repeats:input.repeats,budgetCapUsd:cap,forecastCostUsd:forecast,minimumForecastCostUsd:minimumForecast,ownerFlowReferenceProvided:input.ownerFlowReferenceProvided,candidates:input.candidates,samples,ranking,winner:choice.winner,winnerReason:choice.reason,providerStates};
  }finally{await journal?.close()}
}
