import {createHash} from "node:crypto";
import {fal} from "@fal-ai/client";
import type {RenderedVideo,VideoQualityInput,VideoQualityResult} from "./types";

export const FAL_WAN_ENDPOINT="fal-ai/wan/v2.2-a14b/image-to-video/turbo";
export const FAL_WAN_NOMINAL_COST_USD=.10;
export type FalWanProviderState="PRIMARY_CANDIDATE"|"BENCHMARK_FAILED"|"BENCHMARK_PASS_PENDING_OWNER_REVIEW"|"PRODUCTION_APPROVED";
export type FalWanFailureCode="UNAVAILABLE"|"BUDGET_EXCEEDED"|"SAFETY_REJECTED"|"TIMEOUT"|"PROVIDER_FAILED"|"INVALID_OUTPUT"|"DOWNLOAD_FAILED";

export interface FalWanCapabilities {
  imageToVideo:true;
  resolutions:readonly ["480p","580p","720p"];
  aspectRatios:readonly ["auto","16:9","9:16","1:1"];
  sourceDuration:"PROVIDER_DEFINED";
  configurableFrames:false;
  safetyChecker:true;
  output:"FILE_URL";
  queue:true;
  commercialUse:true;
}
export interface FalWanGenerateInput {image:Blob;prompt:string;seed?:number;maxCostUsd:number;resolution?:"480p"|"580p"|"720p";aspectRatio?:"auto"|"16:9"|"9:16"|"1:1";onSubmitted?:(requestId:string)=>Promise<void>}
export interface FalWanNormalizedResult {requestId:string;videoUrl:string;provider:"fal";model:typeof FAL_WAN_ENDPOINT;resolution:"480p"|"580p"|"720p";aspectRatio:"auto"|"16:9"|"9:16"|"1:1";estimatedCostUsd:number;actualCostUsd:number;retryCount:0;sourceDurationSeconds:null}
export interface FalWanGenerationResult extends FalWanNormalizedResult {bytes:Uint8Array;checksum:string}
type FalResult={data?:{video?:{url?:string;content_type?:string;file_name?:string;file_size?:number}};requestId?:string};
type FalQueueStatus={status?:string;error?:unknown};
export interface FalWanClient {
  upload(file:Blob):Promise<string>;
  submit(endpoint:string,input:Record<string,unknown>):Promise<{request_id:string}>;
  status(endpoint:string,requestId:string):Promise<FalQueueStatus>;
  result(endpoint:string,requestId:string):Promise<FalResult>;
}
const defaultClient=(apiKey:string):FalWanClient=>{
  fal.config({credentials:apiKey});
  return {
    upload:file=>fal.storage.upload(file),
    submit:async(endpoint,input)=>fal.queue.submit(endpoint,{input}),
    status:(endpoint,requestId)=>fal.queue.status(endpoint,{requestId,logs:false}) as Promise<FalQueueStatus>,
    result:(endpoint,requestId)=>fal.queue.result(endpoint,{requestId}) as Promise<FalResult>,
  };
};
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const redact=(value:unknown,key:string)=>String(value??"fal request failed").replaceAll(key,"[REDACTED]").slice(0,500);

export class FalWanProviderError extends Error {
  constructor(public readonly code:FalWanFailureCode,message:string,public readonly retryable=false,public readonly actualCostUsd=0,public readonly requestId:string|null=null){super(message);this.name="FalWanProviderError"}
}

export class FalWanVideoProvider {
  readonly provider="fal";
  readonly model=FAL_WAN_ENDPOINT;
  private readonly apiKey:string;
  private readonly client:FalWanClient;
  private readonly fetchImpl:typeof fetch;
  private readonly sleep:(ms:number)=>Promise<void>;
  private readonly pollIntervalMs:number;
  private readonly maxPollAttempts:number;
  constructor(options:{apiKey?:string;client?:FalWanClient;fetchImpl?:typeof fetch;sleep?:(ms:number)=>Promise<void>;pollIntervalMs?:number;maxPollAttempts?:number}={}){
    this.apiKey=options.apiKey??"";
    this.client=options.client??defaultClient(this.apiKey);
    this.fetchImpl=options.fetchImpl??fetch;
    this.sleep=options.sleep??wait;
    this.pollIntervalMs=options.pollIntervalMs??5_000;
    this.maxPollAttempts=options.maxPollAttempts??144;
  }
  isAvailable(){return this.apiKey.length>0}
  getCapabilities():FalWanCapabilities{return{imageToVideo:true,resolutions:["480p","580p","720p"],aspectRatios:["auto","16:9","9:16","1:1"],sourceDuration:"PROVIDER_DEFINED",configurableFrames:false,safetyChecker:true,output:"FILE_URL",queue:true,commercialUse:true}}
  estimateCost(input:{resolution?:"480p"|"580p"|"720p"}={}){return input.resolution==="480p"?.05:input.resolution==="580p"?.075:FAL_WAN_NOMINAL_COST_USD}
  async generate(input:FalWanGenerateInput):Promise<FalWanGenerationResult>{
    if(!this.isAvailable())throw new FalWanProviderError("UNAVAILABLE","FAL_KEY is not configured");
    const resolution=input.resolution??"720p",aspectRatio=input.aspectRatio??"9:16",estimatedCostUsd=this.estimateCost({resolution});
    if(estimatedCostUsd>input.maxCostUsd)throw new FalWanProviderError("BUDGET_EXCEEDED",`Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds the approved cap`);
    let requestId:string|null=null,submissionAttempted=false;
    try{
      const imageUrl=await this.client.upload(input.image);
      submissionAttempted=true;
      const submitted=await this.client.submit(this.model,{image_url:imageUrl,prompt:input.prompt,seed:input.seed,resolution,aspect_ratio:aspectRatio,enable_safety_checker:true,enable_output_safety_checker:true,enable_prompt_expansion:false,acceleration:"regular",video_quality:"high",video_write_mode:"balanced"});
      requestId=submitted.request_id;
      if(!requestId)throw new FalWanProviderError("INVALID_OUTPUT","fal did not return a request id",false,estimatedCostUsd,null);
      await input.onSubmitted?.(requestId);
      await this.poll(requestId);
      const result=await this.client.result(this.model,requestId),normalized=this.normalizeResult(result,{requestId,resolution,aspectRatio,estimatedCostUsd}),bytes=await this.downloadResult(normalized.videoUrl);
      return {...normalized,bytes,checksum:createHash("sha256").update(bytes).digest("hex")};
    }catch(error){
      if(error instanceof FalWanProviderError)throw error;
      const failure=this.getFailureReason(error);
      throw new FalWanProviderError(failure.code,failure.message,failure.retryable,submissionAttempted?estimatedCostUsd:0,requestId);
    }
  }
  async poll(requestId:string){
    for(let attempt=0;attempt<this.maxPollAttempts;attempt++){
      if(attempt>0)await this.sleep(this.pollIntervalMs);
      const status=await this.client.status(this.model,requestId),value=status.status?.toUpperCase();
      if(value==="COMPLETED")return;
      if(value==="FAILED"||value==="CANCELLED")throw this.failureFrom(status.error??`fal request ${value.toLowerCase()}`,requestId,FAL_WAN_NOMINAL_COST_USD);
    }
    throw new FalWanProviderError("TIMEOUT",`fal request did not finish after ${this.maxPollAttempts} polls`,false,FAL_WAN_NOMINAL_COST_USD,requestId);
  }
  async downloadResult(url:string){const response=await this.fetchImpl(url,{redirect:"follow"});if(!response.ok)throw new FalWanProviderError("DOWNLOAD_FAILED",`fal video download failed (${response.status})`,false,FAL_WAN_NOMINAL_COST_USD);const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length)throw new FalWanProviderError("INVALID_OUTPUT","fal returned an empty video",false,FAL_WAN_NOMINAL_COST_USD);return bytes}
  async retrieve(requestId:string):Promise<FalWanGenerationResult>{
    if(!this.isAvailable())throw new FalWanProviderError("UNAVAILABLE","FAL_KEY is not configured");
    const result=await this.client.result(this.model,requestId);
    const normalized=this.normalizeResult(result,{requestId,resolution:"720p",aspectRatio:"9:16",estimatedCostUsd:FAL_WAN_NOMINAL_COST_USD});
    const bytes=await this.downloadResult(normalized.videoUrl);
    return {...normalized,bytes,checksum:createHash("sha256").update(bytes).digest("hex")};
  }
  normalizeResult(result:FalResult,context:{requestId:string;resolution:"480p"|"580p"|"720p";aspectRatio:"auto"|"16:9"|"9:16"|"1:1";estimatedCostUsd:number}):FalWanNormalizedResult{const videoUrl=result.data?.video?.url;if(!videoUrl)throw new FalWanProviderError("INVALID_OUTPUT","fal completed without a video URL",false,context.estimatedCostUsd,context.requestId);return{requestId:result.requestId??context.requestId,videoUrl,provider:this.provider,model:this.model,resolution:context.resolution,aspectRatio:context.aspectRatio,estimatedCostUsd:context.estimatedCostUsd,actualCostUsd:context.estimatedCostUsd,retryCount:0,sourceDurationSeconds:null}}
  getFailureReason(error:unknown):{code:FalWanFailureCode;message:string;retryable:boolean}{if(error instanceof FalWanProviderError)return{code:error.code,message:redact(error.message,this.apiKey),retryable:error.retryable};const message=redact(error instanceof Error?error.message:error,this.apiKey);if(/safety|moderation|blocked|nsfw/i.test(message))return{code:"SAFETY_REJECTED",message,retryable:false};if(/timeout/i.test(message))return{code:"TIMEOUT",message,retryable:false};return{code:"PROVIDER_FAILED",message,retryable:false}}
  private failureFrom(error:unknown,requestId:string,cost:number){const failure=this.getFailureReason(error);return new FalWanProviderError(failure.code,failure.message,failure.retryable,cost,requestId)}
}

export async function generateAcceptedFalWanMaster(input:{provider:FalWanVideoProvider;request:FalWanGenerateInput;inspect:(bytes:Uint8Array)=>Promise<RenderedVideo>;qualityInput:(media:RenderedVideo)=>VideoQualityInput;evaluate:(input:VideoQualityInput)=>VideoQualityResult;store:(result:FalWanGenerationResult,media:RenderedVideo,quality:VideoQualityResult)=>Promise<string>}){const result=await input.provider.generate(input.request),media=await input.inspect(result.bytes),quality=input.evaluate(input.qualityInput(media));if(quality.status!=="PASS"||quality.score<85)throw new FalWanProviderError("INVALID_OUTPUT",`fal output failed quality gate (${quality.score})`,false,result.actualCostUsd,result.requestId);const storagePath=await input.store(result,media,quality);return{result,media,quality,storagePath,status:"READY" as const}}
