import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir} from "node:fs/promises";
import {dirname,join} from "node:path";
import ffmpegPath from "ffmpeg-static";
import {FFmpegVideoRenderer} from "../video/renderer";
import {evaluateTechnical} from "./rubric";
import type {BenchmarkSample} from "./types";

const run=(binary:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(binary,args,{windowsHide:true}),errors:Buffer[]=[];child.stderr.on("data",data=>errors.push(Buffer.from(data)));child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(`Manual import normalization failed (${code}): ${Buffer.concat(errors).toString().slice(-1200)}`)))});
const binary=()=>{const local=join(process.cwd(),"node_modules","ffmpeg-static",process.platform==="win32"?"ffmpeg.exe":"ffmpeg");return existsSync(local)?local:ffmpegPath};

export async function importManualBenchmarkClip(input:{sourcePath:string;outputPath:string;fixtureId:string;candidateId:"meta_vibes"|"google_flow_manual";repeat?:number}){
  if(!existsSync(input.sourcePath))throw new Error("Owner-supplied benchmark clip was not found");if(existsSync(input.outputPath))throw new Error("Normalized manual output already exists; choose another output path");
  const renderer=new FFmpegVideoRenderer(),source=await renderer.probe(input.sourcePath);if(source.duration<7.88)throw new Error("Manual benchmark source must contain at least eight seconds of video");const ffmpeg=binary();if(!ffmpeg)throw new Error("FFmpeg binary is unavailable");await mkdir(dirname(input.outputPath),{recursive:true});
  const started=Date.now();await run(ffmpeg,["-n","-i",input.sourcePath,"-map","0:v:0","-t","8","-vf","scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p","-c:v","libx264","-preset","medium","-crf","20","-an","-movflags","+faststart",input.outputPath]);const media=await renderer.probe(input.outputPath),repeat=input.repeat??1;
  const sample:BenchmarkSample={id:`${input.candidateId}:${input.fixtureId}:${repeat}`,fixtureId:input.fixtureId,candidateId:input.candidateId,repeat,seed:0,expectedCostUsd:0,actualCostUsd:0,latencyMs:Date.now()-started,taskId:null,inputPath:input.sourcePath,sourcePath:input.sourcePath,outputPath:input.outputPath,sourceDurationSeconds:source.duration,normalizedDurationSeconds:media.duration,technical:evaluateTechnical(media),human:null,humanScore:null,status:"COMPLETED",generationCount:1,quotaUsage:null,humanLaborRequired:true,sourceKind:"OWNER_MANUAL_IMPORT",error:null};return {sample,sourceMedia:source,normalizedMedia:media,originalPreserved:true as const};
}
export const importManualMetaClip=(input:{sourcePath:string;outputPath:string;fixtureId:string;repeat?:number})=>importManualBenchmarkClip({...input,candidateId:"meta_vibes"});
export const importManualGoogleFlowClip=(input:{sourcePath:string;outputPath:string;fixtureId:string;repeat?:number})=>importManualBenchmarkClip({...input,candidateId:"google_flow_manual"});
