import {randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {basename} from "node:path";
import {fal} from "@fal-ai/client";
import type {VideoRenderInput} from "../video/types";
import {ProviderGenerationError} from "./runway-provider";
import type {BenchmarkCandidate,RealVideoProvider,RemoteVideoRequest,RemoteVideoResult} from "./types";

const PIXVERSE_BASE="https://app-api.pixverse.ai/openapi/v2";
const mimeFor=(path:string)=>path.toLowerCase().endsWith(".png")?"image/png":path.toLowerCase().endsWith(".webp")?"image/webp":"image/jpeg";
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function download(url:string,path:string){const response=await fetch(url);if(!response.ok)throw new Error(`Provider output download failed (${response.status})`);const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length)throw new Error("Provider returned an empty video");await writeFile(path,bytes)}
async function pixverseJson<T>(url:string,apiKey:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{...init,headers:{"API-KEY":apiKey,"Ai-trace-id":randomUUID(),...(init?.headers??{})}});const body=await response.json() as {ErrCode:number;ErrMsg:string;Resp:T};if(!response.ok||body.ErrCode!==0)throw new Error(`PixVerse request failed: ${body.ErrMsg||response.status}`);return body.Resp}

export class FalWan22TurboProvider implements RealVideoProvider {
  readonly provider="fal";readonly model:string;
  constructor(private candidate:BenchmarkCandidate,apiKey:string){if(!apiKey)throw new Error("FAL_KEY is required only for an explicitly approved live benchmark");this.model=candidate.apiModel;fal.config({credentials:apiKey})}
  async plan(input:VideoRenderInput){return structuredClone(input)}
  async generate(request:RemoteVideoRequest):Promise<RemoteVideoResult>{
    const started=Date.now(),bytes=await readFile(request.fixture.imagePath),imageUrl=await fal.storage.upload(new Blob([bytes],{type:mimeFor(request.fixture.imagePath)}));
    const result=await fal.subscribe(this.model,{input:{image_url:imageUrl,prompt:request.fixture.prompt,resolution:"720p",aspect_ratio:"9:16",num_frames:120,frames_per_second:15,num_interpolated_frames:0,adjust_fps_for_interpolation:false,seed:request.seed},logs:false}) as {data:{video?:{url?:string}};requestId:string};
    const remoteUrl=result.data.video?.url;if(!remoteUrl)throw new ProviderGenerationError("fal task completed without a video URL",result.requestId,this.candidate.expectedCostUsd);await download(remoteUrl,request.outputPath);
    return {taskId:result.requestId,provider:this.provider,model:this.model,outputPath:request.outputPath,costUsd:this.candidate.expectedCostUsd,latencyMs:Date.now()-started,remoteUrl};
  }
}

export class PixVerseProvider implements RealVideoProvider {
  readonly provider="pixverse";readonly model:string;
  constructor(private candidate:BenchmarkCandidate,private apiKey:string,private usdPerCredit=.01){if(!apiKey)throw new Error("PIXVERSE_API_KEY is required only for an explicitly approved live benchmark");this.model=candidate.apiModel}
  async plan(input:VideoRenderInput){return structuredClone(input)}
  async generate(request:RemoteVideoRequest):Promise<RemoteVideoResult>{
    const started=Date.now(),form=new FormData(),bytes=await readFile(request.fixture.imagePath);form.append("image",new Blob([bytes],{type:mimeFor(request.fixture.imagePath)}),basename(request.fixture.imagePath));
    const uploaded=await pixverseJson<{img_id:number}>(`${PIXVERSE_BASE}/image/upload`,this.apiKey,{method:"POST",body:form});
    const created=await pixverseJson<{video_id:number}>(`${PIXVERSE_BASE}/video/img/generate`,this.apiKey,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({duration:8,img_id:uploaded.img_id,model:"v6",motion_mode:"normal",prompt:request.fixture.prompt,quality:"720p",generate_audio_switch:false,generate_multi_clip_switch:false,seed:request.seed})});
    let remoteUrl="";for(let attempt=0;attempt<120;attempt++){const status=await pixverseJson<{status:number;url:string}>(`${PIXVERSE_BASE}/video/result/${created.video_id}`,this.apiKey);if(status.status===1){remoteUrl=status.url;break}if(status.status===7||status.status===8)throw new ProviderGenerationError(`PixVerse generation failed with status ${status.status}`,String(created.video_id),Number((72*this.usdPerCredit).toFixed(4)));await sleep(5000)}
    if(!remoteUrl)throw new ProviderGenerationError("PixVerse generation timed out",String(created.video_id),Number((72*this.usdPerCredit).toFixed(4)));await download(remoteUrl,request.outputPath);
    return {taskId:String(created.video_id),provider:this.provider,model:this.model,outputPath:request.outputPath,costUsd:Number((72*this.usdPerCredit).toFixed(4)),latencyMs:Date.now()-started,remoteUrl};
  }
}

export class TikTokSymphonyProvider implements RealVideoProvider {
  readonly provider="tiktok_symphony";readonly model:string;
  constructor(candidate:BenchmarkCandidate){this.model=candidate.apiModel}
  async plan(input:VideoRenderInput){return structuredClone(input)}
  async generate():Promise<never>{throw new Error("TikTok Symphony is NOT_RUN until legitimate approved API access and public cost evidence are available")}
}
