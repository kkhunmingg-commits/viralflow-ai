import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {stat} from "node:fs/promises";
import {join} from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import {VIDEO_DURATION_SECONDS,VIDEO_FPS,VIDEO_HEIGHT,VIDEO_WIDTH,type RenderedVideo,type VideoRenderInput,type VideoRenderer} from "./types";

const run=(binary:string,args:string[])=>new Promise<string>((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true}),out:Buffer[]=[],errors:Buffer[]=[];
  child.stdout.on("data",d=>out.push(Buffer.from(d)));
  child.stderr.on("data",d=>errors.push(Buffer.from(d)));
  child.on("error",reject);
  child.on("close",code=>code===0?resolve(Buffer.concat(out).toString()):reject(new Error(`Media process failed (${code}): ${Buffer.concat(errors).toString().slice(-1200)}`)));
});
const esc=(text:string)=>text.normalize("NFKC").replace(/[\\':,%\[\]]/g,m=>`\\${m}`).replace(/[\r\n]/g," ").slice(0,72);
export class FFmpegVideoRenderer implements VideoRenderer {
  readonly provider="local-ffmpeg";
  readonly model="ffmpeg-template-v1";
  private ffmpeg=(()=>{if(process.env.FFMPEG_BINARY)return process.env.FFMPEG_BINARY;const local=join(process.cwd(),"node_modules","ffmpeg-static",process.platform==="win32"?"ffmpeg.exe":"ffmpeg");return existsSync(local)?local:ffmpegPath})();
  private ffprobe=(()=>{if(process.env.FFPROBE_BINARY)return process.env.FFPROBE_BINARY;const local=join(process.cwd(),"node_modules","ffprobe-static","bin",process.platform,process.arch==="arm64"?"arm64":"x64",process.platform==="win32"?"ffprobe.exe":"ffprobe");return existsSync(local)?local:ffprobeStatic.path})();
  async render(input:VideoRenderInput,productImagePath:string,voicePath:string,outputPath:string){
    if(!this.ffmpeg)throw new Error("FFmpeg binary is unavailable");
    const motion=input.variation?.motionPattern??"ZOOM_IN",zoom=motion==="ZOOM_OUT"?"if(eq(on,0),1.06,max(zoom-0.00025,1))":motion==="STATIC"?"1":"min(zoom+0.00025,1.06)";
    const position=input.variation?.overlayPosition??"TOP",hookY=position==="BOTTOM"?"h-470":position==="CENTER"?"h/2-180":"160";
    const overlay=input.overlay.slice(0,3).map((item,index)=>`drawtext=text='${esc(item.text)}':fontcolor=white:fontsize=${index===0?62:48}:box=1:boxcolor=black@0.62:boxborderw=26:x=(w-text_w)/2:y=${index===0?hookY:index===1?"h/2-20":"h-320"}:enable='between(t,${item.start},${item.end})'`).join(",");
    const vf=`scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},zoompan=z='${zoom}':d=1:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${VIDEO_FPS},drawbox=x=70:y=90:w=940:h=1740:color=white@0.08:t=8,${overlay},drawtext=text='${esc(input.productTitle)}':fontcolor=white:fontsize=44:box=1:boxcolor=0x162033@0.72:boxborderw=18:x=(w-text_w)/2:y=h-155,fade=t=in:st=0:d=0.18,fade=t=out:st=7.75:d=0.25,format=yuv420p`;
    await run(this.ffmpeg,["-y","-loop","1","-framerate",String(VIDEO_FPS),"-i",productImagePath,"-i",voicePath,"-f","lavfi","-i",`sine=frequency=110:sample_rate=16000:duration=${VIDEO_DURATION_SECONDS}`,"-filter_complex",`[0:v]${vf}[v];[1:a]volume=1.0[voice];[2:a]volume=0.025[bed];[voice][bed]amix=inputs=2:duration=longest,afade=t=in:st=0:d=0.2,afade=t=out:st=7.6:d=0.4[a]`,"-map","[v]","-map","[a]","-t",String(VIDEO_DURATION_SECONDS),"-r",String(VIDEO_FPS),"-c:v","libx264","-preset","ultrafast","-crf","22","-c:a","aac","-b:a","96k","-movflags","+faststart",outputPath]);
    return this.probe(outputPath);
  }
  async probe(path:string):Promise<RenderedVideo>{
    const raw=await run(this.ffprobe,["-v","error","-show_entries","format=duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate","-of","json",path]),json=JSON.parse(raw) as {format?:{duration?:string};streams?:Array<{codec_type:string;codec_name:string;width?:number;height?:number;avg_frame_rate?:string}>};
    const video=json.streams?.find(s=>s.codec_type==="video"),audio=json.streams?.find(s=>s.codec_type==="audio"),[n,d]=(video?.avg_frame_rate??"0/1").split("/").map(Number),info=await stat(path);
    return {path,duration:Number(json.format?.duration??0),width:video?.width??0,height:video?.height??0,fps:d?n/d:0,videoCodec:video?.codec_name??"",audioCodec:audio?.codec_name??null,hasAudio:Boolean(audio),sizeBytes:info.size};
  }
}
