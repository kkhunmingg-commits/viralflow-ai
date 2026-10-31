import "server-only";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {ffmpegBinary} from "./ffmpeg-binary";
import {FFmpegVideoRenderer} from "./renderer";
import {buildAssSubtitles,defaultThaiFontPath,THAI_FONT_FILE,THAI_FONT_FAMILY,wrapThaiCaption,type ComposerCaption} from "./local-composer";
const safeAss=(value:string)=>value.replace(/[{}\\\r\n]/g," ");
/** Assisted edit: actual reviewed product pixels over Flow's background, retaining its narration. */
export async function composeFlowPhoto(input:{backgroundPath:string;photoPath:string;expectedPhotoSha256:string;title:string;captions:ComposerCaption[];credit:string;workDir:string;outputPath:string}){
  const paths=[input.backgroundPath,input.photoPath,input.outputPath,input.workDir].map(p=>resolve(p));
  if(process.platform==="win32"&&paths.some(p=>!/^D:\\/i.test(p)))throw new Error("FLOW_EDIT_REQUIRES_DRIVE_D");
  if(new Set(paths.map(p=>process.platform==="win32"?p.toLowerCase():p)).size!==paths.length)throw new Error("FLOW_EDIT_SOURCE_OVERWRITE");
  if(createHash("sha256").update(await readFile(input.photoPath)).digest("hex")!==input.expectedPhotoSha256)throw new Error("FLOW_PHOTO_CHECKSUM_MISMATCH");
  const renderer=new FFmpegVideoRenderer(),background=await renderer.probe(input.backgroundPath);
  if(background.duration<7.88||background.duration>30||!background.hasAudio||Math.abs(background.width/background.height-9/16)>.01)throw new Error("FLOW_BACKGROUND_FORMAT_INVALID");
  const binary=ffmpegBinary();if(!binary)throw new Error("ffmpeg_unavailable");
  await mkdir(join(input.workDir,"fonts"),{recursive:true});await copyFile(defaultThaiFontPath(),join(input.workDir,"fonts",THAI_FONT_FILE));
  let subtitles=buildAssSubtitles(input.captions,8);
  const styles=[`Style: Brand,${THAI_FONT_FAMILY},60,&H00FFFFFF,&H00FFFFFF,&H00221A12,&H66000000,-1,0,0,0,100,100,0,0,1,3,1,8,80,80,150,222`,
    `Style: Disclosure,${THAI_FONT_FAMILY},32,&H00FFFFFF,&H00FFFFFF,&H00221A12,&H66000000,0,0,0,0,100,100,0,0,1,2,1,2,70,70,310,222`,
    `Style: Credit,${THAI_FONT_FAMILY},24,&H00FFFFFF,&H00FFFFFF,&H00221A12,&H66000000,0,0,0,0,100,100,0,0,1,1,1,2,70,70,160,222`].join("\n");
  const credit=wrapThaiCaption(input.credit,72,4).map(safeAss).join("\\N");
  subtitles=subtitles.replace("[Events]",styles+"\n\n[Events]")+`\nDialogue: 3,0:00:00.00,0:00:08.00,Brand,,0,0,0,,${safeAss(input.title)}\nDialogue: 3,0:00:00.00,0:00:08.00,Disclosure,,0,0,0,,ภาพสินค้าจริง · พื้นหลังและเสียงสร้างด้วย AI\nDialogue: 3,0:00:00.00,0:00:08.00,Credit,,0,0,0,,${credit}\n`;
  await writeFile(join(input.workDir,"subtitles.ass"),subtitles,"utf8");
  const filter="[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30[bg];[1:v]scale=840:840:force_original_aspect_ratio=decrease,pad=840:840:(ow-iw)/2:(oh-ih)/2:white,setsar=1[photo];[bg][photo]overlay=(W-w)/2:260:shortest=1,ass=subtitles.ass:fontsdir=fonts,format=yuv420p[v]";
  const args=["-nostdin","-hide_banner","-loglevel","error","-y","-i",resolve(input.backgroundPath),"-loop","1","-framerate","30","-i",resolve(input.photoPath),"-filter_complex",filter,
    "-map","[v]","-map","0:a:0","-af","loudnorm=I=-14:TP=-1.5:LRA=11","-t","8","-c:v","libx264","-preset","medium","-crf","20","-c:a","aac","-b:a","128k","-movflags","+faststart",resolve(input.outputPath)];
  await new Promise<void>((ok,fail)=>{const child=spawn(binary,args,{cwd:input.workDir,windowsHide:true,stdio:["ignore","ignore","pipe"]});const errors:Buffer[]=[];
    child.stderr.on("data",d=>errors.push(Buffer.from(d)));const timer=setTimeout(()=>{child.kill();fail(new Error("FLOW_EDIT_TIMEOUT"))},180_000);
    child.on("error",error=>{clearTimeout(timer);fail(error)});child.on("close",code=>{clearTimeout(timer);if(code===0)ok();else fail(new Error(`FLOW_EDIT_FAILED: ${Buffer.concat(errors).toString().slice(-500)}`))});});
  return renderer.probe(input.outputPath);
}
