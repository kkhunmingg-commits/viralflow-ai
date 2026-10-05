import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import ffmpegPath from "ffmpeg-static";
import {FFmpegVideoRenderer} from "../video/renderer";

const run=(binary:string,args:string[])=>new Promise<void>((resolve,reject)=>{
  const child=spawn(binary,["-nostdin",...args],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
  let errorOutput="",failure:Error|null=null;
  const timer=setTimeout(()=>{failure=new Error("Provider normalization timed out");child.kill()},120000);
  child.stderr.on("data",data=>{errorOutput=(errorOutput+String(data)).slice(-1200)});
  child.on("error",error=>{failure=error});
  child.on("close",code=>{clearTimeout(timer);if(failure||code!==0)reject(failure??new Error(`Provider normalization failed (${code}): ${errorOutput}`));else resolve()});
});
const binary=()=>{const local=join(process.cwd(),"node_modules","ffmpeg-static",process.platform==="win32"?"ffmpeg.exe":"ffmpeg");return existsSync(local)?local:ffmpegPath};

/** Pad a COPY of the full reference; never crop product packaging or overwrite the owner's image. */
export async function preparePortraitProductReference(sourcePath:string,outputPath:string){
  if(sourcePath===outputPath)throw new Error("Product reference preparation requires a separate copy");
  const ffmpeg=binary();if(!ffmpeg)throw new Error("FFmpeg binary is unavailable");
  await run(ffmpeg,["-nostdin","-hide_banner","-loglevel","error","-n","-i",sourcePath,"-frames:v","1","-vf","scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x181c26","-q:v","2",outputPath]);
  return outputPath;
}

export async function normalizeProviderBenchmarkClip(sourcePath:string,normalizedPath:string,options:{preserveAudio?:boolean;targetDurationSeconds?:8|10}={}){
  const target=options.targetDurationSeconds??8;
  if (![8,10].includes(target)||sourcePath===normalizedPath) throw new Error("Provider normalization requires a separate copy and an 8 or 10 second target");
  const renderer=new FFmpegVideoRenderer(),source=await renderer.probe(sourcePath);
  if(source.duration<target-.12)return{source,normalized:null,outputPath:sourcePath,reason:`Provider source is shorter than the safe ${target}-second normalization floor`};
  const ffmpeg=binary();if(!ffmpeg)throw new Error("FFmpeg binary is unavailable");
  await run(ffmpeg,["-n","-i",sourcePath,"-map","0:v:0",...(options.preserveAudio?["-map","0:a:0?"]:[]),"-t",String(target),"-vf","scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p","-c:v","libx264","-preset","medium","-crf","20",...(options.preserveAudio?["-c:a","aac"]:["-an"]),"-movflags","+faststart",normalizedPath]);
  const normalized=await renderer.probe(normalizedPath);return{source,normalized,outputPath:normalizedPath,reason:null};
}
