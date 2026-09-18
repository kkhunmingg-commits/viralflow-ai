import {readFile,writeFile} from "node:fs/promises";
import {GoogleVeoProvider,type GoogleVeoModel} from "../video/google-veo";
import type {VideoRenderInput} from "../video/types";
import type {BenchmarkCandidate,RealVideoProvider,RemoteVideoRequest,RemoteVideoResult} from "./types";

const modelFor=(id:BenchmarkCandidate["id"]):GoogleVeoModel=>id==="veo_3_1_fast"?"VEO_3_1_FAST":id==="veo_3_1_standard"?"VEO_3_1_STANDARD":"VEO_3_1_LITE";
const mimeFor=(path:string):"image/png"|"image/jpeg"|"image/webp"=>path.toLowerCase().endsWith(".png")?"image/png":path.toLowerCase().endsWith(".webp")?"image/webp":"image/jpeg";
export class GoogleVeoBenchmarkProvider implements RealVideoProvider {
  readonly provider="google-veo";readonly model:string;private readonly client:GoogleVeoProvider;
  constructor(private readonly candidate:BenchmarkCandidate,apiKey:string,options:ConstructorParameters<typeof GoogleVeoProvider>[0]={}){this.model=candidate.apiModel;this.client=new GoogleVeoProvider({...options,apiKey,model:modelFor(candidate.id)})}
  async plan(input:VideoRenderInput){return structuredClone(input)}
  async generate(request:RemoteVideoRequest):Promise<RemoteVideoResult>{const started=Date.now(),image=await readFile(request.fixture.imagePath),result=await this.client.generate({prompt:request.fixture.prompt,image:{bytes:image,mimeType:mimeFor(request.fixture.imagePath)},durationSeconds:8,aspectRatio:"9:16",resolution:"720p",seed:request.seed,maxCostUsd:this.candidate.expectedCostUsd});await writeFile(request.outputPath,result.bytes);return{taskId:result.operationName,provider:this.provider,model:this.model,outputPath:request.outputPath,costUsd:result.actualCostUsd,latencyMs:Date.now()-started,remoteUrl:result.videoUri}}
}
