/* Isolated pilot: renders one ORIGINAL_GRAPHIC_STORY clip on this machine with no database, no
 * network, no paid API and no TikTok call, then prints what it measured.
 * Usage: pnpm pilot:graphic <output-dir> [--hook ..] [--point ..] [--cta ..] */
import {cpus,totalmem} from "node:os";
import {mkdir,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {ffmpegBinary} from "../src/features/video/ffmpeg-binary";
import {buildGraphicStoryboard,renderGraphicStoryMaster} from "../src/features/video/graphic-story";
import {configuredThaiVoice} from "../src/features/video/thai-voice";

const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(`--${name}`);return i>0?process.argv[i+1]:fallback};
const out=resolve(process.argv[2]??"graphic-pilot");
const hook=arg("hook","รู้ไหม เรื่องนี้มีเหตุผล"),point=arg("point","วางของใช้บ่อยไว้ใกล้มือ"),cta=arg("cta","ติดตามไว้ ตอนต่อไปมีอีก");
const script=`${hook} ${point} ${cta}`;
async function main(){
  await mkdir(join(out,"work"),{recursive:true});
  const startedAt=Date.now();
  const result=await renderGraphicStoryMaster({storyboard:buildGraphicStoryboard({seed:`pilot-${point}`,hook,script,cta}),script,
    tts:configuredThaiVoice(),workDir:join(out,"work"),outputPath:join(out,"graphic-story.mp4")});
  const report={renderedAt:new Date().toISOString(),renderSeconds:Number(((Date.now()-startedAt)/1000).toFixed(2)),
    costTHB:0,costBasis:"local CPU only; no paid API, model download or upload",
    machine:{cpus:cpus().length,cpuModel:cpus()[0]?.model,memoryGB:Math.round(totalmem()/2**30),ffmpeg:ffmpegBinary()},
    copy:{hook,point,cta},narration:result.narration,media:result.media,loudnessLufs:result.loudnessLufs,checks:result.checks,passed:result.passed,
    limits:["Pipeline proof only: not shown to viewers, so no evidence that it performs on TikTok",
      "Visual style is a fixed gradient and text template; human review is still required before posting"]};
  await writeFile(join(out,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exit(1)});
