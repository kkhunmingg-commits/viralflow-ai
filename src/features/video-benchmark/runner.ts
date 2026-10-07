import {existsSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {BenchmarkJournal,benchmarkLiability} from "./journal";
import {forecastCost,minimumForecastCost} from "./catalog";
import {FalWan22TurboProvider,PixVerseProvider,TikTokSymphonyProvider} from "./direct-providers";
import {GoogleVeoBenchmarkProvider} from "./google-veo-provider";
import {chooseWinner,evaluateTechnical,rankCandidates} from "./rubric";
import {ProviderGenerationError,RunwayBenchmarkProvider} from "./runway-provider";
import {normalizeProviderBenchmarkClip} from "./provider-normalization";
import {resolveFalModelSettings,restoreFalModelSettings,type FalModelSettings} from "../video/fal-models";
import {FFmpegVideoRenderer} from "../video/renderer";
import {VIDEO_PROVIDER_BENCHMARK_VERSION,type BenchmarkCandidate,type BenchmarkFixture,type BenchmarkReport,type BenchmarkSample,type RealVideoProvider} from "./types";

export interface RunBenchmarkInput {candidates:BenchmarkCandidate[];fixtures:BenchmarkFixture[];repeats:number;execute:boolean;recoverOnly?:boolean;budgetCapUsd:number;hardMaxUsd?:number;providerKeys?:Partial<Record<"google"|"runway"|"fal"|"pixverse",string>>;pixverseUsdPerCredit?:number;outputDir:string;resumeSamples?:BenchmarkSample[];ownerFlowReferenceProvided:boolean;secondRoundEligibleIds?:string[]}
const safeError=(error:unknown)=>error instanceof Error?error.message.slice(0,500):"Benchmark failed";
const validCost=(value:unknown):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>=0;
function providerFor(candidate:BenchmarkCandidate,input:RunBenchmarkInput,settings?:FalModelSettings):RealVideoProvider{if(candidate.provider==="google_veo")return new GoogleVeoBenchmarkProvider(candidate,input.providerKeys?.google??"");if(candidate.provider==="runway")return new RunwayBenchmarkProvider(candidate,input.providerKeys?.runway??"");if(candidate.provider==="fal")return new FalWan22TurboProvider(candidate,input.providerKeys?.fal??"",settings?{settings}:{});if(candidate.provider==="pixverse")return new PixVerseProvider(candidate,input.providerKeys?.pixverse??"",input.pixverseUsdPerCredit);return new TikTokSymphonyProvider(candidate)}
export async function runVideoProviderBenchmark(input:RunBenchmarkInput):Promise<BenchmarkReport>{
  const recoveryOnly=input.recoverOnly===true,live=input.execute||recoveryOnly;
  if(recoveryOnly&&(input.execute||input.candidates.some(row=>row.provider!=="fal")))throw new Error("Recovery is fal-only and cannot enable paid execution");
  const cap=Math.min(input.budgetCapUsd,input.hardMaxUsd??input.budgetCapUsd);
  if(live&&(!Number.isFinite(cap)||cap<=0))throw new Error("Positive hard benchmark cap required");
  if(!Number.isInteger(input.repeats)||input.repeats<1||input.repeats>5)throw new Error("Benchmark repeats must be between 1 and 5");if(!input.fixtures.length)throw new Error("At least one fixture is required");
  if(new Set(input.fixtures.map(row=>row.id)).size!==input.fixtures.length||new Set(input.candidates.map(row=>row.id)).size!==input.candidates.length)throw new Error("Benchmark fixture and candidate IDs must be unique");
  if(input.candidates.some(row=>!Number.isFinite(row.expectedCostUsd)||row.expectedCostUsd<0))throw new Error("Invalid benchmark cost estimate");
  const baseForecast=forecastCost(input.candidates,input.fixtures.length,1),baseMinimum=minimumForecastCost(input.candidates,input.fixtures.length,1),eligible=new Set(input.secondRoundEligibleIds??[]),extraForecast=input.candidates.reduce((sum,candidate)=>sum+[...eligible].filter(id=>id.startsWith(`${candidate.id}:`)).length*candidate.expectedCostUsd*Math.max(0,input.repeats-1),0),extraMinimum=input.candidates.reduce((sum,candidate)=>sum+[...eligible].filter(id=>id.startsWith(`${candidate.id}:`)).length*candidate.minimumCostUsd*Math.max(0,input.repeats-1),0),forecast=Number((baseForecast+extraForecast).toFixed(4)),minimumForecast=Number((baseMinimum+extraMinimum).toFixed(4));if(input.execute&&forecast>cap)throw new Error(`Forecast ${forecast.toFixed(2)} exceeds benchmark cap ${cap.toFixed(2)}`);
  await mkdir(input.outputDir,{recursive:true});
  const journal=live?await BenchmarkJournal.acquire(input.outputDir,input.resumeSamples,{recoveryOnly}):null;
  try{
  const samples:BenchmarkSample[]=[],previous=new Map((journal?.samples??input.resumeSamples??[]).map(sample=>[sample.id,sample])),spentBefore=[...previous.values()].reduce((sum,sample)=>sum+benchmarkLiability(sample),0);let spent=spentBefore,halted=false;
  if((live&&!Number.isFinite(spent))||(input.execute&&spent>cap))throw new Error("Prior benchmark liability exceeds budget");
  for(const candidate of input.candidates)for(const fixture of input.fixtures)for(let repeat=1;repeat<=input.repeats;repeat++){
    const id=`${candidate.id}:${fixture.id}:${repeat}`,prior=previous.get(id);
    const recovering=Boolean(recoveryOnly&&prior&&prior.generationCount>0&&prior.status!=="COMPLETED"&&prior.taskId);
    if(prior&&(prior.generationCount>0||prior.status==="COMPLETED"||prior.status==="FAILED")){
      await journal?.checkInput(id,candidate,fixture,repeat);if(!recovering){samples.push(prior);continue}
    }
    const seed=prior?.seed??1000+repeat,sample:BenchmarkSample=recovering?structuredClone(prior!):{id,fixtureId:fixture.id,candidateId:candidate.id,repeat,seed,expectedCostUsd:candidate.expectedCostUsd,actualCostUsd:null,latencyMs:null,taskId:null,inputPath:null,sourcePath:null,outputPath:null,sourceDurationSeconds:null,normalizedDurationSeconds:null,technical:null,human:null,humanScore:null,status:"PLANNED",generationCount:0,quotaUsage:null,humanLaborRequired:false,sourceKind:"PROVIDER_API",error:null};samples.push(sample);
    if(recoveryOnly&&!recovering){sample.status="SKIPPED";sample.error="Recovery never submits a new generation";continue}
    if(candidate.availability==="NOT_RUN"){sample.status="NOT_RUN";sample.error=candidate.limitation;continue}if(candidate.availability==="MANUAL_BENCHMARK_ONLY"){sample.status="MANUAL_BENCHMARK_ONLY";sample.humanLaborRequired=true;sample.sourceKind="OWNER_MANUAL_IMPORT";sample.error=candidate.limitation;continue}if(repeat>1&&!input.secondRoundEligibleIds?.includes(`${candidate.id}:${fixture.id}:1`)){sample.status="SKIPPED";sample.error="Second sample requires a passing technical gate, Flow-comparable human status, and remaining budget";continue}if(!live)continue;
    if(!recovering&&(halted||spent+candidate.expectedCostUsd>cap)){sample.status="SKIPPED";sample.error=halted?"Stopped for uncertain provider liability":"Hard benchmark budget cap reached";continue}
    let originalSettings:FalModelSettings|undefined;
    if(recovering){
      if(sample.endpoint!==candidate.apiModel||!sample.nativeSettings||sample.nativeSettings.model!==sample.endpoint||!sample.plannedSourcePath||!sample.plannedOutputPath)throw new Error("Recovery requires the original endpoint, native settings and artifact paths");
      originalSettings=restoreFalModelSettings(sample.nativeSettings);
    }
    const provider=providerFor(candidate,input,originalSettings);
    const sourcePath=sample.plannedSourcePath??join(input.outputDir,`${candidate.id}-${fixture.id}-${repeat}-source.mp4`),normalizedPath=sample.plannedOutputPath??join(input.outputDir,`${candidate.id}-${fixture.id}-${repeat}.mp4`);
    if(!recovering){
      if(existsSync(sourcePath)||existsSync(normalizedPath))throw new Error("Existing benchmark artifacts require reconciliation before another paid attempt");
      await journal?.checkInput(id,candidate,fixture,repeat);
      sample.inputPath=fixture.imagePath;sample.endpoint=candidate.apiModel;
      if(candidate.provider==="fal")sample.nativeSettings=provider.getSettings?.()??resolveFalModelSettings({model:candidate.apiModel,durationSeconds:8,resolution:candidate.id==="fal_ltx_2_3_fast"?"1080p":"720p",aspectRatio:"9:16"});
      sample.plannedSourcePath=sourcePath;sample.plannedOutputPath=normalizedPath;
      sample.generationCount=1;sample.submissionState="ATTEMPT_RESERVED";sample.actualCostUsd=candidate.expectedCostUsd;
      sample.recordedCostUsd=null;sample.costBasis="ESTIMATED";sample.retryCount=0;spent+=candidate.expectedCostUsd;await journal?.save(sample);
    }
    try{
      if(recovering&&!provider.retrieve)throw new Error("Provider does not support recovery");
      // Recovery only retrieves an existing ID; it cannot reach paid generation.
      const result=recovering?await provider.retrieve!({taskId:sample.taskId!,outputPath:sourcePath}):await provider.generate({fixture,candidate,seed,outputPath:sourcePath,onSubmitted:async requestId=>{sample.taskId=requestId;sample.submissionState="SUBMITTED";await journal?.save(sample)}});
      const priorLiability=benchmarkLiability(sample),costValid=validCost(result.costUsd),recordedValid=result.recordedCostUsd==null||validCost(result.recordedCostUsd);
      // Persist valid observed charges before reacting to a reserve breach.
      if(costValid)sample.actualCostUsd=recovering?Math.max(sample.actualCostUsd??0,result.costUsd):result.costUsd;
      if(result.recordedCostUsd!=null&&recordedValid){sample.recordedCostUsd=result.recordedCostUsd;sample.costBasis=result.costBasis??"ESTIMATED"}
      else if(!recovering||sample.costBasis!=="PROVIDER_RECORDED"){sample.recordedCostUsd=null;sample.costBasis="ESTIMATED"}
      spent+=benchmarkLiability(sample)-priorLiability;
      if(recovering){sample.recoveryLatencyMs=result.latencyMs;sample.queueTimeMs=sample.queueTimeMs??result.queueTimeMs??null;sample.generationTimeMs=sample.generationTimeMs??result.generationTimeMs??null}
      else{sample.latencyMs=result.latencyMs;sample.queueTimeMs=result.queueTimeMs??null;sample.generationTimeMs=result.generationTimeMs??null}
      sample.retryCount=result.retryCount??0;sample.remoteUrl=result.remoteUrl;
      sample.taskId=result.taskId;sample.sourcePath=sourcePath;sample.submissionState="TERMINAL";await journal?.save(sample);
      if(!costValid||!recordedValid||result.costUsd>sample.expectedCostUsd+.000001||(result.recordedCostUsd??0)>sample.expectedCostUsd+.000001){halted=true;throw new Error("Provider exceeded reserved cost or returned invalid billing; stopping benchmark")}
      const renderer=recovering&&existsSync(normalizedPath)?new FFmpegVideoRenderer():null;
      const normalized=renderer?{source:await renderer.probe(sourcePath),normalized:await renderer.probe(normalizedPath),outputPath:normalizedPath,reason:null}:await normalizeProviderBenchmarkClip(sourcePath,normalizedPath);
      sample.sourceDurationSeconds=normalized.source.duration;sample.normalizedDurationSeconds=normalized.normalized?.duration??null;sample.outputPath=normalized.outputPath;sample.sourceMedia=normalized.source;sample.normalizedMedia=normalized.normalized;
      const technical=evaluateTechnical(normalized.normalized??normalized.source),native=evaluateTechnical({...normalized.source,duration:8});
      sample.technical={...technical,passed:technical.passed&&Object.values(technical.checks).every(Boolean)&&native.checks.portrait&&native.checks.resolution&&normalized.source.duration>=7.88&&normalized.source.duration<=10.2};
      sample.status="COMPLETED";sample.error=normalized.reason;
    }catch(error){
      const priorLiability=benchmarkLiability(sample);
      if(error instanceof ProviderGenerationError){if(validCost(error.costUsd))sample.actualCostUsd=Math.max(sample.actualCostUsd??0,error.costUsd);if(error.taskId)sample.taskId=error.taskId;if(error.terminalConfirmed)sample.submissionState="TERMINAL";if(!validCost(error.costUsd)||error.costUsd>sample.expectedCostUsd+.000001)halted=true}
      spent+=benchmarkLiability(sample)-priorLiability;
      sample.status="FAILED";sample.error=safeError(error);
      for(const key of Object.values(input.providerKeys??{}))if(key)sample.error=sample.error.split(key).join("[redacted]");
      if(sample.submissionState!=="TERMINAL"){sample.submissionState="UNKNOWN";halted=true}
      if(spent>cap)halted=true;
    }
    await journal?.save(sample);
  }
  const ranking=rankCandidates(samples),choice=chooseWinner(ranking),providerStates=Object.fromEntries(input.candidates.map(candidate=>{const rows=samples.filter(sample=>sample.candidateId===candidate.id),completed=rows.filter(sample=>sample.status==="COMPLETED"),allPass=rows.length>0&&completed.length===rows.length&&completed.every(sample=>sample.technical?.passed);return[candidate.id,!live?"PRIMARY_CANDIDATE":allPass?"BENCHMARK_PASS_PENDING_OWNER_REVIEW":"BENCHMARK_FAILED"]})) as BenchmarkReport["providerStates"];
  return {version:VIDEO_PROVIDER_BENCHMARK_VERSION,createdAt:new Date().toISOString(),execute:input.execute,repeats:input.repeats,budgetCapUsd:cap,forecastCostUsd:forecast,minimumForecastCostUsd:minimumForecast,ownerFlowReferenceProvided:input.ownerFlowReferenceProvided,candidates:input.candidates,samples,ranking,winner:choice.winner,winnerReason:choice.reason,providerStates};
  }finally{await journal?.close()}
}
