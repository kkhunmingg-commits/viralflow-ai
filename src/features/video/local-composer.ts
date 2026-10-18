import {spawn} from "node:child_process";
import {copyFile,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ffmpegBinary} from "./ffmpeg-binary";
import {FFmpegVideoRenderer} from "./renderer";
import type {RenderedVideo} from "./types";

/** Local, zero-cost composer for reviewed real product media. It only crops, pans and
 * captions original pixels; it never generates product imagery or fake demonstrations. */
export const LOCAL_COMPOSER_PROVIDER="local-ffmpeg",LOCAL_COMPOSER_MODEL="real-media-composer-v1";
export const THAI_FONT_FAMILY="Noto Sans Thai",THAI_FONT_FILE="NotoSansThai-Bold.ttf";
const WIDTH=1080,HEIGHT=1920,FPS=30,LOUDNESS_TARGET=-14,LOUDNESS_TOLERANCE=2;

export interface ComposerClip {assetId:string;path:string;kind:"IMAGE"|"VIDEO";durationSeconds?:number}
export interface ComposerCaption {text:string;start:number;end:number}
export interface ComposeRealMediaInput {clips:ComposerClip[];captions:ComposerCaption[];voicePath?:string;durationSeconds:number;workDir:string;outputPath:string;fontPath?:string}
export interface ComposerQc {name:"DURATION"|"RESOLUTION"|"AUDIO_TRACK"|"VOICE"|"LOUDNESS";passed:boolean;detail:string}
export interface ComposedVideo {media:RenderedVideo;loudnessLufs:number|null;checks:ComposerQc[];passed:boolean;provider:string;model:string}

export const defaultThaiFontPath=()=>join(process.cwd(),"assets","fonts",THAI_FONT_FILE);

// Thai vowel and tone marks stack on the base letter, so only base characters take horizontal space.
const visibleLength=(text:string)=>text.replace(/\p{M}/gu,"").length;
/** Thai has no spaces, so break at dictionary word boundaries to keep captions inside the safe area. */
export function wrapThaiCaption(text:string,maxChars=20,maxLines=2){
  const words=[...new Intl.Segmenter("th",{granularity:"word"}).segment(text.normalize("NFC").replace(/\s+/g," ").trim())].map(s=>s.segment);
  const lines:string[]=[];let line="";
  for(const word of words){
    if(line&&visibleLength(line+word)>maxChars){lines.push(line.trim());line=word.trimStart()}else line+=word;
  }
  if(line.trim())lines.push(line.trim());
  if(lines.length>maxLines)throw new Error("caption_too_long");
  return lines;
}

const assTime=(seconds:number)=>{const cs=Math.round(Math.max(0,seconds)*100),h=Math.floor(cs/360000),m=Math.floor(cs/6000)%60,s=Math.floor(cs/100)%60;return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs%100).padStart(2,"0")}`};
// Caption text is data: strip ASS override braces and escapes so it can never restyle or move itself.
const assText=(line:string)=>line.replace(/[{}\\]/g,"").replace(/[\r\n]+/g," ");

export function buildAssSubtitles(captions:ComposerCaption[],durationSeconds:number){
  const events=captions.filter(c=>c.text.trim()).map(c=>{
    const start=Math.max(0,c.start),end=Math.min(durationSeconds,c.end);
    if(!(end>start))throw new Error("caption_timing_invalid");
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${wrapThaiCaption(assText(c.text)).join("\\N")}`;
  });
  return ["[Script Info]","ScriptType: v4.00+",`PlayResX: ${WIDTH}`,`PlayResY: ${HEIGHT}`,"WrapStyle: 2","ScaledBorderAndShadow: yes","",
    "[V4+ Styles]","Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Bottom-centre, above TikTok's caption/button zone.
    `Style: Caption,${THAI_FONT_FAMILY},72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H99000000,-1,0,0,0,100,100,0,0,3,4,0,2,90,90,420,222`,"",
    "[Events]","Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",...events,""].join("\n");
}

export function segmentDurations(count:number,total:number){
  if(count<1||count>6)throw new Error("composer_clip_count_invalid");
  const frames=Math.round(total*FPS),base=Math.floor(frames/count);
  return Array.from({length:count},(_,i)=>(i===count-1?frames-base*(count-1):base)/FPS);
}

/** Build ffmpeg arguments. Images get a slow pan across original pixels; footage is trimmed and
 * held on its last frame if short. Source audio is dropped because clip audio rights are not attested. */
export function composerArgs(input:{clips:ComposerClip[];durations:number[];voicePath?:string;durationSeconds:number;outputPath:string}){
  const args=["-nostdin","-hide_banner","-loglevel","error","-y"];
  input.clips.forEach((clip,i)=>{
    const seg=input.durations[i];
    if(clip.kind==="IMAGE")args.push("-loop","1","-framerate",String(FPS),"-t",String(seg),"-i",clip.path);
    else args.push("-t",String(seg),"-i",clip.path);
  });
  const audioIndex=input.clips.length;
  if(input.voicePath)args.push("-i",input.voicePath);else args.push("-f","lavfi","-t",String(input.durationSeconds),"-i","anullsrc=channel_layout=stereo:sample_rate=48000");
  const chains=input.clips.map((clip,i)=>{
    const seg=input.durations[i];
    const fit=clip.kind==="IMAGE"
      ?`scale=${Math.round(WIDTH*1.12)}:${Math.round(HEIGHT*1.12)}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}:x='(iw-ow)*min(t/${seg},1)':y='(ih-oh)/2'`
      :`scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},tpad=stop_mode=clone:stop_duration=${seg}`;
    return `[${i}:v]${fit},fps=${FPS},setsar=1,format=yuv420p,trim=duration=${seg},setpts=PTS-STARTPTS[v${i}]`;
  });
  const concat=`${input.clips.map((_,i)=>`[v${i}]`).join("")}concat=n=${input.clips.length}:v=1:a=0,ass=subtitles.ass:fontsdir=fonts,format=yuv420p[v]`;
  const audio=input.voicePath
    ?`[${audioIndex}:a]aresample=48000,loudnorm=I=${LOUDNESS_TARGET}:TP=-1.5:LRA=11,apad,atrim=0:${input.durationSeconds},afade=t=out:st=${(input.durationSeconds-.3).toFixed(2)}:d=0.3[a]`
    :`[${audioIndex}:a]atrim=0:${input.durationSeconds}[a]`;
  args.push("-filter_complex",[...chains,concat,audio].join(";"),"-map","[v]","-map","[a]","-t",String(input.durationSeconds),"-r",String(FPS),
    "-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-ar","48000","-movflags","+faststart",input.outputPath);
  return args;
}

function runFfmpeg(binary:string,args:string[],cwd:string,timeoutMs=180_000){
  return new Promise<string>((resolve,reject)=>{
    const child=spawn(binary,args,{cwd,windowsHide:true,stdio:["ignore","ignore","pipe"]}),errors:Buffer[]=[];
    let failed:Error|null=null;
    const timer=setTimeout(()=>{failed=new Error("composer_timeout");child.kill()},timeoutMs);
    child.stderr.on("data",d=>errors.push(Buffer.from(d)));
    child.on("error",error=>{failed=error});
    child.on("close",code=>{clearTimeout(timer);const stderr=Buffer.concat(errors).toString();if(failed||code!==0)reject(failed??new Error(`composer_failed: ${stderr.slice(-600)}`));else resolve(stderr)});
  });
}

export async function measureLoudness(path:string){
  const binary=ffmpegBinary();if(!binary)throw new Error("ffmpeg_unavailable");
  const stderr=await runFfmpeg(binary,["-nostdin","-hide_banner","-nostats","-i",path,"-map","0:a:0","-af","ebur128=framelog=quiet","-f","null","-"],process.cwd(),60_000);
  const match=/Integrated loudness:\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(stderr);
  return match&&match[1]!=="-inf"?Number(match[1]):null;
}

export function composerQc(media:RenderedVideo,loudnessLufs:number|null,expected:{durationSeconds:number;hasVoice:boolean}):ComposerQc[]{
  return [
    {name:"DURATION",passed:Math.abs(media.duration-expected.durationSeconds)<=.15,detail:`${media.duration.toFixed(2)}s`},
    {name:"RESOLUTION",passed:media.width===WIDTH&&media.height===HEIGHT,detail:`${media.width}x${media.height}`},
    {name:"AUDIO_TRACK",passed:media.hasAudio,detail:media.audioCodec??"none"},
    // A silent clip renders but is not usable for an ad until real or licensed narration exists.
    {name:"VOICE",passed:expected.hasVoice,detail:expected.hasVoice?"narration present":"no narration; owner voice or licensed TTS required"},
    {name:"LOUDNESS",passed:!expected.hasVoice||(loudnessLufs!==null&&Math.abs(loudnessLufs-LOUDNESS_TARGET)<=LOUDNESS_TOLERANCE),
      detail:loudnessLufs===null?"silent":`${loudnessLufs.toFixed(1)} LUFS (target ${LOUDNESS_TARGET}±${LOUDNESS_TOLERANCE})`},
  ];
}

export async function composeRealMedia(input:ComposeRealMediaInput):Promise<ComposedVideo>{
  if(![8,10].includes(input.durationSeconds))throw new Error("video_duration_invalid");
  if(!input.clips.length)throw new Error("composer_requires_reviewed_media");
  const binary=ffmpegBinary();if(!binary)throw new Error("ffmpeg_unavailable");
  const durations=segmentDurations(input.clips.length,input.durationSeconds);
  await mkdir(join(input.workDir,"fonts"),{recursive:true});
  await copyFile(input.fontPath??defaultThaiFontPath(),join(input.workDir,"fonts",THAI_FONT_FILE));
  await writeFile(join(input.workDir,"subtitles.ass"),buildAssSubtitles(input.captions,input.durationSeconds),"utf8");
  await runFfmpeg(binary,composerArgs({clips:input.clips,durations,voicePath:input.voicePath,durationSeconds:input.durationSeconds,outputPath:input.outputPath}),input.workDir);
  const media=await new FFmpegVideoRenderer().probe(input.outputPath);
  const loudnessLufs=input.voicePath?await measureLoudness(input.outputPath):null;
  const checks=composerQc(media,loudnessLufs,{durationSeconds:input.durationSeconds,hasVoice:Boolean(input.voicePath)});
  return {media,loudnessLufs,checks,passed:checks.every(c=>c.passed),provider:LOCAL_COMPOSER_PROVIDER,model:LOCAL_COMPOSER_MODEL};
}
