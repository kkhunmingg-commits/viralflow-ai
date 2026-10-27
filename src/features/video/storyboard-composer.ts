import "server-only";
/** Storyboard-driven multi-shot editor (local FFmpeg, zero provider cost).
 * Each storyboard scene is rendered with its own layout (hook type, context, product reveal, detail callout,
 * spec badge, checklist, hero, end card), cut together with planned transitions, then Thai text, disclosure
 * and credit are animated on the global timeline inside TikTok safe zones. Grading and light effects touch
 * backgrounds only: the real product photograph is scaled and moved, never recoloured or redrawn. */
import {spawn} from "node:child_process";
import {copyFile,mkdir,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {ffmpegBinary} from "./ffmpeg-binary";
import {FFmpegVideoRenderer} from "./renderer";
import {imageShot,measureLoudness,THAI_FONT_FAMILY,THAI_FONT_FILE,defaultThaiFontPath,wrapThaiCaption} from "./local-composer";
import {subjectBox} from "./story-director";
import type {Storyboard,StoryboardScene,Transition} from "../creative/storyboard";

export const STORYBOARD_COMPOSER_VERSION="storyboard-composer-v1";
const W=1080,H=1920,FPS=30,XF=.25,LOUDNESS_TARGET=-14;
/** TikTok overlays the top bar, the right-hand action rail and the caption/handle block at the bottom. */
export const TIKTOK_SAFE={top:210,bottom:1480,left:80,right:W-170};

export interface StoryboardComposeInput {
  board:Storyboard;
  /** Rights-cleared product media by asset id. */
  assets:Record<string,string>;
  /** Real Flow context clips by scene id; a missing one is replaced by a local graphic and reported. */
  aiClips?:Record<string,string>;
  narrationPath?:string; musicPath?:string;
  credit:string; workDir:string; outputPath:string; fontPath?:string;
}
export interface SceneRenderReport {sceneId:string;layout:string;background:"AI_CLIP"|"GRAPHIC"|"GRAPHIC_SUBSTITUTE_FOR_AI";productAsset:string|null}
export interface StoryboardComposeResult {
  version:string;outputPath:string;durationSeconds:number;width:number;height:number;hasAudio:boolean;loudnessLufs:number|null;
  scenes:SceneRenderReport[];audio:"NARRATION_WITH_MUSIC"|"FLOW_OR_LICENSED_MUSIC"|"LOCAL_SYNTH_MUSIC";textEvents:Array<{text:string;start:number;end:number;kind:string}>;
}

const XFADE:Record<Transition,string>={CUT:"fade",WHIP:"hblur",FADE:"fade",SLIDE_UP:"slideup",ZOOM:"zoomin"};
const GRADE:Record<Storyboard["grade"],string>={COOL:"eq=contrast=1.05:saturation=1.08,colorbalance=bs=0.06:bm=0.03",WARM:"eq=contrast=1.04:saturation=1.06,colorbalance=rs=0.07:rm=0.04",
  VIVID:"eq=contrast=1.06:saturation=1.22",MONO:"hue=s=0,eq=contrast=1.1",NEUTRAL:"eq=contrast=1.04"};
const hexOk=(c:string)=>{if(!/^0x[0-9A-Fa-f]{6}$/.test(c))throw new Error("storyboard_palette_invalid");return c};

function run(binary:string,args:string[],cwd:string,timeoutMs=240_000){
  return new Promise<string>((ok,fail)=>{const child=spawn(binary,args,{cwd,windowsHide:true,stdio:["ignore","ignore","pipe"]}),err:Buffer[]=[];let failed:Error|null=null;
    const timer=setTimeout(()=>{failed=new Error("storyboard_compose_timeout");child.kill()},timeoutMs);
    child.stderr.on("data",d=>err.push(Buffer.from(d)));child.on("error",e=>{failed=e});
    child.on("close",code=>{clearTimeout(timer);const s=Buffer.concat(err).toString();if(failed||code!==0)fail(failed??new Error(`storyboard_compose_failed: ${s.slice(-700)}`));else ok(s)})});
}

/** Product card geometry per layout: size and resting top-left y, centred horizontally. */
const CARD:Partial<Record<StoryboardScene["layout"],{size:number;y:number}>>={PRODUCT_REVEAL:{size:800,y:340},SPEC_BADGE:{size:620,y:720},CHECKLIST:{size:560,y:340},
  HERO_LIGHT_SWEEP:{size:840,y:340},END_CARD:{size:580,y:340}};

/** One scene's ffmpeg arguments. Inputs: 0 = background (gradient or AI clip), 1 = product photo when used. */
export function sceneArgs(scene:StoryboardScene,seconds:number,grade:Storyboard["grade"],paths:{product?:string;aiClip?:string;subject?:{x:number;y:number;w:number;h:number}},out:string){
  const args=["-nostdin","-hide_banner","-loglevel","error","-y"],L=seconds.toFixed(3),n=Math.max(1,Math.round(seconds*FPS));
  const palette=scene.background.kind==="GRAPHIC"?scene.background.palette:[`0x${scene.palette[0].slice(1)}`,`0x${scene.palette[1].slice(1)}`] as [string,string];
  if(paths.aiClip)args.push("-ss","0.4","-t",L,"-i",paths.aiClip);
  else args.push("-f","lavfi","-t",L,"-i",`gradients=s=${W}x${H}:c0=${hexOk(palette[0])}:c1=${hexOk(palette[1])}:x0=0:y0=0:x1=${W}:y1=${H}:speed=0.012:rate=${FPS}`);
  // Layouts without a product card show the photograph full-frame: a punch-in or pan for details, a framed push otherwise.
  const detail=Boolean(scene.product)&&!CARD[scene.layout],closeUp=scene.product?.framing==="DETAIL";
  if(scene.product&&paths.product)args.push(...(detail?[]:["-loop","1","-framerate",String(FPS),"-t",L]),"-i",paths.product);
  // Background: fit, grade, vignette and light accents. Product pixels are never in this chain.
  const sweep=scene.layout==="HERO_LIGHT_SWEEP"?`,drawbox=x='-420+(iw+840)*t/${L}':y=0:w=260:h=ih:color=white@0.13:t=fill`:"";
  const accents=scene.layout==="KINETIC_TYPE"||scene.layout==="CHECKLIST"?`,drawbox=x='mod(t*260,1500)-400':y=1560:w=340:h=8:color=white@0.30:t=fill,drawbox=x='1080-mod(t*180,1500)':y=190:w=220:h=6:color=white@0.22:t=fill`:"";
  const bg=`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},${GRADE[grade]},vignette=PI/5${sweep}${accents}`;
  let graph:string;
  if(detail&&paths.product){
    const motion=!closeUp?"PUSH_IN":scene.camera==="MACRO_PAN"?"PAN":"DETAIL";
    // Darken only a band behind the caption area; the product region itself is left untouched.
    graph=`${imageShot(1,{assetId:"p",path:paths.product,kind:"IMAGE",motion,layout:closeUp?"FULL_BLEED":"FRAMED",subject:paths.subject},seconds)},setsar=1,drawbox=y=1180:w=iw:h=380:color=black@0.38:t=fill,format=yuv420p,trim=duration=${L}[v]`;
  }else if(scene.product&&paths.product&&CARD[scene.layout]){
    const {size,y}=CARD[scene.layout]!,rise=scene.camera==="RISE_REVEAL"?`+460*pow(max(0,1-t/0.55),3)`:scene.camera==="PULL_BACK"?`+40*t/${L}`:`-36*t/${L}`;
    graph=[`${bg}[bg]`,`[1:v]scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=iw+28:ih+28:14:14:white,setsar=1,format=yuva420p,split[card][sh]`,
      `[sh]lutrgb=r=0:g=0:b=0,colorchannelmixer=aa=0.42,boxblur=22:2[shadow]`,
      `[bg][shadow]overlay=x='(W-w)/2+22':y='${y+30}${rise}':shortest=1[b1]`,
      // Subtle whole-frame push or pull after compositing keeps the product proportions intact.
      `[b1][card]overlay=x='(W-w)/2':y='${y}${rise}':shortest=1,scale=${W*2}:${H*2},zoompan=z='${scene.camera==="PULL_BACK"?`1.06-0.06*on/${n}`:`1+0.045*on/${n}`}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p,trim=duration=${L}[v]`].join(";");
  }else graph=`${bg},format=yuv420p,trim=duration=${L}[v]`;
  args.push("-filter_complex",graph,"-map","[v]","-an","-r",String(FPS),"-c:v","libx264","-preset","veryfast","-crf","16","-pix_fmt","yuv420p",out);
  return args;
}

const assTime=(s:number)=>{const cs=Math.round(Math.max(0,s)*100);return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,"0")}:${String(Math.floor(cs/100)%60).padStart(2,"0")}.${String(cs%100).padStart(2,"0")}`};
const clean=(t:string)=>t.replace(/[{}\\]/g,"").replace(/[\r\n]+/g," ").trim();
const wrap=(t:string,max:number,lines:number)=>{for(let m=max;m<=max+8;m+=2){try{return wrapThaiCaption(clean(t),m,lines).join("\\N")}catch{/* widen */}}return clean(t).slice(0,max*lines)};
const accent=(t:string)=>t.replace(/([0-9][0-9.,%]*)/g,"{\\c&H2EC8FF&}$1{\\c&HFFFFFF&}");

/** Text layer for the whole edit: every line is positioned per layout inside the safe zone and animated in. */
export function storyboardAss(board:Storyboard,credit:string){
  const ev:Array<{text:string;start:number;end:number;kind:string}>=[],lines:string[]=[];
  const add=(kind:string,style:string,s:number,e:number,x:number,y:number,text:string,anim:string)=>{if(!text.trim()||e<=s)return;
    ev.push({text:text.replace(/\{[^}]*\}/g,"").replace(/\\N/g," "),start:s,end:e,kind});lines.push(`Dialogue: 2,${assTime(s)},${assTime(e)},${style},,0,0,0,,{\\an5\\pos(${x},${y})${anim}}${text}`)};
  const POP="\\fad(90,70)\\fscx82\\fscy82\\t(0,180,\\fscx100\\fscy100)",RISE=(x:number,y:number)=>`\\fad(120,70)\\move(${x},${y+50},${x},${y},0,260)`;
  const cx=Math.round((TIKTOK_SAFE.left+TIKTOK_SAFE.right)/2);
  // Vector motion graphics (ASS drawings): an expanding ring and an underline that grows under the hook.
  const r=300,k=Math.round(r*.55),ring=`m 0 ${-r} b ${k} ${-r} ${r} ${-k} ${r} 0 b ${r} ${k} ${k} ${r} 0 ${r} b ${-k} ${r} ${-r} ${k} ${-r} 0 b ${-r} ${-k} ${-k} ${-r} 0 ${-r}`;
  const shape=(s:number,e:number,x:number,y:number,tags:string,path:string)=>lines.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Shape,,0,0,0,,{\\an7\\pos(${x},${y})${tags}\\p1}${path}{\\p0}`);
  for(const s of board.scenes){
    const t0=s.start+.06,t1=s.end-(s===board.scenes.at(-1)?0:.02),o=s.onScreen;
    switch(s.layout){
      case "KINETIC_TYPE":case "CONTEXT_FULL":
        shape(s.start,s.end,cx,860,"\\alpha&H60&\\1a&HFF&\\3c&H2EC8FF&\\bord10\\fscx40\\fscy40\\t(0,700,\\fscx118\\fscy118)",ring);
        shape(s.start+.2,s.end,cx-220,1060,"\\1c&H2EC8FF&\\fscx0\\t(0,380,\\fscx100)","m 0 0 l 440 0 440 14 0 14");
        add("HOOK","Hook",t0,t1,cx,860,accent(wrap(o.headline,12,3)),POP);if(o.sub)add("SUB","Sub",t0+.25,t1,cx,1130,wrap(o.sub,20,2),RISE(cx,1130));break;
      case "PRODUCT_REVEAL":add("HEADLINE","Headline",t0+.3,t1,cx,1260,wrap(o.headline,18,1),`\\fad(120,70)\\move(${cx},1310,${cx},1260,300,560)`);
        if(o.sub)add("BENEFIT","Sub",t0+.55,t1,cx,1375,accent(wrap(o.sub,20,2)),RISE(cx,1375));break;
      case "SPEC_BADGE":if(o.badge)add("BADGE","Badge",t0+.1,t1,cx,420,accent(clean(o.badge)),POP);add("HEADLINE","Headline",t0+.3,t1,cx,600,accent(wrap(o.headline,18,2)),RISE(cx,600));break;
      case "CALLOUT_DETAIL":add("CALLOUT","Callout",t0+.1,t1,cx,1300,accent(wrap(o.headline,15,2)),POP);break;
      case "CHECKLIST":add("HEADLINE","Headline",t0,t1,cx,1000,wrap(o.headline,16,1),POP);
        (o.checklist??[]).slice(0,4).forEach((item,i)=>add("CHECK","Check",t0+.3+i*.35,t1,cx,1130+i*112,`✓ ${accent(wrap(item,20,1))}`,RISE(cx,1130+i*112)));break;
      case "HERO_LIGHT_SWEEP":case "END_CARD":{const y=s.layout==="END_CARD"?1040:1280;
        add("HEADLINE","Headline",t0+.1,t1,cx,y,wrap(o.headline,18,1),POP);if(o.sub)add("CTA","Cta",t0+.45,t1,cx,y+120,wrap(o.sub,22,1),RISE(cx,y+120));break;}
    }
  }
  const end=board.durationSeconds;
  // Disclosure and licence credit sit in a slim band under the app's top bar, clear of every layout.
  add("DISCLOSURE","Disclosure",0,end,cx,TIKTOK_SAFE.top+18,clean(board.disclosure),"");
  add("CREDIT","Credit",0,end,cx,TIKTOK_SAFE.top+60,wrap(credit,64,2),"");
  const st=(name:string,size:number,colour:string,outline:number,border:1|3,back="&H66000000",bold=-1)=>`Style: ${name},${THAI_FONT_FAMILY},${size},${colour},&H00FFFFFF,&H00221A12,${back},${bold},0,0,0,100,100,0,0,${border},${outline},2,5,0,0,0,222`;
  const ass=["[Script Info]","ScriptType: v4.00+",`PlayResX: ${W}`,`PlayResY: ${H}`,"WrapStyle: 2","ScaledBorderAndShadow: yes","","[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    st("Hook",124,"&H00FFFFFF",7,1),st("Sub",62,"&H00FFFFFF",4,1),st("Headline",94,"&H00FFFFFF",5,1),st("Badge",240,"&H002EC8FF",8,1),
    `Style: Callout,${THAI_FONT_FAMILY},84,&H00FFFFFF,&H00FFFFFF,&H00121212,&H70121212,-1,0,0,0,100,100,0,0,3,18,0,5,0,0,0,222`,st("Check",66,"&H00FFFFFF",4,1),`Style: Shape,${THAI_FONT_FAMILY},20,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,222`,
    `Style: Cta,${THAI_FONT_FAMILY},62,&H00111111,&H00FFFFFF,&H002EC8FF,&H002EC8FF,-1,0,0,0,100,100,0,0,3,18,0,5,0,0,0,222`,
    // Translucent box behind the small print so it stays legible over a full-frame product shot.
    `Style: Disclosure,${THAI_FONT_FAMILY},30,&H00FFFFFF,&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,3,8,0,5,0,0,0,222`,
    `Style: Credit,${THAI_FONT_FAMILY},22,&H00E6E6E6,&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,3,6,0,5,0,0,0,222`,"","[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",...lines,""].join("\n");
  return {ass,events:ev};
}

/** Locally synthesised music bed (sine pad with a soft pulse): no third-party licence involved. */
const SYNTH_PAD=(d:number)=>`aevalsrc='0.10*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*2*t))+0.07*sin(2*PI*277.18*t)+0.06*sin(2*PI*329.63*t)+0.05*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*1*t))|0.10*sin(2*PI*220.6*t)*(0.55+0.45*sin(2*PI*2*t))+0.07*sin(2*PI*277.9*t)+0.06*sin(2*PI*330.2*t)+0.05*sin(2*PI*110*t)':s=48000:d=${d}`;

export async function composeStoryboard(input:StoryboardComposeInput):Promise<StoryboardComposeResult>{
  const board=input.board,D=board.durationSeconds,binary=ffmpegBinary();if(!binary)throw new Error("ffmpeg_unavailable");
  const outputs=[input.outputPath,input.workDir].map(p=>resolve(p));
  if(process.platform==="win32"&&outputs.some(p=>!/^D:\\/i.test(p)))throw new Error("STORYBOARD_EDIT_REQUIRES_DRIVE_D");
  for(const s of board.scenes)if(s.product&&!input.assets[s.product.assetId])throw new Error(`STORYBOARD_ASSET_MISSING:${s.product.assetId}`);
  await mkdir(join(input.workDir,"fonts"),{recursive:true});await copyFile(input.fontPath??defaultThaiFontPath(),join(input.workDir,"fonts",THAI_FONT_FILE));
  const reports:SceneRenderReport[]=[],segments:string[]=[];
  for(const [i,s] of board.scenes.entries()){
    const seconds=s.end-s.start+(i<board.scenes.length-1?XF:0),product=s.product?input.assets[s.product.assetId]:undefined;
    const aiClip=s.background.kind==="AI_SCENE"?input.aiClips?.[s.id]:undefined,out=join(input.workDir,`scene-${i+1}.mp4`);
    // Without its Flow clip, a context scene becomes kinetic type on a graded gradient, and the report says so.
    const scene:StoryboardScene=s.background.kind==="AI_SCENE"&&!aiClip?{...s,layout:s.layout==="CONTEXT_FULL"?"KINETIC_TYPE":s.layout,background:{kind:"GRAPHIC",palette:[`0x${s.palette[0].slice(1)}`,`0x${s.palette[1].slice(1)}`]}}:s;
    const subject=product&&s.product?.framing==="DETAIL"?await subjectBox(product):undefined;
    await run(binary,sceneArgs(scene,seconds,board.grade,{product,aiClip,subject},out),input.workDir);
    segments.push(out);reports.push({sceneId:s.id,layout:scene.layout,background:aiClip?"AI_CLIP":s.background.kind==="AI_SCENE"?"GRAPHIC_SUBSTITUTE_FOR_AI":"GRAPHIC",productAsset:s.product?.assetId??null});
  }
  // The disclosure describes what was actually rendered, not what was planned.
  const usedAi=reports.some(r=>r.background==="AI_CLIP");
  const {ass,events}=storyboardAss({...board,disclosure:usedAi?"ภาพสินค้าจริง · ฉากประกอบบางส่วนสร้างด้วย AI":"ภาพสินค้าจริง · กราฟิกประกอบ"},input.credit);await writeFile(join(input.workDir,"storyboard.ass"),ass,"utf8");
  const chain:string[]=[];let last="0:v";
  board.scenes.slice(1).forEach((s,k)=>{const label=`x${k+1}`;chain.push(`[${last}][${k+1}:v]xfade=transition=${XFADE[s.transitionIn]}:duration=${XF}:offset=${s.start.toFixed(3)}[${label}]`);last=label});
  const video=join(input.workDir,"video.mp4");
  await run(binary,["-nostdin","-hide_banner","-loglevel","error","-y",...segments.flatMap(p=>["-i",p]),"-filter_complex",
    `${chain.join(";")}${chain.length?";":""}[${last}]ass=storyboard.ass:fontsdir=fonts,format=yuv420p[v]`,"-map","[v]","-t",String(D),"-r",String(FPS),"-c:v","libx264","-preset","medium","-crf","19","-pix_fmt","yuv420p",video],input.workDir);
  // Audio: music bed, ducked under narration when there is one, then set to the loudness target.
  const mix=join(input.workDir,"mix.wav"),audioArgs=["-nostdin","-hide_banner","-loglevel","error","-y"];
  if(input.musicPath)audioArgs.push("-stream_loop","-1","-i",input.musicPath);else audioArgs.push("-f","lavfi","-i",SYNTH_PAD(D));
  if(input.narrationPath)audioArgs.push("-i",input.narrationPath);
  const music=`[0:a]aresample=48000,aformat=channel_layouts=stereo,lowpass=f=5200,volume=${input.narrationPath?"0.55":"1"},afade=t=in:d=0.4,atrim=0:${D}`;
  audioArgs.push("-filter_complex",input.narrationPath
    ?`${music}[m];[1:a]aresample=48000,aformat=channel_layouts=stereo,acompressor=threshold=0.125:ratio=3:attack=5:release=120,apad,atrim=0:${D},asplit[v1][v2];[m][v1]sidechaincompress=threshold=0.04:ratio=8:attack=15:release=280[duck];[duck][v2]amix=inputs=2:normalize=0,afade=t=out:st=${(D-.35).toFixed(2)}:d=0.35[a]`
    :`${music},afade=t=out:st=${(D-.5).toFixed(2)}:d=0.5[a]`,"-map","[a]","-t",String(D),"-c:a","pcm_s16le",mix);
  await run(binary,audioArgs,input.workDir);
  const measured=await measureLoudness(mix),gain=measured===null?0:Math.max(-20,Math.min(30,LOUDNESS_TARGET-measured));
  await run(binary,["-nostdin","-hide_banner","-loglevel","error","-y","-i",video,"-i",mix,"-filter_complex",`[1:a]volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=false[a]`,
    "-map","0:v","-map","[a]","-t",String(D),"-c:v","copy","-c:a","aac","-b:a","160k","-ar","48000","-movflags","+faststart",resolve(input.outputPath)],input.workDir);
  const media=await new FFmpegVideoRenderer().probe(input.outputPath);
  return {version:STORYBOARD_COMPOSER_VERSION,outputPath:input.outputPath,durationSeconds:media.duration,width:media.width,height:media.height,hasAudio:media.hasAudio,
    loudnessLufs:await measureLoudness(input.outputPath),scenes:reports,audio:input.narrationPath?"NARRATION_WITH_MUSIC":input.musicPath?"FLOW_OR_LICENSED_MUSIC":"LOCAL_SYNTH_MUSIC",textEvents:events};
}
