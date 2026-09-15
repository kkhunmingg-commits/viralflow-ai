export const VIDEO_FACTORY_VERSION="video-factory-v1";
export const VIDEO_QUALITY_VERSION="video-quality-v1";
export const VIDEO_SIMILARITY_VERSION="video-similarity-v1";
export const VIDEO_BUCKET="video-assets";
export const VIDEO_DURATION_SECONDS=8;
export const VIDEO_WIDTH=1080;
export const VIDEO_HEIGHT=1920;
export const VIDEO_FPS=30;
export const MAX_VARIATION_SIMILARITY=.82;

export type VideoStrategy="REUSE_MASTER"|"LOCAL_TEMPLATE"|"FREE_CREDIT"|"AI_IMAGE_TO_VIDEO"|"PREMIUM_AI_VIDEO";
export type VideoQualityStatus="PASS"|"RETRY"|"REJECT";
export type VideoStatus="QUEUED"|"PROCESSING"|"READY"|"APPROVED"|"REJECTED"|"FAILED";
export type JobStatus="QUEUED"|"PROCESSING"|"COMPLETED"|"FAILED"|"RETRYING"|"CANCELLED";

export interface TimedText {start:number;end:number;text:string}
export interface SceneInstruction {start:number;end:number;visual:string;motion:string}
export interface VideoRenderInput {
  productTitle:string;
  hook:string;
  cta:string;
  overlay:TimedText[];
  scenes:SceneInstruction[];
  template:string;
  variation?:VariationPlan;
}
export interface RenderedVideo {
  path:string;
  duration:number;
  width:number;
  height:number;
  fps:number;
  videoCodec:string;
  audioCodec:string|null;
  hasAudio:boolean;
  sizeBytes:number;
}
export interface VideoProvider {
  readonly provider:string;
  readonly model:string;
  plan(input:VideoRenderInput):Promise<VideoRenderInput>;
}
export interface ImageProvider {
  readonly provider:string;
  readonly model:string;
  createProductImage(title:string,outputPath:string):Promise<{path:string;checksum:string;width:number;height:number}>;
}
export interface VoiceProvider {
  readonly provider:string;
  readonly model:string;
  createVoiceTrack(text:string,outputPath:string,durationSeconds:number):Promise<{path:string;duration:number}>;
}
export interface VideoRenderer {
  readonly provider:string;
  readonly model:string;
  render(input:VideoRenderInput,productImagePath:string,voicePath:string,outputPath:string):Promise<RenderedVideo>;
  probe(path:string):Promise<RenderedVideo>;
}
export interface VideoQualityInput extends RenderedVideo {
  overlay:TimedText[];
  scenes:SceneInstruction[];
  productVisible:boolean;
  ctaVisible:boolean;
  malformedAssets:boolean;
  inheritedRisk:"SAFE"|"REVIEW"|"REJECT";
}
export interface VideoQualityResult {score:number;status:VideoQualityStatus;explanation:Record<string,number|string|boolean>}
export interface VideoQualityEvaluator {evaluate(input:VideoQualityInput):VideoQualityResult}
export interface VariationPlan {
  variationIndex:number;
  variationType:"HOOK"|"CROP"|"MOTION"|"OVERLAY"|"CTA"|"VOICE"|"SPEED"|"TRANSITION"|"BACKGROUND"|"COMPOSITE";
  hook:string;
  cta:string;
  overlayPosition:"TOP"|"CENTER"|"BOTTOM";
  motionPattern:"ZOOM_IN"|"ZOOM_OUT"|"PAN_LEFT"|"PAN_RIGHT"|"STATIC";
  transition:"CUT"|"CROSSFADE";
  background:"LIGHT"|"DARK"|"ACCENT";
  speed:number;
}
export interface SimilarityMetadata {
  masterId:string;
  hook:string;
  cta:string;
  scenes:SceneInstruction[];
  motion:unknown;
  overlay:unknown;
  audio:unknown;
}
export interface VideoBudget {
  maxCostPerVideoUsd:number;
  dailyVideoBudgetUsd:number;
  monthlyVideoBudgetUsd:number;
  spentTodayUsd:number;
  spentMonthUsd:number;
}
export interface ProviderAvailability {freeCredit:boolean;lowCostPaid:boolean;premium:boolean;paidAllowed:boolean}
export interface StrategyDecision {strategy:VideoStrategy;estimatedCostUsd:number;reason:string[]}
