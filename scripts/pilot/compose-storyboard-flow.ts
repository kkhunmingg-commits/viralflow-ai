/** Compose a real Flow context clip into the approved lifestyle storyboard with the real Casio photograph,
 * then run the video critic. Local only: no generation, no database writes.
 *   node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/compose-storyboard-flow.ts D:\path\flow-scene.mp4 D:\path\out-dir */
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {composeStoryboard} from "../../src/features/video/storyboard-composer";
import {analyzeVideo,critiqueVideo} from "../../src/features/video/creative-critic";
import type {Storyboard} from "../../src/features/creative/storyboard";

const PHOTO=resolve("workers/flow-browser/workspace/inputs/casio-f91w-commons-138663809.jpg");
const CREDIT="ภาพสินค้า: Multicherry / Wikimedia Commons · CC BY-SA 4.0 · ดัดแปลง (ครอป ปรับขนาด จัดองค์ประกอบ)";
async function main(){
  const [clipArg,outArg]=process.argv.slice(2);if(!clipArg||!outArg)throw new Error("Usage: flowClip.mp4 outDir");
  const clip=resolve(clipArg),out=resolve(outArg);await mkdir(out,{recursive:true});
  const {storyboard}=JSON.parse(await readFile(".runtime/ad-factory/approved-flow-scene.json","utf8")) as {storyboard:Storyboard};
  const aiScene=storyboard.scenes.find(s=>s.background.kind==="AI_SCENE");if(!aiScene)throw new Error("NO_AI_SCENE_IN_STORYBOARD");
  const output=join(out,"CASIO_LIFESTYLE_FLOW_CONTEXT_FINAL.mp4");
  const composed=await composeStoryboard({board:storyboard,assets:{[storyboard.scenes.find(s=>s.product)!.product!.assetId]:PHOTO},aiClips:{[aiScene.id]:clip},
    credit:CREDIT,workDir:join(out,"work"),outputPath:output});
  const flowSha=createHash("sha256").update(await readFile(clip)).digest("hex"),finalSha=createHash("sha256").update(await readFile(output)).digest("hex");
  const critique=critiqueVideo(await analyzeVideo(output),{storyboard,productPixels:"REAL_ASSET_COMPOSITE",textEvents:composed.textEvents,
    cost:{flowCredits:10,thb:null,note:"one owner-approved Veo 3.1 Lite generation; THB value of credits unknown"}});
  await writeFile(join(out,"compose-report.json"),JSON.stringify({flowClip:clip,flowSha,output,finalSha,composed,critique},null,2),"utf8");
  console.log(JSON.stringify({output,finalSha,scenes:composed.scenes,loudness:composed.loudnessLufs,technical:critique.technical.status,creative:critique.creative.status,decision:critique.decision,reasons:critique.reasonsTh},null,1));
}
main().catch(e=>{console.error(e);process.exit(1)});
