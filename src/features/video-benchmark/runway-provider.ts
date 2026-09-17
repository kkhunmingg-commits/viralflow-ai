import {readFile,writeFile} from "node:fs/promises";
import RunwayML,{TaskFailedError} from "@runwayml/sdk";
import type {VideoRenderInput} from "../video/types";
import type {BenchmarkCandidate,RealVideoProvider,RemoteVideoRequest} from "./types";

function imageDataUri(path:string){return readFile(path).then(bytes=>{const lower=path.toLowerCase(),mime=lower.endsWith(".png")?"image/png":lower.endsWith(".webp")?"image/webp":lower.endsWith(".jpg")||lower.endsWith(".jpeg")?"image/jpeg":null;if(!mime)throw new Error("Benchmark input must be PNG, JPEG, or WebP");if(bytes.length>5_000_000)throw new Error("Benchmark image exceeds Runway's 5 MB data-URI limit");return `data:${mime};base64,${bytes.toString("base64")}`})}
async function download(url:string,path:string){const response=await fetch(url);if(!response.ok)throw new Error(`Provider output download failed (${response.status})`);const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length)throw new Error("Provider returned an empty video");await writeFile(path,bytes)}
export class ProviderGenerationError extends Error {constructor(message:string,readonly taskId:string|null,readonly costUsd:number){super(message);this.name="ProviderGenerationError"}}
export class RunwayBenchmarkProvider implements RealVideoProvider {
  readonly provider="runway";
  readonly model:string;
  private client:RunwayML;
  constructor(private candidate:BenchmarkCandidate,apiKey:string){if(!apiKey)throw new Error("RUNWAYML_API_SECRET is required only for an explicitly approved live benchmark");this.model=candidate.apiModel;this.client=new RunwayML({apiKey,maxRetries:2,timeout:60_000})}
  async plan(input:VideoRenderInput){return structuredClone(input)}
  async generate(request:RemoteVideoRequest){
    const promptImage=await imageDataUri(request.fixture.imagePath),started=Date.now(),promptText=request.fixture.prompt,c=this.candidate;
    const task=c.id==="gen4_turbo"?this.client.imageToVideo.create({model:"gen4_turbo",promptImage,promptText,ratio:"720:1280",duration:8,seed:request.seed})
      :c.id==="gen4.5"?this.client.imageToVideo.create({model:"gen4.5",promptImage,promptText,ratio:"720:1280",duration:8,seed:request.seed})
      :c.id==="h3_max_768"?this.client.imageToVideo.create({model:"h3_max",promptImage,promptText,duration:8,resolution:"768p",promptExpansionMode:"disabled",seed:request.seed})
      :c.id==="wan3_720"?this.client.imageToVideo.create({model:"wan3",promptImage,promptText,duration:8,ratio:"auto_720p",audio:false})
      :this.client.imageToVideo.create({model:"hailuo3",promptImage,promptText,duration:8,ratio:"adaptive",resolution:"768p"});
    try{const result=await task.waitForTaskOutput({timeout:12*60_000}),remoteUrl=result.output[0];if(!remoteUrl)throw new ProviderGenerationError("Provider task completed without a video URL",result.id,Number((result.cost.credits*.01).toFixed(4)));await download(remoteUrl,request.outputPath);return {taskId:result.id,provider:this.provider,model:this.model,outputPath:request.outputPath,costUsd:Number((result.cost.credits*.01).toFixed(4)),latencyMs:Date.now()-started,remoteUrl}}
    catch(error){if(error instanceof ProviderGenerationError)throw error;if(error instanceof TaskFailedError){const details=error.taskDetails,cost="cost" in details?Number((details.cost.credits*.01).toFixed(4)):0;throw new ProviderGenerationError(details.status==="FAILED"?details.failure:"Provider task was cancelled",details.id,cost)}throw error}
  }
}
