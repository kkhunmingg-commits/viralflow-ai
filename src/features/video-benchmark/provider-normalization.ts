import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import ffmpegPath from "ffmpeg-static";
import {FFmpegVideoRenderer} from "../video/renderer";

const run=(binary:string,args:string[])=>new Promise<void>((resolve,reject)=>{const child=spawn(binary,args,{windowsHide:true}),errors:Buffer[]=[];child.stderr.on("data",data=>errors.push(Buffer.from(data)));child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(`Provider normalization failed (${code}): ${Buffer.concat(errors).toString().slice(-1200)}`)))});
const binary=()=>{const local=join(process.cwd(),"node_modules","ffmpeg-static",process.platform==="win32"?"ffmpeg.exe":"ffmpeg");return existsSync(local)?local:ffmpegPath};

export async function normalizeProviderBenchmarkClip(sourcePath:string,normalizedPath:string){
  const renderer=new FFmpegVideoRenderer(),source=await renderer.probe(sourcePath);
  if(source.duration<7.88)return{source,normalized:null,outputPath:sourcePath,reason:"Provider source is shorter than the safe eight-second normalization floor"};
  const ffmpeg=binary();if(!ffmpeg)throw new Error("FFmpeg binary is unavailable");
  await run(ffmpeg,["-n","-i",sourcePath,"-map","0:v:0","-t","8","-vf","scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p","-c:v","libx264","-preset","medium","-crf","20","-an","-movflags","+faststart",normalizedPath]);
  const normalized=await renderer.probe(normalizedPath);return{source,normalized,outputPath:normalizedPath,reason:null};
}
