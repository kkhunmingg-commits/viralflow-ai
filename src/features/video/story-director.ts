import {spawn} from "node:child_process";
import {ffmpegBinary} from "./ffmpeg-binary";
import {CAPTION_MAX_CHARS,wrapThaiCaption,type ComposerCaption,type ComposerClip,type ShotMotion,type SubjectBox} from "./local-composer";

/** One spoken/on-screen idea. The Creative Brain plans beats; the director turns them into shots. */
export interface StoryBeat {role:"HOOK"|"POINT"|"CTA";text:string;kicker?:string;badge?:string}
export type StoryFormat="EXPLAINER"|"QUIZ_REVEAL"|"LIST"|"NUMBER_SPOTLIGHT"|"PRODUCT_DETAIL"|"DEMONSTRATION"|"COMPARISON";
export interface StoryPlan {format:StoryFormat;beats:StoryBeat[];basis:string}
export interface BeatWindow {start:number;end:number}

const visible=(text:string)=>text.normalize("NFC").replace(/\p{M}/gu,"").replace(/\s+/g,"").length;
const MIN_BEAT=1.7,MAX_SHOT=3.2;

/** Beats share the narration in proportion to how much is said, which is how evenly paced TTS
 * actually lands; the last beat holds to the end of the clip so text never drops out early. */
export function beatTimeline(beats:StoryBeat[],speechSeconds:number|null,total:number):BeatWindow[]{
  if(!beats.length)throw new Error("story_beats_missing");
  const weights=beats.map(b=>Math.max(6,visible(b.text)));
  // Without narration the text is the message, so it gets the whole clip to be read.
  const span=Math.min(total,Math.max(beats.length*MIN_BEAT,speechSeconds??total));
  const sum=weights.reduce((a,b)=>a+b,0);
  let t=0;
  const raw=weights.map(w=>{const len=Math.max(MIN_BEAT,span*w/sum),win={start:t,end:t+len};t+=len;return win});
  // Squeeze proportionally if minimum holds pushed past the clip, then stretch the final beat to the end.
  const scale=t>total?total/t:1;
  return raw.map((w,i)=>({start:+(w.start*scale).toFixed(3),end:i===raw.length-1?total:+(w.end*scale).toFixed(3)}));
}

/** Captions follow every spoken beat with no gaps; long beats are split into readable two-line chunks. */
export function beatCaptions(beats:StoryBeat[],windows:BeatWindow[]):ComposerCaption[]{
  return beats.flatMap((beat,i)=>{
    const win=windows[i],chunks=captionChunks(beat.text);
    const total=chunks.reduce((a,c)=>a+Math.max(4,visible(c)),0);let t=win.start;
    return chunks.map((text,j)=>{const len=(win.end-win.start)*Math.max(4,visible(text))/total,cue={text,start:+t.toFixed(3),end:+(j===chunks.length-1?win.end:t+len).toFixed(3)};t+=len;return cue});
  });
}
function captionChunks(text:string){
  try{wrapThaiCaption(text,CAPTION_MAX_CHARS,2);return [text.trim()]}catch{/* split below */}
  const words=[...new Intl.Segmenter("th",{granularity:"word"}).segment(text.normalize("NFC").replace(/\s+/g," ").trim())].map(s=>s.segment);
  const chunks:string[]=[];let cur="";
  for(const w of words){const next=cur+w;
    let fits=true;try{wrapThaiCaption(next,CAPTION_MAX_CHARS,2)}catch{fits=false}
    if(!fits&&cur.trim()){chunks.push(cur.trim());cur=w.trimStart()}else cur=next;}
  if(cur.trim())chunks.push(cur.trim());
  return chunks;
}

/** Finds the subject in a still by comparing it with its border colour. It is a cheap stand-in for
 * vision: good on product shots against plain backgrounds, and it falls back to the centre otherwise. */
export async function subjectBox(path:string):Promise<SubjectBox>{
  const fallback={x:.2,y:.2,w:.6,h:.6},binary=ffmpegBinary();if(!binary)return fallback;
  const W=54,H=96;
  const pixels=await new Promise<Buffer|null>(resolve=>{
    const child=spawn(binary,["-nostdin","-hide_banner","-loglevel","error","-i",path,"-frames:v","1","-vf",`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gray`,"-f","rawvideo","-"],{stdio:["ignore","pipe","ignore"]}),out:Buffer[]=[];
    child.stdout.on("data",d=>out.push(Buffer.from(d)));child.on("error",()=>resolve(null));child.on("close",code=>resolve(code===0?Buffer.concat(out):null));
  });
  if(!pixels||pixels.length!==W*H)return fallback;
  // Background is estimated per row from the left and right edges, which copes with the vertical
  // gradients and studio sweeps typical of product shots.
  const rowBg=Array.from({length:H},(_,y)=>{const edge=[0,1,2,W-3,W-2,W-1].map(x=>pixels[y*W+x]).sort((a,b)=>a-b);return (edge[2]+edge[3])/2});
  const xs:number[]=[],ys:number[]=[];
  for(let y=0;y<H;y++)for(let x=3;x<W-3;x++)if(Math.abs(pixels[y*W+x]-rowBg[y])>18){xs.push(x);ys.push(y)}
  const count=xs.length;xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
  // Trim the outer 3% so small marks (a corner badge, a stray highlight) do not stretch the box.
  const q=(v:number[],p:number)=>v[Math.min(v.length-1,Math.max(0,Math.floor(v.length*p)))];
  const x0=q(xs,.03),x1=q(xs,.97),y0=q(ys,.03),y1=q(ys,.97);
  // Too little or nearly everything differs: no clear subject, so frame the centre.
  if(count<W*H*.03||count>W*H*.92)return fallback;
  return {x:x0/W,y:y0/H,w:(x1-x0+1)/W,h:(y1-y0+1)/H};
}

export interface DirectedMedia {assetId:string;path:string;kind:"IMAGE"|"VIDEO";subject?:SubjectBox}
// Each beat role has an editorial job: the hook grabs with a close detail, points show the product
// whole or a different angle, and the close pulls back so the viewer sees exactly what it is.
const ROLE_MOTIONS:Record<StoryBeat["role"],ShotMotion[]>={HOOK:["DETAIL","PUSH_IN"],POINT:["PUSH_IN","PAN","DETAIL"],CTA:["PULL_OUT","HOLD"]};

/** Turns beats into an edit: one or two shots per beat, cut on the beat, cycling through every
 * cleared asset so a single still is not zoomed for eight seconds. Video keeps its real motion. */
export function directRealMedia(beats:StoryBeat[],windows:BeatWindow[],media:DirectedMedia[]):ComposerClip[]{
  if(!media.length)throw new Error("composer_requires_reviewed_media");
  const shots:ComposerClip[]=[];let cursor=0;
  const take=(role:StoryBeat["role"])=>{
    // Prefer footage for points, a still the viewer has not just seen otherwise.
    const pool=role==="POINT"&&media.some(m=>m.kind==="VIDEO")?media.filter(m=>m.kind==="VIDEO"):media;
    return pool[(cursor++)%pool.length]};
  beats.forEach((beat,i)=>{
    const win=windows[i],len=win.end-win.start,parts=len>MAX_SHOT?2:1;
    for(let p=0;p<parts;p++){
      const m=take(beat.role),motions=ROLE_MOTIONS[beat.role],motion=motions[(p+i)%motions.length];
      // Wide shots keep the product above the caption band; details fill the frame.
      shots.push({assetId:m.assetId,path:m.path,kind:m.kind,seconds:len/parts,motion:m.kind==="IMAGE"?motion:undefined,
        layout:m.kind==="IMAGE"&&motion!=="DETAIL"&&motion!=="PAN"?"FRAMED":"FULL_BLEED",subject:m.subject});
    }
  });
  return shots;
}

const GRAPHIC_PALETTES:Record<string,Array<[string,string]>>={
  EXPLAINER:[["0x1E3A5F","0x0F766E"],["0x0F766E","0x1E3A5F"]],QUIZ_REVEAL:[["0x3B0764","0x9D174D"],["0x9D174D","0xB45309"]],
  LIST:[["0x172554","0x1D4ED8"],["0x1E40AF","0x0F766E"]],NUMBER_SPOTLIGHT:[["0x111827","0x7C2D12"],["0x7C2D12","0x111827"]]};
/** Graphic formats: one card per beat, the format's palette, and its kicker/badge motion graphics. */
export function directGraphicStory(story:StoryPlan,windows:BeatWindow[]):ComposerClip[]{
  const palettes=GRAPHIC_PALETTES[story.format]??GRAPHIC_PALETTES.EXPLAINER;
  return story.beats.map((beat,i)=>({assetId:`graphic-${i+1}`,path:"",kind:"GRAPHIC" as const,headline:beat.text,palette:palettes[i%palettes.length],
    seconds:windows[i].end-windows[i].start,kicker:beat.kicker,badge:beat.badge}));
}
