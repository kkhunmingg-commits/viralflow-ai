/* Content bank pilot on a throwaway local Supabase stack (supabase start in CI), never a hosted project.
 * Creative Brain picks the story -> Video Factory renders with local Thai TTS -> the bank checks, dedupes,
 * schedules and packages each clip for manual posting. Nothing is posted and no TikTok call is made.
 * Growth: 3 clips first; if at least 2 pass, 4 more. Affiliate: 3 clips from system-drawn mock media,
 * labelled TEST ONLY (no real product media with rights exists yet).
 * Run: node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/content-bank-pilot.ts <mock-media-dir> <out-dir> */
import {readFileSync,readdirSync} from "node:fs";
import {mkdir,writeFile} from "node:fs/promises";
import {cpus,totalmem} from "node:os";
import {join} from "node:path";
import type {SupabaseClient} from "@supabase/supabase-js";
import {acceptMasterIntoBank,bankPackage,bankSummary,reviewBankItem} from "../../src/features/content-bank/service";
import {addContentEvidence} from "../../src/features/video/media-rights-service";
import {GROWTH_TOPICS} from "./topics";
import {clearRights,log,pilotOwner,runProject,sandboxAccount,sandboxAssignment,sandboxProduct,uploadMedia,type Row} from "./sandbox";

const [mediaDir,outDir]=process.argv.slice(2);
// Assumptions, reported as such: machine time is not billed in this setup.
const MACHINE_THB_PER_HOUR=6,THB_PER_USD=35;

/** Resident memory of this process and every descendant (TTS python, ffmpeg), sampled while a clip runs. */
function treeRssMb(){
  const parent=new Map<number,number>(),rss=new Map<number,number>();
  for(const name of readdirSync("/proc")){
    if(!/^\d+$/.test(name))continue;
    try{const stat=readFileSync(`/proc/${name}/stat`,"utf8"),fields=stat.slice(stat.lastIndexOf(")")+2).split(" ");
      parent.set(Number(name),Number(fields[1]));rss.set(Number(name),Number(fields[21])*4096)}catch{/* exited */}
  }
  const inTree=(pid:number):boolean=>{for(let p=pid,i=0;p>1&&i<64;p=parent.get(p)??0,i++)if(p===process.pid)return true;return false};
  let total=0;for(const [pid,bytes] of rss)if(inTree(pid))total+=bytes;return total/1048576;
}
/** CPU seconds of this process plus every child it has waited for (ffmpeg, TTS). */
function cpuSeconds(){
  const stat=readFileSync("/proc/self/stat","utf8"),f=stat.slice(stat.lastIndexOf(")")+2).split(" ");
  return (Number(f[11])+Number(f[12])+Number(f[13])+Number(f[14]))/100;
}
async function measured<T>(work:()=>Promise<T>){
  let peak=treeRssMb();const timer=setInterval(()=>{peak=Math.max(peak,treeRssMb())},500);
  const cpu0=cpuSeconds(),t0=Date.now();
  try{const value=await work();const wall=(Date.now()-t0)/1000,cpu=cpuSeconds()-cpu0;
    return {value,wallSeconds:wall,cpuSeconds:Number(cpu.toFixed(1)),avgCpuCores:Number((cpu/wall).toFixed(2)),peakRssMb:Math.round(peak)}}
  finally{clearInterval(timer)}
}

const TOPICS=GROWTH_TOPICS;
// Clip counts: Phase 3 ran 3 Growth clips, then 4 more if 2 passed, plus 3 Affiliate tests. Overridable for other pilots.
const GROWTH_CLIPS=Number(process.env.PILOT_GROWTH_CLIPS??0),AFFILIATE_CLIPS=Number(process.env.PILOT_AFFILIATE_CLIPS??3);

interface ClipResult{label:string;mode:string;error?:string;story?:unknown;topic?:unknown;method?:string;quality?:string;bankStatus?:string;
  rejection?:unknown;slot?:unknown;slotBasis?:unknown;hook?:string;voice?:string;caption?:string;hashtags?:unknown;metrics?:unknown;costActualUsd?:number;costEstimatedThb?:unknown;costBasis?:unknown;checks?:unknown;narration?:unknown;ai?:unknown;publishDecision?:string;publishBlockers?:unknown;contentType?:string;creativeSource?:unknown;mediaRights?:unknown;itemId?:string}

async function produce(admin:SupabaseClient,user:SupabaseClient,owner:string,assignmentId:string,label:string,mode:string):Promise<ClipResult>{
  try{
    const run=await measured(()=>runProject(admin,user,owner,assignmentId,label,outDir));
    const r=run.value,{value:_,...metrics}=run;
    const item=await acceptMasterIntoBank(admin,owner,r.masterId,{peakRssMb:metrics.peakRssMb,machineThbPerHour:MACHINE_THB_PER_HOUR,planningSeconds:r.timings.creativeSeconds??null});
    // Nobody has watched these clips, so they stay PENDING_REVIEW and the packages are review copies marked not to post.
    if(item.status!=="REJECTED")await writeFile(join(outDir,`${label}-package.zip`),await bankPackage(admin,owner,String(item.id),{reviewCopy:true}));
    const result:ClipResult={label,mode,story:r.selected.story,topic:{topic:r.selected.topic,basis:r.selected.topicBasis},method:r.selected.method,quality:String(r.master.quality_status),
      bankStatus:String(item.status),rejection:item.rejection_reasons,publishDecision:String(item.publish_decision),publishBlockers:item.publish_blockers,
      contentType:String(item.content_type),creativeSource:item.creative_source,mediaRights:item.media_rights_evidence,itemId:String(item.id),slot:item.planned_slot_at,slotBasis:item.slot_basis,hook:String(r.script.hook_text),voice:String(r.script.voice_script),
      caption:String(item.caption),hashtags:item.hashtags,metrics:{...metrics,renderSeconds:r.timings.renderSeconds,creativeSeconds:r.timings.creativeSeconds},
      costActualUsd:Number(item.cost_actual_usd),costEstimatedThb:item.cost_estimated_thb,costBasis:item.cost_basis,
      narration:(r.master.quality_explanation_json as Row|null)?.narration,ai:r.ai,
      checks:((r.master.quality_explanation_json as Row|null)?.checks as Array<Row>|undefined)?.map(c=>`${c.passed?"PASS":"FAIL"} ${c.name}: ${c.detail??""}`)};
    log(`${label}.bank`,{status:result.bankStatus,publish:result.publishDecision,blockers:result.publishBlockers,rejection:result.rejection,format:(result.story as {format?:string}|undefined)?.format,hook:result.hook,narration:result.narration,checks:result.checks,slot:result.slot,metrics:result.metrics});
    return result;
  }catch(error){const message=error instanceof Error?error.message:String(error);log(`${label}.failed`,{message});return {label,mode,error:message}}
}

async function main(){
  await mkdir(outDir,{recursive:true});
  const {admin,user,owner}=await pilotOwner();log("owner",{owner,cpus:cpus().length,memGb:Math.round(totalmem()/2**30)});
  const day=new Date(Date.now()-3600000).toISOString();

  // Growth: no audience history, so the bank must fall back to labelled default slots.
  const growth=await sandboxAccount(admin,owner,"GROWTH",{timezone:"Asia/Bangkok",categories:["ความรู้รอบตัว"],audienceMinutes:[],minimumGapMinutes:180});
  for(const t of TOPICS)for(const statement of t.facts)
    await addContentEvidence(admin,owner,{topic:t.topic,statement,source:"AUTHORIZED_SOURCE",sourceReference:t.source,role:"OBSERVATION",capturedAt:day});
  const growthProduct=await sandboxProduct(admin,owner,"Growth sandbox placeholder (no product is shown)");
  const results:ClipResult[]=[];
  const growthRun=async(i:number)=>results.push(await produce(admin,user,owner,await sandboxAssignment(admin,owner,growth,growthProduct,"GROWTH",i),`growth-${i+1}`,"GROWTH"));
  if(GROWTH_CLIPS>0)for(let i=0;i<GROWTH_CLIPS;i++)await growthRun(i);
  else{
    for(let i=0;i<3;i++)await growthRun(i);
    const firstPassed=results.filter(r=>r.bankStatus==="ACCEPTED").length;
    log("growth.gate",{accepted:firstPassed,of:3,expand:firstPassed>=2});
    if(firstPassed>=2)for(let i=3;i<7;i++)await growthRun(i);
  }

  // Affiliate: TEST ONLY mock media. Real affiliate clips wait for owner media with rights.
  const affiliate=await sandboxAccount(admin,owner,"AFFILIATE",{timezone:"Asia/Bangkok",categories:["ของใช้ในบ้าน"],audienceMinutes:[20*60+30],minimumGapMinutes:180});
  const product=await sandboxProduct(admin,owner,"ขวดน้ำเก็บความเย็น ฟ้าเย็น 500 มล. (สินค้าทดสอบ)");
  for(const [file,type,seconds,role] of [["mock-bottle.mp4","VIDEO",10,"REAL_FOOTAGE"],["mock-bottle.png","PRODUCT_IMAGE",null,"REAL_IMAGE"],["mock-bottle-detail.png","PRODUCT_IMAGE",null,"REAL_IMAGE"]] as const)
    await clearRights(admin,owner,await uploadMedia(admin,owner,product,mediaDir,file,type,seconds),role,affiliate);
  for(const statement of ["ขวดสีฟ้า ฝาสีดำมีห่วงหิ้ว","ความจุ 500 มิลลิลิตร"])
    await addContentEvidence(admin,owner,{productId:product,statement,source:"OWNER_FOOTAGE",sourceReference:"Visible in the pilot test media",role:"SELLING_POINT",capturedAt:day});
  for(let i=0;i<AFFILIATE_CLIPS;i++)results.push(await produce(admin,user,owner,await sandboxAssignment(admin,owner,affiliate,product,"AFFILIATE",i),`affiliate-test-${i+1}`,"AFFILIATE"));

  // Re-banking the same master must return the existing record, not a second one.
  const first=(await admin.from("content_bank_items").select("id,master_video_id").eq("owner_id",owner).limit(1).maybeSingle()).data as Row|null;
  const again=first?await acceptMasterIntoBank(admin,owner,String(first.master_video_id)):null;
  const count=(await admin.from("content_bank_items").select("id",{count:"exact",head:true}).eq("owner_id",owner)).count;
  // Guards the owner relies on: a test clip cannot be approved, and an unreviewed clip has no posting package.
  const guards:Record<string,string>={};
  const blocked=results.find(r=>r.publishDecision==="DO_NOT_PUBLISH"&&r.bankStatus==="ACCEPTED"),pending=results.find(r=>r.publishDecision==="PENDING_REVIEW");
  if(blocked?.itemId)guards.approveTestClip=await reviewBankItem(user,blocked.itemId,true).then(v=>`UNEXPECTED:${v}`,(e:Error)=>e.message);
  if(pending?.itemId)guards.exportUnreviewed=await bankPackage(admin,owner,pending.itemId).then(()=>"UNEXPECTED:PACKAGE_MADE",(e:Error)=>e.message);
  log("bank.guards",guards);
  const posted=(await admin.from("publishing_queue").select("id",{count:"exact",head:true}).eq("owner_id",owner)).count;
  const report={ranAt:new Date().toISOString(),database:"local supabase start stack, destroyed after the job",
    machine:{cpus:cpus().length,memGb:Math.round(totalmem()/2**30),note:"GitHub-hosted ubuntu-latest runner"},
    assumptions:{machineThbPerHour:MACHINE_THB_PER_HOUR,thbPerUsd:THB_PER_USD,note:"Estimates only. No bill exists for runner time; actual spend comes from generation_costs."},
    env:{creative:process.env.CREATIVE_AI_PROVIDER,tts:process.env.THAI_TTS_PROVIDER??"none"},results,
    bank:{growth:await bankSummary(admin,owner,growth,THB_PER_USD),affiliateTestOnly:await bankSummary(admin,owner,affiliate,THB_PER_USD)},
    guards,rebankSameMaster:first?{sameRow:again?.id===first.id,rowsInBank:count}:null,publishingQueueRows:posted};
  await writeFile(join(outDir,"content-bank-report.json"),JSON.stringify(report,null,2));
  log("done",{accepted:results.filter(r=>r.bankStatus==="ACCEPTED").length,attempts:results.length,errors:results.filter(r=>r.error).length});
  if(results.some(r=>r.error))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exit(1)});
