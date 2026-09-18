import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {videoStoragePath} from "./storage";
import type {RenderedVideo,VideoQualityInput,VideoQualityResult} from "./types";

export const GOOGLE_VEO_PROVIDER_VERSION="google-veo-provider-v1";
export const GOOGLE_VEO_API_BASE="https://generativelanguage.googleapis.com/v1beta";
export const GOOGLE_FLOW_MANUAL={provider:"GOOGLE_FLOW_MANUAL",status:"MANUAL_BENCHMARK_ONLY",automated:false} as const;

export type GoogleVeoModel="VEO_3_1_LITE"|"VEO_3_1_FAST"|"VEO_3_1_STANDARD";
export type GoogleVeoResolution="720p"|"1080p"|"4k";
export type GoogleVeoAspectRatio="9:16"|"16:9";
export type GoogleVeoDuration=4|6|8;
export type GoogleVeoFailureCode="UNAVAILABLE"|"BUDGET_EXCEEDED"|"TIMEOUT"|"RATE_LIMIT"|"QUOTA_EXCEEDED"|"SAFETY_REJECTED"|"OPERATION_FAILED"|"INVALID_OUTPUT"|"DOWNLOAD_FAILED"|"HTTP_ERROR";

export interface GoogleVeoCapabilities {textToVideo:true;imageToVideo:true;durations:readonly GoogleVeoDuration[];aspectRatios:readonly GoogleVeoAspectRatio[];resolutions:readonly GoogleVeoResolution[];fps:24;audio:"ALWAYS_ON";referenceImages:number;videoExtension:boolean;status:"PREVIEW"}
export interface GoogleVeoGenerateInput {prompt:string;image?:{bytes:Uint8Array;mimeType:"image/png"|"image/jpeg"|"image/webp"};durationSeconds?:GoogleVeoDuration;aspectRatio?:GoogleVeoAspectRatio;resolution?:GoogleVeoResolution;seed?:number;maxCostUsd:number}
interface GoogleOperation {name?:string;done?:boolean;error?:{code?:number;message?:string;status?:string};response?:{generateVideoResponse?:{generatedSamples?:Array<{video?:{uri?:string}}>} }}
export interface GoogleVeoNormalizedResult {operationName:string;videoUri:string;provider:"google-veo";model:string;durationSeconds:GoogleVeoDuration;resolution:GoogleVeoResolution;aspectRatio:GoogleVeoAspectRatio;estimatedCostUsd:number;actualCostUsd:number;retryCount:number}
export interface GoogleVeoGenerationResult extends GoogleVeoNormalizedResult {bytes:Uint8Array;checksum:string}
export interface GoogleVeoProviderOptions {apiKey?:string;model?:GoogleVeoModel;fetchImpl?:typeof fetch;sleep?: (ms:number)=>Promise<void>;pollIntervalMs?:number;maxPollAttempts?:number;maxTransientRetries?:number;baseUrl?:string}

export const GOOGLE_VEO_MODELS:Record<GoogleVeoModel,{apiModel:string;prices:Partial<Record<GoogleVeoResolution,number>>;capabilities:GoogleVeoCapabilities}>={
  VEO_3_1_LITE:{apiModel:"veo-3.1-lite-generate-preview",prices:{"720p":.05,"1080p":.08},capabilities:{textToVideo:true,imageToVideo:true,durations:[4,6,8],aspectRatios:["9:16","16:9"],resolutions:["720p","1080p"],fps:24,audio:"ALWAYS_ON",referenceImages:0,videoExtension:false,status:"PREVIEW"}},
  VEO_3_1_FAST:{apiModel:"veo-3.1-fast-generate-preview",prices:{"720p":.10,"1080p":.12,"4k":.30},capabilities:{textToVideo:true,imageToVideo:true,durations:[4,6,8],aspectRatios:["9:16","16:9"],resolutions:["720p","1080p","4k"],fps:24,audio:"ALWAYS_ON",referenceImages:3,videoExtension:true,status:"PREVIEW"}},
  VEO_3_1_STANDARD:{apiModel:"veo-3.1-generate-preview",prices:{"720p":.40,"1080p":.40,"4k":.60},capabilities:{textToVideo:true,imageToVideo:true,durations:[4,6,8],aspectRatios:["9:16","16:9"],resolutions:["720p","1080p","4k"],fps:24,audio:"ALWAYS_ON",referenceImages:3,videoExtension:true,status:"PREVIEW"}},
};

export class GoogleVeoProviderError extends Error {constructor(public readonly code:GoogleVeoFailureCode,message:string,public readonly retryable=false,public readonly actualCostUsd=0){super(message);this.name="GoogleVeoProviderError"}}
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const safeMessage=(value:unknown,key?:string)=>{const message=String(value??"Google Veo request failed");return(key?message.replaceAll(key,"[REDACTED]"):message).slice(0,500)};

export class GoogleVeoProvider {
  readonly provider="google-veo";readonly model:GoogleVeoModel;
  private readonly apiKey:string;private readonly fetchImpl:typeof fetch;private readonly sleep:(ms:number)=>Promise<void>;private readonly pollIntervalMs:number;private readonly maxPollAttempts:number;private readonly maxTransientRetries:number;private readonly baseUrl:string;
  constructor(options:GoogleVeoProviderOptions={}){this.apiKey=options.apiKey??"";this.model=options.model??"VEO_3_1_LITE";this.fetchImpl=options.fetchImpl??fetch;this.sleep=options.sleep??wait;this.pollIntervalMs=options.pollIntervalMs??10_000;this.maxPollAttempts=options.maxPollAttempts??36;this.maxTransientRetries=options.maxTransientRetries??2;this.baseUrl=options.baseUrl??GOOGLE_VEO_API_BASE}
  isAvailable(){return this.apiKey.length>0}
  getCapabilities(){return structuredClone(GOOGLE_VEO_MODELS[this.model].capabilities)}
  estimateCost(input:{durationSeconds?:GoogleVeoDuration;resolution?:GoogleVeoResolution}){const duration=input.durationSeconds??8,resolution=input.resolution??"720p",rate=GOOGLE_VEO_MODELS[this.model].prices[resolution];if(rate===undefined)throw new GoogleVeoProviderError("INVALID_OUTPUT",`${this.model} does not support ${resolution}`);if(duration!==8&&resolution!=="720p")throw new GoogleVeoProviderError("INVALID_OUTPUT",`${resolution} requires an 8-second generation`);return Number((rate*duration).toFixed(6))}
  async generate(input:GoogleVeoGenerateInput):Promise<GoogleVeoGenerationResult>{
    if(!this.isAvailable())throw new GoogleVeoProviderError("UNAVAILABLE","GOOGLE_GENAI_API_KEY is not configured");
    const duration=input.durationSeconds??8,resolution=input.resolution??"720p",aspectRatio=input.aspectRatio??"9:16",estimatedCostUsd=this.estimateCost({durationSeconds:duration,resolution});
    if(estimatedCostUsd>input.maxCostUsd)throw new GoogleVeoProviderError("BUDGET_EXCEEDED",`Estimated cost $${estimatedCostUsd.toFixed(2)} exceeds the approved cap`);
    const instance:Record<string,unknown>={prompt:input.prompt};if(input.image)instance.image={inlineData:{mimeType:input.image.mimeType,data:Buffer.from(input.image.bytes).toString("base64")}};
    const parameters:Record<string,unknown>={aspectRatio,durationSeconds:duration,resolution,numberOfVideos:1};if(input.seed!==undefined)parameters.seed=input.seed;
    const apiModel=GOOGLE_VEO_MODELS[this.model].apiModel,response=await this.fetchImpl(`${this.baseUrl}/models/${apiModel}:predictLongRunning`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":this.apiKey},body:JSON.stringify({instances:[instance],parameters})});
    const operation=await this.readJson(response);if(!response.ok)throw this.httpFailure(response.status,operation);if(!operation.name)throw new GoogleVeoProviderError("INVALID_OUTPUT","Google Veo did not return an operation name");
    const polled=await this.pollOperation(operation.name),normalized=this.normalizeResult(polled,{durationSeconds:duration,resolution,aspectRatio,estimatedCostUsd});
    try{const download=await this.downloadResult(normalized.videoUri),retryCount=normalized.retryCount+download.retryCount;return {...normalized,retryCount,bytes:download.bytes,checksum:createHash("sha256").update(download.bytes).digest("hex")}}
    catch(error){if(error instanceof GoogleVeoProviderError)throw new GoogleVeoProviderError(error.code,error.message,error.retryable,estimatedCostUsd);throw error}
  }
  async pollOperation(operationName:string){let retries=0;for(let attempt=0;attempt<this.maxPollAttempts;attempt++){if(attempt>0)await this.sleep(this.pollIntervalMs);const response=await this.fetchImpl(`${this.baseUrl}/${operationName}`,{headers:{"x-goog-api-key":this.apiKey}}),body=await this.readJson(response);if(!response.ok){const failure=this.httpFailure(response.status,body);if(failure.retryable&&retries<this.maxTransientRetries){retries++;continue}throw failure}if(body.done){if(body.error)throw this.operationFailure(body.error);return Object.assign(body,{_retryCount:retries})}}
    throw new GoogleVeoProviderError("TIMEOUT",`Google Veo operation did not finish after ${this.maxPollAttempts} polls`,true)}
  async downloadResult(uri:string){let retries=0;while(true){const response=await this.fetchImpl(uri,{headers:{"x-goog-api-key":this.apiKey},redirect:"follow"});if(response.ok){const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length)throw new GoogleVeoProviderError("INVALID_OUTPUT","Google Veo returned an empty video");return{bytes,retryCount:retries}}if((response.status===429||response.status>=500)&&retries<this.maxTransientRetries){retries++;await this.sleep(this.pollIntervalMs);continue}throw new GoogleVeoProviderError("DOWNLOAD_FAILED",`Google Veo video download failed (${response.status})`,response.status===429||response.status>=500)}}
  normalizeResult(operation:GoogleOperation&{_retryCount?:number},context:{durationSeconds:GoogleVeoDuration;resolution:GoogleVeoResolution;aspectRatio:GoogleVeoAspectRatio;estimatedCostUsd:number}):GoogleVeoNormalizedResult{const videoUri=operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;if(!operation.name||!videoUri)throw new GoogleVeoProviderError("INVALID_OUTPUT","Completed Google Veo operation did not contain a video URI");return {operationName:operation.name,videoUri,provider:this.provider,model:GOOGLE_VEO_MODELS[this.model].apiModel,...context,actualCostUsd:context.estimatedCostUsd,retryCount:operation._retryCount??0}}
  getFailureReason(error:unknown){if(error instanceof GoogleVeoProviderError)return{code:error.code,message:safeMessage(error.message,this.apiKey),retryable:error.retryable};return{code:"HTTP_ERROR" as const,message:safeMessage(error instanceof Error?error.message:error,this.apiKey),retryable:false}}
  private async readJson(response:Response){try{return await response.json() as GoogleOperation}catch{return {} as GoogleOperation}}
  private httpFailure(status:number,body:GoogleOperation){const message=safeMessage(body.error?.message??`Google Veo request failed (${status})`,this.apiKey);if(status===429)return new GoogleVeoProviderError(/quota/i.test(message)?"QUOTA_EXCEEDED":"RATE_LIMIT",message,true);if(status>=500)return new GoogleVeoProviderError("HTTP_ERROR",message,true);if(/safety|blocked|moderation/i.test(message))return new GoogleVeoProviderError("SAFETY_REJECTED",message);return new GoogleVeoProviderError("HTTP_ERROR",message)}
  private operationFailure(error:NonNullable<GoogleOperation["error"]>){const message=safeMessage(error.message??error.status,this.apiKey);if(error.code===429||/quota|resource_exhausted/i.test(`${error.status} ${message}`))return new GoogleVeoProviderError("QUOTA_EXCEEDED",message,true);if(/safety|blocked|moderation/i.test(message))return new GoogleVeoProviderError("SAFETY_REJECTED",message);return new GoogleVeoProviderError("OPERATION_FAILED",message)}
}

export interface GoogleVeoMasterPipelineInput {provider:GoogleVeoProvider;request:GoogleVeoGenerateInput;inspect:(bytes:Uint8Array)=>Promise<RenderedVideo>;qualityInput:(media:RenderedVideo)=>VideoQualityInput;evaluate:(input:VideoQualityInput)=>VideoQualityResult;store:(result:GoogleVeoGenerationResult,media:RenderedVideo,quality:VideoQualityResult)=>Promise<string>}
export async function generateAcceptedGoogleVeoMaster(input:GoogleVeoMasterPipelineInput){const result=await input.provider.generate(input.request),media=await input.inspect(result.bytes),quality=input.evaluate(input.qualityInput(media));if(quality.status!=="PASS"||quality.score<85)throw new GoogleVeoProviderError("INVALID_OUTPUT",`Google Veo output failed quality gate (${quality.score})`);const storagePath=await input.store(result,media,quality);return{result,media,quality,storagePath,status:"READY" as const}}

export async function storeGoogleVeoMaster(client:SupabaseClient,input:{ownerId:string;productId:string;creativeProjectId:string;masterId:string;result:GoogleVeoGenerationResult;media:RenderedVideo}){const path=videoStoragePath(input.ownerId,"masters",input.masterId,"provider-original.mp4"),upload=await client.storage.from("video-assets").upload(path,input.result.bytes,{contentType:"video/mp4",upsert:false});if(upload.error)throw new Error(upload.error.message);const row=await client.from("media_assets").upsert({owner_id:input.ownerId,product_id:input.productId,creative_project_id:input.creativeProjectId,asset_type:"VIDEO",source_type:"GENERATED",storage_path:path,mime_type:"video/mp4",width:input.media.width,height:input.media.height,duration_seconds:input.media.duration,provider:input.result.provider,model:input.result.model,checksum:input.result.checksum},{onConflict:"owner_id,storage_path"});if(row.error)throw new Error(row.error.message);return path}
