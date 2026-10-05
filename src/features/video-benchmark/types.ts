import type {RenderedVideo,VideoProvider,VideoRenderInput} from "../video/types";

export const VIDEO_PROVIDER_BENCHMARK_VERSION="video-provider-benchmark-v1";
export const AUTOMATED_QUALITY_THRESHOLD=85;
export type BenchmarkModel="google_flow_manual"|"veo_3_1_lite"|"veo_3_1_fast"|"veo_3_1_standard"|"meta_vibes"|"fal_wan_2_2_turbo"|"fal_ltx_distilled"|"fal_wan_2_6_flash"|"fal_kling_2_5_standard"|"fal_ltx_2_3_fast"|"pixverse_v6"|"tiktok_symphony"|"gen4_turbo"|"h3_max_768"|"wan3_720"|"hailuo3_768"|"gen4.5";
export type BenchmarkProvider="google_flow_manual"|"google_veo"|"meta_vibes"|"fal"|"pixverse"|"tiktok_symphony"|"runway";
export type HumanQualityStatus="BELOW_FLOW"|"FLOW_COMPARABLE"|"ABOVE_FLOW";

export interface BenchmarkCandidate {
  id:BenchmarkModel;
  provider:BenchmarkProvider;
  apiModel:string;
  label:string;
  resolution:string;
  expectedCostUsd:number;
  minimumCostUsd:number;
  sourceUrl:string;
  availability:"READY"|"NOT_RUN"|"MANUAL_BENCHMARK_ONLY";
  limitation:string|null;
}
export interface BenchmarkFixture {
  id:string;
  label:string;
  imagePath:string;
  prompt:string;
  renderInput:VideoRenderInput;
}
export interface RemoteVideoRequest {fixture:BenchmarkFixture;candidate:BenchmarkCandidate;seed:number;outputPath:string;onSubmitted?:(requestId:string)=>Promise<void>}
export interface RemoteVideoResult {taskId:string;provider:string;model:string;outputPath:string;costUsd:number;latencyMs:number;remoteUrl:string;retryCount?:number;queueTimeMs?:number|null;generationTimeMs?:number|null;recordedCostUsd?:number|null;costBasis?:"ESTIMATED"|"PROVIDER_RECORDED"}
export interface RealVideoProvider extends VideoProvider {generate(input:RemoteVideoRequest):Promise<RemoteVideoResult>}
export interface TechnicalEvaluation {passed:boolean;score:number;checks:{duration:boolean;portrait:boolean;resolution:boolean;videoCodec:boolean;frameRate:boolean;nonEmpty:boolean};media:RenderedVideo}
export interface HumanScores {productIdentity:number;motionNaturalness:number;artifactControl:number;commercialSuitability:number;promptAdherence:number;visualAttractiveness:number;flowStatus:HumanQualityStatus}
export interface BenchmarkSample {
  id:string;
  fixtureId:string;
  candidateId:BenchmarkModel;
  repeat:number;
  seed:number;
  expectedCostUsd:number;
  actualCostUsd:number|null;
  latencyMs:number|null;
  taskId:string|null;
  inputPath:string|null;
  sourcePath:string|null;
  outputPath:string|null;
  sourceDurationSeconds:number|null;
  normalizedDurationSeconds:number|null;
  technical:TechnicalEvaluation|null;
  human:HumanScores|null;
  humanScore:number|null;
  status:"PLANNED"|"COMPLETED"|"FAILED"|"NOT_RUN"|"SKIPPED"|"MANUAL_BENCHMARK_ONLY";
  queueTimeMs?:number|null;
  generationTimeMs?:number|null;
  recordedCostUsd?:number|null;
  costBasis?:"ESTIMATED"|"PROVIDER_RECORDED";
  retryCount?:number;
  remoteUrl?:string|null;
  // A durable liability is written before the only paid submission.
  submissionState?:"NOT_SUBMITTED"|"ATTEMPT_RESERVED"|"SUBMITTED"|"TERMINAL"|"UNKNOWN";
  generationCount:number;
  quotaUsage:number|null;
  humanLaborRequired:boolean;
  sourceKind:"PROVIDER_API"|"OWNER_MANUAL_IMPORT";
  error:string|null;
}
export interface BenchmarkReport {
  version:string;
  createdAt:string;
  execute:boolean;
  repeats:number;
  budgetCapUsd:number;
  forecastCostUsd:number;
  minimumForecastCostUsd:number;
  ownerFlowReferenceProvided:boolean;
  candidates:BenchmarkCandidate[];
  samples:BenchmarkSample[];
  ranking:CandidateRanking[];
  winner:BenchmarkModel|null;
  winnerReason:string;
  providerStates:Partial<Record<BenchmarkModel,"PRIMARY_CANDIDATE"|"BENCHMARK_FAILED"|"BENCHMARK_PASS_PENDING_OWNER_REVIEW"|"PRODUCTION_APPROVED">>;
}
export interface CandidateRanking {
  candidateId:BenchmarkModel;
  attempted:number;
  completed:number;
  technicalPassRate:number;
  reviewed:number;
  averageHumanScore:number|null;
  minimumHumanScore:number|null;
  totalCostUsd:number;
  effectiveCostPerPassUsd:number|null;
  eligible:boolean;
  autoModeEligible:boolean;
}
