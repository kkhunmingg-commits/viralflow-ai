/** Ad factory pipeline run with zero provider spend:
 * product intelligence → creative director → storyboard → Flow prompt plan (compiled, NOT submitted) →
 * local multi-shot edit → video critic, plus the critic's verdict on the rejected Flow clip (Before).
 *
 *   node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/ad-factory-run.ts
 *
 * Real inputs: the owner-approved Casio photograph and its two approved facts. The multi-category ranking
 * section uses clearly labelled SYNTHETIC_TEST_DATA to prove nothing is Casio-specific; it is never stored
 * as production data. No Flow Generate, no database writes, no publishing. */
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {rankProducts,unknown,type ProductIntelInput} from "../../src/features/products/intelligence";
import {directAd,type DirectorInput} from "../../src/features/creative/ad-director";
import {buildStoryboard,validateStoryboard} from "../../src/features/creative/storyboard";
import {compileFlowPlan} from "../../src/features/video/flow-prompt-compiler";
import {composeStoryboard} from "../../src/features/video/storyboard-composer";
import {analyzeVideo,critiqueVideo} from "../../src/features/video/creative-critic";
import {ffmpegBinary} from "../../src/features/video/ffmpeg-binary";
import {configuredLocalLLM} from "../../src/features/creative/local-agent";

const ROOT=resolve(process.cwd()),OUT=join(ROOT,".runtime","ad-factory",new Date().toISOString().replace(/[:.]/g,"-"));
const PHOTO=join(ROOT,"workers","flow-browser","workspace","inputs","casio-f91w-commons-138663809.jpg");
const BEFORE=join(ROOT,"workers","flow-browser","workspace","manual-downloads","Casio_watch_camera_push-in_20261028015602.mp4");
const CREDIT="ภาพสินค้า: Multicherry / Wikimedia Commons · CC BY-SA 4.0 · ดัดแปลง (ครอป ปรับขนาด จัดองค์ประกอบ)";
const at="2026-10-28T00:00:00.000Z";

const casio:DirectorInput={product:{id:"5d8a024d-c820-449a-8f70-36ab93d17a36",title:"Casio F-91W",categoryKey:"watch",model:"F-91W"},
  facts:[{id:"fact-digital",text:"นาฬิกาดิจิทัล",role:"SELLING_POINT",source:"Casio Thailand"},{id:"fact-21g",text:"น้ำหนัก 21 กรัม",role:"SELLING_POINT",source:"Casio Thailand"}],
  assets:[{id:"9ccc808f-a616-4d0e-8d1d-cce9ba8013d2",kind:"REAL_IMAGE",rightsCleared:true,credit:CREDIT}],
  account:{id:"pilot-account",mode:"GROWTH",affiliateEligible:false},history:{formats:["PRODUCT_DETAIL"],hooks:["Casio F-91W ดูจุดไหนดี?"]},conceptCount:4};

const base=(over:Partial<ProductIntelInput>&Pick<ProductIntelInput,"id"|"title"|"categoryKey">):ProductIntelInput=>({model:null,adapter:"OWNER_CATALOG_FILE",sourceUrl:null,capturedAt:at,
  identityVerified:true,stock:"IN_STOCK",price:unknown(),demand:{unitsSold30d:unknown(),velocityPerDay:unknown(),trend:null},commission:{rate:unknown(),amountThb:unknown()},
  marginThb:unknown(),reviews:{rating:unknown(),count:unknown(),complaintRate:unknown()},contentSaturation:unknown(),media:{rightsClearedImages:1,rightsClearedVideos:0,operationFootage:0},
  verifiedFactCount:2,risk:{restrictedCategory:false,counterfeitRisk:false,claimSensitivity:"LOW"},audienceFit:{},costPerUsableClipThb:unknown(),...over});
const obs=(value:number,reliability:"OWNER_REPORT"|"PUBLIC_PAGE"="OWNER_REPORT")=>({value,source:"SYNTHETIC_TEST_DATA",observedAt:at,reliability});

async function main(){
  await mkdir(OUT,{recursive:true});
  if(!ffmpegBinary())throw new Error("ffmpeg_unavailable");
  const photoSha=createHash("sha256").update(await readFile(PHOTO)).digest("hex");
  const now=new Date(at);
  // 1. Product intelligence: the real catalogue (one product) and a synthetic multi-category test set.
  const realRanking=rankProducts([base({id:casio.product.id,title:"Casio F-91W",categoryKey:"watch",model:"F-91W",adapter:"PUBLIC_MEDIA_COMMONS",sourceUrl:"https://www.casio.com/th/watches/casio/product.F-91W-1/"})],{now});
  const synthetic=[
    base({id:"syn-serum",title:"เซรั่มวิตามินซี 30 มล.",categoryKey:"beauty",price:obs(390),demand:{unitsSold30d:obs(2400),velocityPerDay:obs(80),trend:"RISING"},commission:{rate:obs(.12),amountThb:obs(47)},reviews:{rating:obs(4.6),count:obs(820),complaintRate:obs(.02)},contentSaturation:obs(.8),risk:{restrictedCategory:false,counterfeitRisk:false,claimSensitivity:"HIGH"},audiencePriceReferenceThb:450}),
    base({id:"syn-organizer",title:"กล่องจัดระเบียบลิ้นชักครัว",categoryKey:"home",price:obs(159),demand:{unitsSold30d:obs(900),velocityPerDay:obs(30),trend:"STABLE"},commission:{rate:obs(.1),amountThb:obs(16)},reviews:{rating:obs(4.4),count:obs(130),complaintRate:unknown()},contentSaturation:obs(.35),media:{rightsClearedImages:3,rightsClearedVideos:1,operationFootage:1},audiencePriceReferenceThb:250}),
    base({id:"syn-earbuds",title:"หูฟังไร้สาย รุ่นทดสอบ",categoryKey:"gadgets",price:obs(890,"PUBLIC_PAGE"),demand:{unitsSold30d:unknown(),velocityPerDay:unknown(),trend:null},media:{rightsClearedImages:0,rightsClearedVideos:0,operationFootage:0}}),
    base({id:"syn-snack",title:"ขนมอบกรอบ 4 รส",categoryKey:"food",stock:"OUT_OF_STOCK",price:obs(59),demand:{unitsSold30d:obs(5000),velocityPerDay:obs(150),trend:"RISING"}}),
  ];
  const syntheticRanking=rankProducts(synthetic,{now,accountId:"pilot-account"});
  // 2–3. Director + storyboard + Flow plan for Casio, and plan-only for synthetic categories.
  const local=configuredLocalLLM();
  const plan=await directAd(casio,local);
  const ranked=plan.critiques.filter(c=>c.passed).toSorted((a,b)=>b.total-a.total);
  const otherPlans=await Promise.all([
    {product:{id:"syn-organizer",title:"กล่องจัดระเบียบลิ้นชักครัว",categoryKey:"home"},facts:[{id:"f1",text:"แบ่งได้ 6 ช่อง"}],assets:[{id:"a1",kind:"REAL_IMAGE" as const,rightsCleared:true},{id:"a2",kind:"OPERATION_FOOTAGE" as const,rightsCleared:true}]},
    {product:{id:"syn-serum",title:"เซรั่มวิตามินซี 30 มล.",categoryKey:"beauty"},facts:[{id:"f1",text:"ขนาด 30 มล."}],assets:[{id:"a1",kind:"REAL_IMAGE" as const,rightsCleared:true}]},
    {product:{id:"syn-earbuds",title:"หูฟังไร้สาย รุ่นทดสอบ",categoryKey:"gadgets"},facts:[{id:"f1",text:"น้ำหนักข้างละ 4 กรัม"}],assets:[{id:"a1",kind:"REAL_IMAGE" as const,rightsCleared:true}]},
  ].map(async p=>{const d=await directAd({...p,account:{id:"x",mode:"AFFILIATE",affiliateEligible:true}});const sel=d.concepts.find(c=>c.id===d.selectedConceptId)!;
    const sb=buildStoryboard(sel,{...p,account:{id:"x",mode:"AFFILIATE",affiliateEligible:true}} as DirectorInput);
    return {product:p.product.title,category:d.insight.category,selected:sel.formatLabel,hook:sel.hook.text,cta:sel.cta,scenes:sb.scenes.map(s=>`${s.role}:${s.layout}`),concepts:d.concepts.map(c=>c.formatLabel)}}));
  const renders:Array<Record<string,unknown>>=[];
  // The critic's top two, plus the owner's own "simplicity" lifestyle example when the critic did not already pick it.
  const toRender=[...ranked.slice(0,2),...ranked.filter(c=>c.conceptId.includes("lifestyle")&&!ranked.slice(0,2).includes(c))];
  for(const [i,crit] of toRender.entries()){
    const concept=plan.concepts.find(c=>c.id===crit.conceptId)!;
    const board=buildStoryboard(concept,casio,{durationSeconds:8,audioPlan:"CAPTION_ONLY_WITH_MUSIC"});
    const issues=validateStoryboard(board,casio);
    const flow=compileFlowPlan(board,casio.product.title,{maxGenerations:1,observedCreditsPerGeneration:10});
    const work=join(OUT,`after-${i+1}-work`),output=join(OUT,`AFTER_${i+1}_${concept.format}_SYNTHETIC_PREVIEW.mp4`);
    await mkdir(work,{recursive:true});
    const composed=await composeStoryboard({board,assets:{[casio.assets[0].id]:PHOTO},credit:CREDIT,workDir:work,outputPath:output});
    const critique=critiqueVideo(await analyzeVideo(output),{storyboard:board,productPixels:"REAL_ASSET_COMPOSITE",textEvents:composed.textEvents,cost:{flowCredits:0,thb:0,note:"local FFmpeg only; electricity not metered"}});
    renders.push({concept,critic:crit,storyboard:board,storyboardIssues:issues,flowPlan:flow,composed,critique,output});
  }
  // 5. Before: the clip the owner rejected.
  const before=critiqueVideo(await analyzeVideo(BEFORE),{storyboard:null,productPixels:"AI_RECONSTRUCTED",cost:{flowCredits:10,thb:null,note:"10 Google Flow credits observed in UI; THB value of credits unknown"}});
  // 6. Side-by-side comparison for the owner.
  const after=String(renders[0]?.output??"");
  const compare=join(OUT,"BEFORE_vs_AFTER.mp4");
  if(after){const font=join(ROOT,"assets","fonts","NotoSansThai-Bold.ttf").replace(/\\/g,"/").replace(":","\\:");
    const label=(t:string)=>`drawtext=fontfile='${font}':text='${t}':fontcolor=white:fontsize=44:box=1:boxcolor=black@0.6:boxborderw=14:x=(w-text_w)/2:y=40`;
    const r=spawnSync(ffmpegBinary()!,["-nostdin","-hide_banner","-loglevel","error","-y","-i",BEFORE,"-i",after,"-filter_complex",
      `[0:v]scale=540:960,setsar=1,fps=30,${label("BEFORE (Flow, rejected)")}[a];[1:v]scale=540:960,setsar=1,fps=30,${label("AFTER (storyboard edit)")}[b];[a][b]hstack=inputs=2[v]`,
      "-map","[v]","-map","1:a","-t","8","-c:v","libx264","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",compare],{encoding:"utf8"});
    if(r.status!==0)throw new Error(`compare_failed ${r.stderr}`);}
  const report={generatedAt:new Date().toISOString(),labels:{realInputs:"Casio photo (sha256 "+photoSha+") + 2 owner-approved facts",syntheticTestData:"multi-category ranking/plans only",
    afterVideos:"SYNTHETIC_PREVIEW: local edit of the real photo; AI context scenes substituted by graphics because no new Flow generation was approved",flowGenerate:"NOT CLICKED"},
    realRanking,syntheticRanking,director:{mode:plan.mode,modeReason:plan.modeReason,insight:plan.insight,concepts:plan.concepts,critiques:plan.critiques,selected:plan.selectedConceptId},
    otherCategoryPlans:otherPlans,renders,before,compare};
  await writeFile(join(OUT,"report.json"),JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify({out:OUT,mode:plan.mode,selected:plan.selectedConceptId,
    concepts:plan.critiques.map(c=>`${c.conceptId}:${c.total}:${c.passed}`),
    before:{technical:before.technical.status,creative:before.creative.status,decision:before.decision,reasons:before.reasonsTh},
    after:renders.map(r=>({output:r.output,issues:(r.storyboardIssues as unknown[]).length,technical:(r.critique as ReturnType<typeof critiqueVideo>).technical.status,creative:(r.critique as ReturnType<typeof critiqueVideo>).creative.status,
      decision:(r.critique as ReturnType<typeof critiqueVideo>).decision,reasons:(r.critique as ReturnType<typeof critiqueVideo>).reasonsTh,scenes:(r.composed as {scenes:unknown}).scenes})),
    otherPlans,realMode:realRanking.mode,synthetic:syntheticRanking.items.map(i=>`${i.rank}:${i.title}:${i.opportunity.score}:${i.dataConfidence.label}:${i.eligibility.eligible}`)},null,1));
}
main().catch(e=>{console.error(e);process.exit(1)});
