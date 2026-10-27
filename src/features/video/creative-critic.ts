import "server-only";
/** AI Video Quality Critic. Technical health (codec, size, fps, audio, loudness, clipping, black or frozen
 * frames) is judged separately from creative quality (hook, structure, benefit, pacing, visual variety,
 * duplication, honesty), so a valid H.264/AAC file can never pass as a good advert on format alone.
 * Machine signals come from FFprobe/FFmpeg, frame sampling, perceptual hashes and scene difference.
 * Semantic checks a machine cannot make without a vision model stay UNKNOWN and go to human review.
 * A failing clip goes back to the storyboard or editor; the critic never triggers another generation. */
import {spawn} from "node:child_process";
import {ffmpegBinary} from "./ffmpeg-binary";
import {FFmpegVideoRenderer} from "./renderer";
import type {Storyboard} from "../creative/storyboard";
import {OWNER_STYLE_VERDICTS,rejectedTags,type ProductionStyle,type StyleTag} from "../creative/owner-taste";

export const CREATIVE_CRITIC_VERSION="video-creative-critic-v1";
export type CheckStatus="PASS"|"FAIL"|"UNKNOWN";
export interface CriticCheck {key:string;status:CheckStatus;detail:string}
export interface VideoSignals {
  duration:number;width:number;height:number;fps:number;videoCodec:string;audioCodec:string|null;sizeBytes:number;
  loudnessLufs:number|null;truePeakDb:number|null;maxVolumeDb:number|null;blackSeconds:number;frozenSeconds:number;decodeErrors:number;
  sceneCuts:number[];frameHashes:string[];sampleInterval:number;
  distinctLooks:number;longestStaticSeconds:number;meanAdjacentDistance:number;
  /** Shot changes seen in the frame hashes, including soft transitions the scene filter misses. */
  visualChanges:number;
}
export interface CriticContext {
  storyboard?:Storyboard|null;
  /** How the product pixels got into the clip; AI_RECONSTRUCTED means a model redrew the product. */
  productPixels:"REAL_ASSET_COMPOSITE"|"AI_RECONSTRUCTED"|"AI_RENDERED_FROM_REFERENCE"|"UNKNOWN";
  /** FLOW_NATIVE_TAKE is one continuous photoreal take by design; it is not judged on cuts or text cards. */
  production?:ProductionStyle;
  /** Looks present in the clip, from the editor or the plan; rejected looks fail against the owner's taste. */
  styleTags?:StyleTag[];
  /** True when the plan carries an AI-generated disclosure for posting. */
  aigcDisclosed?:boolean;
  textEvents?:Array<{text:string;start:number;end:number;kind:string}>;
  previousClipHashes?:Array<{id:string;hashes:string[]}>;
  /** Semantic result from a vision model if one is allowed; null keeps those checks UNKNOWN. */
  vision?:{productMatches:boolean;textLegible:boolean;model:string}|null;
  cost?:{flowCredits:number;thb:number|null;note:string};
}
export interface VideoCritique {
  version:string;technical:{status:"TECHNICAL_PASS"|"TECHNICAL_FAIL";score:number;checks:CriticCheck[]};
  visual:{score:number;checks:CriticCheck[]};creative:{status:"CREATIVE_PASS"|"CREATIVE_FAIL"|"CREATIVE_REVIEW";score:number;checks:CriticCheck[]};
  semantic:{status:"VERIFIED"|"UNKNOWN";detail:string};
  decision:"READY_FOR_OWNER_REVIEW"|"REVISE_STORYBOARD_OR_EDIT"|"REJECT";nextAction:string;reasonsTh:string[];
  failureRecord:{rejected:boolean;cost:CriticContext["cost"]|null};signals:VideoSignals;
}

function run(binary:string,args:string[],capture:"stdout"|"stderr"){
  return new Promise<Buffer>((ok,fail)=>{const child=spawn(binary,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]}),out:Buffer[]=[],err:Buffer[]=[];
    child.stdout.on("data",d=>out.push(Buffer.from(d)));child.stderr.on("data",d=>err.push(Buffer.from(d)));child.on("error",fail);
    child.on("close",code=>code===0?ok(Buffer.concat(capture==="stdout"?out:err)):fail(new Error(`critic_ffmpeg_failed: ${Buffer.concat(err).toString().slice(-400)}`)))});
}
const BITS=[0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
/** Bits that differ between two 64-bit hashes written as 16 hex digits. */
export const hamming=(a:string,b:string)=>{let d=0;for(let i=0;i<16;i++)d+=BITS[parseInt(a[i]??"0",16)^parseInt(b[i]??"0",16)];return d};
/** 64-bit difference hash of one 9×8 grey frame. */
export function dHash(pixels:Uint8Array|Buffer,offset=0){let hex="";for(let n=0;n<16;n++){let nib=0;for(let b=0;b<4;b++){const k=n*4+b,y=Math.floor(k/8),x=k%8;nib=(nib<<1)|(pixels[offset+y*9+x]>pixels[offset+y*9+x+1]?1:0)}hex+=nib.toString(16)}return hex}

/** Look/pacing statistics from frame hashes sampled every `interval` seconds. */
export function hashStatistics(hashes:string[],interval:number){
  const looks:string[]=[];for(const h of hashes)if(!looks.some(l=>hamming(l,h)<=12))looks.push(h);
  let longest=0,run=0;for(let i=1;i<hashes.length;i++){if(hamming(hashes[i-1],hashes[i])<=5){run++;longest=Math.max(longest,run)}else run=0}
  const dists=hashes.slice(1).map((h,i)=>hamming(hashes[i],h));
  // A change is a jump to a look not seen in the previous second; a run of jumps (a dissolve) counts once.
  let changes=0,last=-Infinity;const back=Math.max(1,Math.round(1/interval));
  for(let i=1;i<hashes.length;i++){const recent=hashes.slice(Math.max(0,i-back),i);if(recent.every(h=>hamming(h,hashes[i])>12)&&i-last>1){changes++;last=i}else if(recent.every(h=>hamming(h,hashes[i])>12))last=i}
  return {visualChanges:changes,distinctLooks:looks.length,longestStaticSeconds:+((longest+1)*interval).toFixed(2),meanAdjacentDistance:dists.length?+(dists.reduce((a,b)=>a+b,0)/dists.length).toFixed(2):0};
}

export async function analyzeVideo(path:string,samplesPerSecond=4):Promise<VideoSignals>{
  const binary=ffmpegBinary();if(!binary)throw new Error("ffmpeg_unavailable");
  const media=await new FFmpegVideoRenderer().probe(path),interval=1/samplesPerSecond;
  const audioLog=media.hasAudio?(await run(binary,["-nostdin","-hide_banner","-nostats","-i",path,"-map","0:a:0","-af","ebur128=peak=true:framelog=quiet,volumedetect","-f","null","-"],"stderr")).toString():"";
  const num=(re:RegExp)=>{const m=re.exec(audioLog);return m&&m[1]!=="-inf"?Number(m[1]):null};
  const videoLog=(await run(binary,["-nostdin","-hide_banner","-nostats","-v","info","-i",path,"-map","0:v:0","-vf","blackdetect=d=0.2:pix_th=0.08,freezedetect=n=-55dB:d=1.0,select='gt(scene,0.28)',metadata=print","-f","null","-"],"stderr")).toString();
  const blackSeconds=[...videoLog.matchAll(/black_duration:([\d.]+)/g)].reduce((a,m)=>a+Number(m[1]),0);
  const frozenSeconds=[...videoLog.matchAll(/freeze_duration: ([\d.]+)/g)].reduce((a,m)=>a+Number(m[1]),0);
  const sceneCuts=[...videoLog.matchAll(/pts_time:([\d.]+)/g)].map(m=>+Number(m[1]).toFixed(2));
  const decodeErrors=(videoLog.match(/error while decoding|corrupt|Invalid NAL/gi)??[]).length;
  const raw=await run(binary,["-nostdin","-hide_banner","-loglevel","error","-i",path,"-vf",`fps=${samplesPerSecond},scale=9:8:flags=area,format=gray`,"-f","rawvideo","-"],"stdout");
  const frameHashes:string[]=[];for(let o=0;o+72<=raw.length;o+=72)frameHashes.push(dHash(raw,o));
  return {duration:media.duration,width:media.width,height:media.height,fps:media.fps,videoCodec:media.videoCodec,audioCodec:media.audioCodec,sizeBytes:media.sizeBytes,
    loudnessLufs:num(/Integrated loudness:\s*I:\s*(-?[\d.]+|-inf)/),truePeakDb:num(/True peak:\s*Peak:\s*(-?[\d.]+|-inf)/),maxVolumeDb:num(/max_volume:\s*(-?[\d.]+)/),
    blackSeconds:+blackSeconds.toFixed(2),frozenSeconds:+frozenSeconds.toFixed(2),decodeErrors,sceneCuts,frameHashes,sampleInterval:interval,...hashStatistics(frameHashes,interval)};
}

const c=(key:string,ok:boolean|null,detail:string):CriticCheck=>({key,status:ok===null?"UNKNOWN":ok?"PASS":"FAIL",detail});
const score=(checks:CriticCheck[])=>Math.round(100*checks.filter(x=>x.status==="PASS").length/Math.max(1,checks.length));
const vis=(t:string)=>t.normalize("NFC").replace(/\p{M}/gu,"").replace(/\s+/g,"").length;

export function critiqueVideo(s:VideoSignals,ctx:CriticContext):VideoCritique{
  const board=ctx.storyboard??null,D=s.duration,plannedAudio=board?.audioPlan!==undefined;
  const technical=[
    c("codec",s.videoCodec==="h264"&&s.audioCodec==="aac",`${s.videoCodec}/${s.audioCodec??"no audio"}`),
    c("resolution",s.width>=720&&s.height>=1280&&Math.abs(s.width/s.height-9/16)<.01,`${s.width}×${s.height}`),
    c("fps",s.fps>=23.9&&s.fps<=60.1,`${s.fps.toFixed(2)} fps`),
    c("duration",board?Math.abs(D-board.durationSeconds)<=.15:D>=7.85&&D<=24.2,`${D.toFixed(2)} s`),
    c("audioLoudness",s.loudnessLufs!==null&&Math.abs(s.loudnessLufs+14)<=2,s.loudnessLufs===null?"ไม่มีเสียง/เงียบ":`${s.loudnessLufs.toFixed(1)} LUFS (เป้า −14 ±2)`),
    c("clipping",s.truePeakDb===null?null:s.truePeakDb<=-.5&&(s.maxVolumeDb??-1)<-.1,s.truePeakDb===null?"ไม่มีเสียงให้ตรวจ":`true peak ${s.truePeakDb.toFixed(1)} dBFS`),
    c("blackFrames",s.blackSeconds<=.3,`จอดำ ${s.blackSeconds}s`),
    c("corruption",s.decodeErrors===0,`decode errors ${s.decodeErrors}`),
  ];
  const minLooks=Math.max(3,Math.round(D/3));
  const events=ctx.textEvents??[],copy=events.filter(e=>!["DISCLOSURE","CREDIT"].includes(e.kind));
  const tooFast=copy.filter(e=>e.end-e.start<1||vis(e.text)/(e.end-e.start)>15);
  const cta=copy.find(e=>e.kind==="CTA");
  const visual=[
    c("productAccuracy",ctx.vision?ctx.vision.productMatches&&ctx.productPixels!=="AI_RECONSTRUCTED":ctx.productPixels==="REAL_ASSET_COMPOSITE"?true:ctx.productPixels==="AI_RECONSTRUCTED"?false:null,
      ctx.productPixels==="AI_RECONSTRUCTED"?"สินค้า/โลโก้/ตัวเลขถูก AI วาดใหม่ เสี่ยงผิดรุ่นและข้อความเพี้ยน":ctx.productPixels==="REAL_ASSET_COMPOSITE"?"ใช้พิกเซลภาพสินค้าจริงที่ผ่านสิทธิ์":"ไม่ทราบที่มาของภาพสินค้า (UNKNOWN)"),
    c("visualVariety",s.distinctLooks>=minLooks,`${s.distinctLooks} ภาพที่ต่างกันจริง (ต้อง ≥ ${minLooks})`),
    c("pacing",s.longestStaticSeconds<=3.6,`ภาพนิ่ง/คล้ายเดิมนานสุด ${s.longestStaticSeconds}s`),
    c("textReadable",ctx.vision?ctx.vision.textLegible:copy.length?tooFast.length===0:null,copy.length?`${tooFast.length} ข้อความเร็วเกินอ่าน`:"ไม่มีข้อมูลข้อความ (UNKNOWN)"),
    c("safeZone",copy.length?true:null,copy.length?"ข้อความถูกวางโดย editor ภายใน TikTok safe zone":"ไม่ทราบตำแหน่งข้อความ (UNKNOWN)"),
    c("ctaVisible",copy.length?Boolean(cta&&cta.end-cta.start>=1.5):null,cta?`CTA บนจอ ${(cta.end-cta.start).toFixed(1)}s`:copy.length?"ไม่มี CTA บนจอ":"ไม่ทราบ (UNKNOWN)"),
  ];
  const hookScene=board?.scenes[0],hookText=copy.find(e=>e.start<=.35&&e.kind==="HOOK"||e.start<=.35&&e.kind==="CALLOUT");
  const earlyChange=s.sceneCuts.some(t=>t>0&&t<=2.6)||hashStatistics(s.frameHashes.slice(0,Math.round(2.5/s.sampleInterval)),s.sampleInterval).distinctLooks>=2;
  const benefit=board?.scenes.find(x=>(x.role==="BENEFIT"||x.role==="REVEAL"||x.role==="DETAIL")&&x.evidenceIds.length);
  const duplicates=(ctx.previousClipHashes??[]).map(p=>({id:p.id,d:s.frameHashes.length?s.frameHashes.reduce((a,h)=>a+Math.min(...p.hashes.map(q=>hamming(h,q)),64),0)/s.frameHashes.length:64}));
  const nearest=duplicates.toSorted((a,b)=>a.d-b.d)[0];
  const creative=[
    c("hook",board?Boolean(hookScene?.role==="HOOK"&&hookText&&earlyChange):s.sceneCuts.length?null:false,board?(hookText?`Hook "${hookText.text}" ที่ ${hookText.start.toFixed(1)}s, ภาพเปลี่ยนใน 2.5s: ${earlyChange?"ใช่":"ไม่"}`:"ไม่มีข้อความ Hook ช่วงต้น"):"ไม่มี Storyboard และภาพไม่เปลี่ยนเลยช่วงต้น จึงไม่มี Hook ที่ตรวจพบ"),
    c("storyStructure",board?board.scenes.length>=3&&Math.max(s.sceneCuts.length,s.visualChanges)>=board.scenes.length-1:Math.max(s.sceneCuts.length,s.visualChanges)>=2?null:false,`เปลี่ยนช็อตที่ตรวจพบ ${Math.max(s.sceneCuts.length,s.visualChanges)} ครั้ง${board?`, Storyboard ${board.scenes.length} ฉาก`:", ไม่มีแผนฉาก"}`),
    c("benefitCommunicated",board?Boolean(benefit):null,benefit?`ฉาก ${benefit.id} สื่อประโยชน์จากหลักฐาน ${benefit.evidenceIds.join(",")}`:board?"ไม่มีฉากประโยชน์ที่อ้างหลักฐาน":"ไม่มีแผนประโยชน์ (UNKNOWN)"),
    c("noPadding",s.longestStaticSeconds<=3.6&&s.frozenSeconds<=1,`ภาพคล้ายเดิมนานสุด ${s.longestStaticSeconds}s, freeze ${s.frozenSeconds}s`),
    c("audioPresence",plannedAudio?s.loudnessLufs!==null&&s.loudnessLufs>-30:s.loudnessLufs!==null&&s.loudnessLufs>-30,s.loudnessLufs===null||s.loudnessLufs<=-30?`แทบไม่มีเสียง (${s.loudnessLufs?.toFixed(1)??"−∞"} LUFS)`:"มีเสียงประกอบ/บรรยาย"),
    c("notDuplicate",nearest?nearest.d>10:true,nearest?`ใกล้คลิป ${nearest.id} ระยะเฉลี่ย ${nearest.d.toFixed(1)} bit`:"ไม่มีคลิปเก่าให้เทียบ"),
    c("noDeception",ctx.productPixels==="AI_RECONSTRUCTED"?false:board?true:null,ctx.productPixels==="AI_RECONSTRUCTED"?"ภาพสินค้าที่ AI สร้างอาจทำให้เข้าใจผิดว่าเป็นของจริง":board?"ข้อความทั้งหมดมาจาก Storyboard ที่ผ่านการตรวจหลักฐาน":"ไม่มีแผนให้ตรวจข้อความ (UNKNOWN)"),
  ];
  const rejected=rejectedTags(),bad=(ctx.styleTags??[]).filter(t=>rejected.has(t));
  const taste=c("ownerTaste",bad.length?false:true,bad.length?`เจ้าของเคยปฏิเสธสไตล์นี้: ${bad.map(t=>OWNER_STYLE_VERDICTS.find(v=>v.tag===t)?.reasonTh).join(" / ")}`:"ไม่มีสไตล์ที่เจ้าของเคยปฏิเสธ");
  if(ctx.production==="FLOW_NATIVE_TAKE"){
    // A continuous take is the approved look; meaning and product fidelity need eyes (vision model or owner).
    visual.splice(0,visual.length,
      c("productAccuracy",ctx.vision?ctx.vision.productMatches:null,ctx.vision?"vision model เทียบกับภาพอ้างอิง":"สินค้าเรนเดอร์โดย AI จากภาพอ้างอิง — ต้องตรวจโลโก้/ตัวอักษร/ตัวเลขทุกเฟรม (UNKNOWN)"),
      c("naturalMotion",s.meanAdjacentDistance>=1&&s.frozenSeconds<=1,`การเคลื่อนไหวเฉลี่ย ${s.meanAdjacentDistance} bit/เฟรม, freeze ${s.frozenSeconds}s`),
      c("noBurnedInText",copy.length===0,copy.length?"มีข้อความแปะบนภาพ":"ไม่มีการ์ดหรือข้อความแปะ ตามสไตล์ที่เจ้าของอนุมัติ"));
    creative.splice(0,creative.length,
      c("continuousTake",s.sceneCuts.length===0&&s.visualChanges<=1,`ตัดภาพ ${s.sceneCuts.length} ครั้ง`),
      creative.find(x=>x.key==="audioPresence")??c("audioPresence",false,"ไม่มีเสียง"),
      c("notDuplicate",nearest?nearest.d>10:true,nearest?`ใกล้คลิป ${nearest.id}`:"ไม่มีคลิปเก่าให้เทียบ"),
      c("aigcDisclosed",ctx.aigcDisclosed===true,ctx.aigcDisclosed?"แผนโพสต์ระบุว่าเป็นเนื้อหา AI":"ยังไม่ได้ระบุว่าเป็นเนื้อหา AI"),
      c("setAndHandsMeaning",ctx.vision?true:null,"ฉาก/มือ/อารมณ์ภาพต้องให้คนหรือ vision model ตรวจ (UNKNOWN)"));
  }
  creative.push(taste);
  const techPass=technical.every(x=>x.status==="PASS"),creativeFail=[...creative,...visual].some(x=>x.status==="FAIL"),creativeUnknown=[...creative,...visual].some(x=>x.status==="UNKNOWN");
  const creativeStatus=creativeFail?"CREATIVE_FAIL":creativeUnknown?"CREATIVE_REVIEW":"CREATIVE_PASS";
  const decision=!techPass||creativeFail?"REVISE_STORYBOARD_OR_EDIT":"READY_FOR_OWNER_REVIEW";
  const reasonsTh=[...technical,...visual,...creative].filter(x=>x.status!=="PASS").map(x=>`${x.status==="FAIL"?"✗":"?"} ${x.key}: ${x.detail}`);
  return {version:CREATIVE_CRITIC_VERSION,technical:{status:techPass?"TECHNICAL_PASS":"TECHNICAL_FAIL",score:score(technical),checks:technical},
    visual:{score:score(visual),checks:visual},creative:{status:creativeStatus,score:score(creative),checks:creative},
    semantic:ctx.vision?{status:"VERIFIED",detail:`vision model ${ctx.vision.model}`}:{status:"UNKNOWN",detail:"ไม่มี Vision Model ที่อนุญาตให้ใช้ — ต้องให้เจ้าของตรวจความถูกต้องของสินค้าและข้อความ (Human Review)"},
    decision,nextAction:decision==="READY_FOR_OWNER_REVIEW"?"ส่งให้เจ้าของตรวจและนำเข้า Video Factory":"กลับไปแก้ Storyboard/Editor — ห้าม Generate ใหม่อัตโนมัติเพราะคะแนนต่ำ",
    reasonsTh,failureRecord:{rejected:decision!=="READY_FOR_OWNER_REVIEW",cost:ctx.cost??null},signals:s};
}
