import type {RenderedVideo,VideoProvider,VideoRenderInput} from "../video/types";

export const VIDEO_PROVIDER_BENCHMARK_VERSION="video-provider-benchmark-v1";
export const AUTOMATED_QUALITY_THRESHOLD=85;
export type BenchmarkModel="fal_wan_2_2_turbo"|"pixverse_v6"|"tiktok_symphony"|"gen4_turbo"|"h3_max_768"|"wan3_720"|"hailuo3_768"|"gen4.5";
export type BenchmarkProvider="fal"|"pixverse"|"tiktok_symphony"|"runway";
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
  availability:"READY"|"NOT_RUN";
  limitation:string|null;
}
export interface BenchmarkFixture {
  id:string;
  label:string;
  imagePath:string;
  prompt:string;
  renderInput:VideoRenderInput;
}
export interface RemoteVideoRequest {fixture:BenchmarkFixture;candidate:BenchmarkCandidate;seed:number;outputPath:string}
export interface RemoteVideoResult {taskId:string;provider:string;model:string;outputPath:string;costUsd:number;latencyMs:number;remoteUrl:string}
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
  outputPath:string|null;
  technical:TechnicalEvaluation|null;
  human:HumanScores|null;
  humanScore:number|null;
  status:"PLANNED"|"COMPLETED"|"FAILED"|"NOT_RUN"|"SKIPPED";
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
}
