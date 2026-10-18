import {spawn} from "node:child_process";
import {copyFile,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ffmpegBinary} from "./ffmpeg-binary";
import {FFmpegVideoRenderer} from "./renderer";
import type {RenderedVideo} from "./types";

/** Local, zero-cost composer. It crops, pans and captions reviewed real media, and draws
 * original typographic cards; it never generates product imagery or fake demonstrations. */
export const LOCAL_COMPOSER_PROVIDER="local-ffmpeg",LOCAL_COMPOSER_MODEL="real-media-composer-v1";
export const THAI_FONT_FAMILY="Noto Sans Thai",THAI_FONT_FILE="NotoSansThai-Bold.ttf";
const WIDTH=1080,HEIGHT=1920,FPS=30,LOUDNESS_TARGET=-14,LOUDNESS_TOLERANCE=2;

/** GRAPHIC is a system-drawn gradient card (no source file); its headline is the on-screen copy. */
export type ShotMotion="PUSH_IN"|"PULL_OUT"|"PAN"|"DETAIL"|"HOLD";
/** Normalised box (0..1) around the subject, so a detail shot zooms on the product rather than empty background. */
export interface SubjectBox {x:number;y:number;w:number;h:number}
export interface ComposerClip {assetId:string;path:string;kind:"IMAGE"|"VIDEO"|"GRAPHIC";durationSeconds?:number;headline?:string;palette?:[string,string];
  /** Planned shot length; when every clip has one the edit follows the narration beats instead of an even split. */
  seconds?:number;motion?:ShotMotion;
  /** FRAMED keeps the whole product above the caption band on a blurred fill; FULL_BLEED fills the frame. */
  layout?:"FRAMED"|"FULL_BLEED";subject?:SubjectBox;
  /** Small label above a graphic headline (e.g. "ข้อ 1") and a large figure drawn as a motion-graphic badge. */
  kicker?:string;badge?:string}
export type ComposerAudioMode="NARRATION"|"CAPTION_ONLY";
export interface ComposerCaption {text:string;start:number;end:number}
export interface ComposeRealMediaInput {clips:ComposerClip[];captions:ComposerCaption[];voicePath?:string;durationSeconds:number;workDir:string;outputPath:string;fontPath?:string;
  /** CAPTION_ONLY is a planned text-first format, not a fallback for missing narration. */
  audioMode?:ComposerAudioMode;overlays?:ComposerOverlay[]}
export interface ComposerQc {name:"DURATION"|"RESOLUTION"|"AUDIO_TRACK"|"VOICE"|"LOUDNESS"|"READABILITY"|"HOOK"|"TEXT_COVERAGE"|"PACING";passed:boolean;detail:string}
export interface ComposedVideo {media:RenderedVideo;loudnessLufs:number|null;checks:ComposerQc[];passed:boolean;provider:string;model:string}

export const defaultThaiFontPath=()=>join(process.cwd(),"assets","fonts",THAI_FONT_FILE);

// Thai vowel and tone marks stack on the base letter, so only base characters take horizontal space.
const visibleLength=(text:string)=>text.replace(/\p{M}/gu,"").length;
/** Thai has no spaces, so break at dictionary word boundaries to keep captions inside the safe area. */
export function wrapThaiCaption(text:string,maxChars=20,maxLines=2){
  const clean=text.normalize("NFC").replace(/\s+/g," ").trim();
  const pack=(units:string[])=>{const lines:string[]=[];let line="";
    for(const unit of units){if(line&&visibleLength(line+unit)>maxChars){lines.push(line.trim());line=unit.trimStart()}else line+=unit}
    if(line.trim())lines.push(line.trim());return lines};
  // Writers put spaces between Thai phrases; breaking there first avoids splitting compounds such as ต่อ|ไป.
  // A phrase too long for one line is split into words on lines of its own, never glued to the previous phrase.
  const words=(phrase:string)=>[...new Intl.Segmenter("th",{granularity:"word"}).segment(phrase)].map(s=>s.segment);
  const lines:string[]=[];
  for(const phrase of clean.split(" ")){
    const last=lines.at(-1);
    if(last!==undefined&&visibleLength(`${last} ${phrase}`)<=maxChars){lines[lines.length-1]=`${last} ${phrase}`;continue}
    if(visibleLength(phrase)<=maxChars)lines.push(phrase);else lines.push(...pack(words(phrase)));
  }
  if(lines.length>maxLines)throw new Error("caption_too_long");
  return lines;
}

const assTime=(seconds:number)=>{const cs=Math.round(Math.max(0,seconds)*100),h=Math.floor(cs/360000),m=Math.floor(cs/6000)%60,s=Math.floor(cs/100)%60;return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(cs%100).padStart(2,"0")}`};
// Caption text is data: strip ASS override braces and escapes so it can never restyle or move itself.
const assText=(line:string)=>line.replace(/[{}\\]/g,"").replace(/[\r\n]+/g," ");

// Numbers carry most claims, so they are drawn in the accent colour to stand out.
const highlight=(line:string)=>line.replace(/([0-9][0-9.,%]*)/g,"{\\c&H2EC8FF&}$1{\\c&HFFFFFF&}");
const POP="{\\fad(80,60)\\fscx88\\fscy88\\t(0,140,\\fscx100\\fscy100)}";
type AssStyle="Caption"|"Card"|"Kicker"|"Badge";
const event=(style:AssStyle,c:ComposerCaption,durationSeconds:number,lines:string[],prefix="")=>{
  const start=Math.max(0,c.start),end=Math.min(durationSeconds,c.end);
  if(!(end>start))throw new Error("caption_timing_invalid");
  return `Dialogue: ${style==="Caption"?2:1},${assTime(start)},${assTime(end)},${style},,0,0,0,,${prefix}${lines.map(highlight).join("\\N")}`;
};
/** Motion-graphic shapes are ASS vector drawings, so they cost nothing and never depict the product. */
const drawing=(start:number,end:number,body:string)=>`Dialogue: 0,${assTime(start)},${assTime(end)},Shape,,0,0,0,,${body}`;
export interface ComposerOverlay {kind:"KICKER"|"BADGE"|"ACCENT"|"FLASH"|"ORB";text?:string;start:number;end:number;colour?:string}
export function overlayEvents(overlays:ComposerOverlay[],durationSeconds:number){
  return overlays.flatMap(o=>{
    const start=Math.max(0,o.start),end=Math.min(durationSeconds,o.end);
    if(!(end>start))return [];
    if(o.kind==="KICKER"&&o.text?.trim())return [event("Kicker",{text:o.text,start,end},durationSeconds,wrapThaiCaption(assText(o.text),18,1),POP)];
    if(o.kind==="BADGE"&&o.text?.trim())return [event("Badge",{text:o.text,start,end},durationSeconds,[assText(o.text).slice(0,6)],"{\\fad(60,80)\\fscx40\\fscy40\\t(0,220,\\fscx100\\fscy100)}")];
    const colour=/^&H[0-9A-F]{6}&$/.test(o.colour??"")?o.colour:"&H2EC8FF&";
    // Accent bar slides in under the headline; a short flash marks a beat change.
    if(o.kind==="ACCENT")return [drawing(start,end,`{\\an7\\c${colour}\\move(-760,1150,160,1150,0,260)\\p1}m 0 0 l 760 0 760 16 0 16{\\p0}`)];
    // A large translucent disc drifting behind graphic cards gives depth without competing with the text.
    if(o.kind==="ORB")return [drawing(start,end,`{\\an7\\c&HFFFFFF&\\alpha&HE4&\\move(${o.text==="b"?-260:520},${o.text==="b"?1300:180},${o.text==="b"?-120:380},${o.text==="b"?1180:320})\\p1}m 0 400 b 0 -133 800 -133 800 400 b 800 933 0 933 0 400{\\p0}`)];
    if(o.kind==="FLASH")return [drawing(start,Math.min(end,start+.12),`{\\an7\\pos(0,0)\\c&HFFFFFF&\\alpha&HA8&\\fad(0,120)\\p1}m 0 0 l ${WIDTH} 0 ${WIDTH} ${HEIGHT} 0 ${HEIGHT}{\\p0}`)];
    return [];
  });
}
// Caption band: lower-middle third, clear of TikTok's description (bottom ~470px) and action column (right ~190px).
export const CAPTION_SAFE_BOX={top:1120,bottom:1400,left:80,right:WIDTH-200};
export const CAPTION_MAX_CHARS=15;
export function buildAssSubtitles(captions:ComposerCaption[],durationSeconds:number,cards:ComposerCaption[]=[],overlays:ComposerOverlay[]=[]){
  const events=[...overlayEvents(overlays,durationSeconds),
    ...cards.filter(c=>c.text.trim()).map(c=>event("Card",c,durationSeconds,wrapThaiCaption(assText(c.text),14,4),POP)),
    ...captions.filter(c=>c.text.trim()).map(c=>event("Caption",c,durationSeconds,wrapThaiCaption(assText(c.text),CAPTION_MAX_CHARS),POP))];
  return ["[Script Info]","ScriptType: v4.00+",`PlayResX: ${WIDTH}`,`PlayResY: ${HEIGHT}`,"WrapStyle: 2","ScaledBorderAndShadow: yes","",
    "[V4+ Styles]","Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${THAI_FONT_FAMILY},84,&H00FFFFFF,&H00FFFFFF,&H38000000,&H00000000,-1,0,0,0,100,100,0,0,3,16,0,2,${CAPTION_SAFE_BOX.left},${WIDTH-CAPTION_SAFE_BOX.right},${HEIGHT-CAPTION_SAFE_BOX.bottom},222`,
    // Centred headline on graphic cards, kept clear of TikTok's top and bottom overlays.
    `Style: Card,${THAI_FONT_FAMILY},98,&H00FFFFFF,&H00FFFFFF,&H00221A12,&H66000000,-1,0,0,0,100,100,0,0,1,6,3,5,110,190,0,222`,
    `Style: Kicker,${THAI_FONT_FAMILY},58,&H00111111,&H00FFFFFF,&H002EC8FF,&H002EC8FF,-1,0,0,0,100,100,2,0,3,14,0,8,110,190,560,222`,
    `Style: Badge,${THAI_FONT_FAMILY},230,&H002EC8FF,&H00FFFFFF,&H00221A12,&H66000000,-1,0,0,0,100,100,0,0,1,8,4,8,110,190,300,222`,
    `Style: Shape,${THAI_FONT_FAMILY},20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,222`,"",
    "[Events]","Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",...events,""].join("\n");
}

export const MAX_SHOTS=8;
export function segmentDurations(count:number,total:number,planned?:Array<number|undefined>){
  if(count<1||count>MAX_SHOTS)throw new Error("composer_clip_count_invalid");
  if(planned?.length===count&&planned.every(v=>typeof v==="number"&&v>=.4)){
    // Frame-align each planned shot; the last absorbs rounding so the edit is exactly the clip length.
    let used=0;const frames=Math.round(total*FPS);
    const out=planned.map((v,i)=>{const f=i===count-1?frames-used:Math.round(v!*FPS);used+=f;return f});
    if(out.every(f=>f>=12))return out.map(f=>f/FPS);
  }
  const frames=Math.round(total*FPS),base=Math.floor(frames/count);
  return Array.from({length:count},(_,i)=>(i===count-1?frames-base*(count-1):base)/FPS);
}

const clamp01=(v:number,lo=0,hi=1)=>Math.min(hi,Math.max(lo,Number.isFinite(v)?v:.5));
/** A moving shot from one still: the subject is framed, then pushed, pulled, panned or punched in on.
 * Rendering at 2x before zoompan keeps the motion smooth instead of stepping a pixel at a time. */
export function imageShot(index:number,clip:ComposerClip,seconds:number){
  const n=Math.max(1,Math.round(seconds*FPS)),box=clip.subject??{x:.2,y:.2,w:.6,h:.6};
  const framed=clip.layout==="FRAMED";
  // FRAMED: product sits in the upper 60% on a blurred copy of itself, leaving the caption band clear.
  const base=framed
    ?`[${index}:v]split[b${index}][f${index}];[b${index}]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=40:3,eq=brightness=-0.22:saturation=0.75[bb${index}];[f${index}]scale=1000:1000:force_original_aspect_ratio=decrease[ff${index}];[bb${index}][ff${index}]overlay=x=(W-w)/2:y=150+(1000-h)/2`
    :`[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`;
  const cx=framed?.5:clamp01(box.x+box.w/2,.15,.85),cy=framed?(150+500)/HEIGHT:clamp01(box.y+box.h/2,.15,.85);
  // Detail zoom fills ~85% of the frame with the upper part of the subject, where labels, lids and controls usually are.
  const detail=Math.min(2.4,Math.max(1.35,.85/Math.max(box.w,box.h*WIDTH/HEIGHT,.2)));
  const dy=framed?cy-.08:clamp01(box.y+box.h*.35,.15,.85);
  const spec={PUSH_IN:{z:`1+0.16*on/${n}`,x:cx,y:cy},PULL_OUT:{z:`1.2-0.2*on/${n}`,x:cx,y:cy},HOLD:{z:`1.03+0.03*on/${n}`,x:cx,y:cy},
    DETAIL:{z:`${detail.toFixed(3)}+0.18*on/${n}`,x:cx,y:dy},PAN:{z:"1.25",x:-1,y:cy}}[clip.motion??"PUSH_IN"];
  const x=spec.x<0?`(iw-iw/zoom)*on/${n}`:`max(0,min(iw-iw/zoom,${spec.x.toFixed(3)}*iw-iw/zoom/2))`;
  const y=`max(0,min(ih-ih/zoom,${spec.y.toFixed(3)}*ih-ih/zoom/2))`;
  return `${base},scale=${WIDTH*2}:${HEIGHT*2},zoompan=z='${spec.z}':x='${x}':y='${y}':d=${n}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;
}

/** Build ffmpeg arguments. Images get a slow pan across original pixels; footage is trimmed and
 * held on its last frame if short. Source audio is dropped because clip audio rights are not attested. */
export function composerArgs(input:{clips:ComposerClip[];durations:number[];voicePath?:string;durationSeconds:number;outputPath:string}){
  const args=["-nostdin","-hide_banner","-loglevel","error","-y"];
  input.clips.forEach((clip,i)=>{
    const seg=input.durations[i];
    if(clip.kind==="IMAGE")args.push(...(clip.motion?[]:["-loop","1","-framerate",String(FPS),"-t",String(seg)]),"-i",clip.path);
    else if(clip.kind==="GRAPHIC"){
      const [c0,c1]=(clip.palette??["0x1E3A5F","0x0F766E"]).map(c=>{if(!/^0x[0-9A-Fa-f]{6}$/.test(c))throw new Error("graphic_palette_invalid");return c});
      args.push("-f","lavfi","-t",String(seg),"-i",`gradients=s=${WIDTH}x${HEIGHT}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${WIDTH}:y1=${HEIGHT}:speed=0.006:rate=${FPS}`);
    }
    else args.push("-t",String(seg),"-i",clip.path);
  });
  const audioIndex=input.clips.length;
  if(input.voicePath)args.push("-i",input.voicePath);else args.push("-f","lavfi","-t",String(input.durationSeconds),"-i","anullsrc=channel_layout=stereo:sample_rate=48000");
  const chains=input.clips.map((clip,i)=>{
    const seg=input.durations[i];
    if(clip.kind==="IMAGE"&&clip.motion)return `${imageShot(i,clip,seg)},fps=${FPS},setsar=1,format=yuv420p,trim=duration=${seg},setpts=PTS-STARTPTS[v${i}]`;
    const fit=clip.kind==="GRAPHIC"?"null":clip.kind==="IMAGE"
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

const MAX_READING_CHARS_PER_SECOND=14,MIN_TEXT_SECONDS=1.5,MIN_TEXT_COVERAGE=.8;
/** Without narration the on-screen text carries the whole message, so it must be readable:
 * on screen long enough, at a Thai reading pace, and covering most of the clip. */
export function readabilityCheck(textEvents:ComposerCaption[],durationSeconds:number):ComposerQc{
  const events=textEvents.filter(e=>e.text.trim()).map(e=>({...e,start:Math.max(0,e.start),end:Math.min(durationSeconds,e.end)}));
  const covered=new Set<number>();for(const e of events)for(let t=Math.ceil(e.start*10);t<Math.floor(e.end*10);t++)covered.add(t);
  const coverage=covered.size/(durationSeconds*10);
  const tooFast=events.filter(e=>visibleLength(e.text)/(e.end-e.start)>MAX_READING_CHARS_PER_SECOND||e.end-e.start<MIN_TEXT_SECONDS);
  const passed=events.length>0&&coverage>=MIN_TEXT_COVERAGE&&!tooFast.length;
  return {name:"READABILITY",passed,detail:`text on screen ${(coverage*100).toFixed(0)}% of clip; ${tooFast.length} line(s) too fast or too short`};
}

export function composerQc(media:RenderedVideo,loudnessLufs:number|null,expected:{durationSeconds:number;hasVoice:boolean;audioMode?:ComposerAudioMode;textEvents?:ComposerCaption[]}):ComposerQc[]{
  const captionOnly=expected.audioMode==="CAPTION_ONLY"&&!expected.hasVoice;
  const readability=captionOnly?readabilityCheck(expected.textEvents??[],expected.durationSeconds):null;
  return [
    {name:"DURATION",passed:Math.abs(media.duration-expected.durationSeconds)<=.15,detail:`${media.duration.toFixed(2)}s`},
    {name:"RESOLUTION",passed:media.width===WIDTH&&media.height===HEIGHT,detail:`${media.width}x${media.height}`},
    {name:"AUDIO_TRACK",passed:media.hasAudio,detail:media.audioCodec??"none"},
    // A silent clip is usable only when it was planned as a text-first format and passes readability.
    {name:"VOICE",passed:expected.hasVoice||Boolean(readability?.passed),
      detail:expected.hasVoice?"narration present":captionOnly?"caption-only by plan":"no narration; owner voice or licensed TTS required"},
    ...(readability?[readability]:[]),
    {name:"LOUDNESS",passed:!expected.hasVoice||(loudnessLufs!==null&&Math.abs(loudnessLufs-LOUDNESS_TARGET)<=LOUDNESS_TOLERANCE),
      detail:loudnessLufs===null?"silent":`${loudnessLufs.toFixed(1)} LUFS (target ${LOUDNESS_TARGET}±${LOUDNESS_TOLERANCE})`},
  ];
}

/** Per-shot motion graphics: kicker and badge from the plan, an accent bar under graphic headlines,
 * and a short flash on every cut so beat changes read as edits rather than a stuttering slideshow. */
export function shotOverlays(clips:ComposerClip[],durations:number[]):ComposerOverlay[]{
  let start=0;
  return clips.flatMap((clip,i)=>{const end=start+durations[i],out:ComposerOverlay[]=[];
    if(i>0)out.push({kind:"FLASH",start,end});
    if(clip.kicker?.trim())out.push({kind:"KICKER",text:clip.kicker,start:start+.05,end:end-.05});
    if(clip.badge?.trim())out.push({kind:"BADGE",text:clip.badge,start:start+.05,end:end-.05});
    if(clip.kind==="GRAPHIC"&&clip.headline?.trim())out.push({kind:"ORB",text:i%2?"b":"a",start,end},{kind:"ACCENT",start:start+.1,end:end-.05});
    start=end;return out});
}

const MAX_STATIC_SHOT=3.5,MIN_SHOTS=3,MIN_COVERAGE=.9;
/** Editing checks a machine can verify. They catch the failures seen in pilots (a late or missing
 * hook, captions that vanish mid-clip, one still held for eight seconds); they do not judge whether
 * the clip is appealing, which still needs a person. */
export function editQc(clips:ComposerClip[],durations:number[],textEvents:ComposerCaption[],durationSeconds:number):ComposerQc[]{
  const events=textEvents.filter(e=>e.text.trim());
  const covered=new Set<number>();for(const e of events)for(let t=Math.ceil(Math.max(0,e.start)*10);t<Math.floor(Math.min(durationSeconds,e.end)*10);t++)covered.add(t);
  const coverage=covered.size/(durationSeconds*10);
  const hook=events.filter(e=>e.start<=.3).sort((a,b)=>b.end-a.end)[0];
  const longest=Math.max(...durations),varied=new Set(clips.map(c=>c.kind==="GRAPHIC"?`G${c.headline}`:`${c.assetId}:${c.motion??"clip"}`)).size;
  return [
    {name:"HOOK",passed:Boolean(hook)&&hook.end-hook.start>=1.2,detail:hook?`hook on screen ${hook.start.toFixed(1)}–${hook.end.toFixed(1)}s`:"no text in the first 0.3s"},
    {name:"TEXT_COVERAGE",passed:coverage>=MIN_COVERAGE,detail:`text on screen ${(coverage*100).toFixed(0)}% of clip (min ${MIN_COVERAGE*100}%)`},
    {name:"PACING",passed:clips.length>=MIN_SHOTS&&longest<=MAX_STATIC_SHOT+.05&&varied>=Math.min(MIN_SHOTS,clips.length),
      detail:`${clips.length} shot(s), longest ${longest.toFixed(1)}s, ${varied} distinct framing(s)`},
  ];
}

export async function composeRealMedia(input:ComposeRealMediaInput):Promise<ComposedVideo>{
  if(![8,10].includes(input.durationSeconds))throw new Error("video_duration_invalid");
  if(!input.clips.length)throw new Error("composer_requires_reviewed_media");
  if(input.clips.some(c=>c.kind!=="GRAPHIC"&&!c.path))throw new Error("composer_requires_reviewed_media");
  const binary=ffmpegBinary();if(!binary)throw new Error("ffmpeg_unavailable");
  const durations=segmentDurations(input.clips.length,input.durationSeconds,input.clips.map(c=>c.seconds));
  await mkdir(join(input.workDir,"fonts"),{recursive:true});
  await copyFile(input.fontPath??defaultThaiFontPath(),join(input.workDir,"fonts",THAI_FONT_FILE));
  const cards=input.clips.flatMap((clip,i)=>{const start=durations.slice(0,i).reduce((a,b)=>a+b,0);
    // Planned shots hold their card for the whole beat; the cut flash separates them.
    return clip.headline?.trim()?[{text:clip.headline,start:start+(clip.seconds?.04:.15),end:start+durations[i]-(clip.seconds?0:.1)}]:[]});
  await writeFile(join(input.workDir,"subtitles.ass"),buildAssSubtitles(input.captions,input.durationSeconds,cards,[...shotOverlays(input.clips,durations),...input.overlays??[]]),"utf8");
  await runFfmpeg(binary,composerArgs({clips:input.clips,durations,voicePath:input.voicePath,durationSeconds:input.durationSeconds,outputPath:input.outputPath}),input.workDir);
  const media=await new FFmpegVideoRenderer().probe(input.outputPath);
  const loudnessLufs=input.voicePath?await measureLoudness(input.outputPath):null;
  const checks=[...composerQc(media,loudnessLufs,{durationSeconds:input.durationSeconds,hasVoice:Boolean(input.voicePath),audioMode:input.audioMode,textEvents:[...cards,...input.captions]}),
    // Planned edits are held to the editing checks; legacy single-pass renders keep the technical checks only.
    ...(input.clips.every(c=>c.seconds)?editQc(input.clips,durations,[...cards,...input.captions],input.durationSeconds):[])];
  return {media,loudnessLufs,checks,passed:checks.every(c=>c.passed),provider:LOCAL_COMPOSER_PROVIDER,model:LOCAL_COMPOSER_MODEL};
}
