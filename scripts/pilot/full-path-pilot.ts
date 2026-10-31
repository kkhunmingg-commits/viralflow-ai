/* Full-path pilot on a throwaway local Supabase stack (supabase start in CI), never a hosted project.
 * Creative Brain -> Media Rights -> Thai TTS -> Local Composer -> Quality Check -> stored master video.
 * Product media is original test media drawn by scripts/pilot/make_mock_product.py; the sandbox
 * account has no TikTok credentials and every rights record is scoped to it.
 * Run: node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/full-path-pilot.ts <mock-media-dir> <out-dir> */
import {copyFile,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {addContentEvidence} from "../../src/features/video/media-rights-service";
import {clearRights,log,must,pilotOwner,runProject,sandboxAccount,sandboxAssignment,sandboxProduct,uploadMedia} from "./sandbox";

const [mediaDir,outDir]=process.argv.slice(2);

async function main(){
  await mkdir(outDir,{recursive:true});
  const {admin,user,owner}=await pilotOwner();
  log("owner",{owner});

  // Affiliate: original mock product footage and still, cleared in the ledger for the sandbox account only.
  const accountId=await sandboxAccount(admin,owner,"AFFILIATE"),productId=await sandboxProduct(admin,owner,"ขวดน้ำเก็บความเย็น ฟ้าเย็น 500 มล. (สินค้าทดสอบ)");
  const affiliate={accountId,productId,assignmentId:await sandboxAssignment(admin,owner,accountId,productId,"AFFILIATE")};
  const clip=await uploadMedia(admin,owner,affiliate.productId,mediaDir,"mock-bottle.mp4","VIDEO",10);
  const still=await uploadMedia(admin,owner,affiliate.productId,mediaDir,"mock-bottle.png","PRODUCT_IMAGE",null);
  const rights=[await clearRights(admin,owner,clip,"REAL_FOOTAGE",affiliate.accountId),await clearRights(admin,owner,still,"REAL_IMAGE",affiliate.accountId)];
  const day=new Date(Date.now()-3600000).toISOString();
  for(const statement of ["ขวดสีฟ้า ฝาสีดำมีห่วงหิ้ว","ความจุ 500 มิลลิลิตร"])
    await addContentEvidence(admin,owner,{productId:affiliate.productId,statement,source:"OWNER_FOOTAGE",sourceReference:"Visible in the pilot test media",role:"SELLING_POINT",capturedAt:day});
  log("affiliate.rights",{clip,still,rights});

  // Growth needs a real topic from trend discovery before any fact applies, so it is not seeded here;
  // the graphic story format is rendered separately by scripts/graphic-story-pilot.ts with the same TTS.
  const results:Record<string,unknown>={};
  for(const [label,s] of [["affiliate",affiliate]] as const){
    try{results[label]=await runProject(admin,user,owner,s.assignmentId,label,outDir)}catch(error){results[label]={error:error instanceof Error?error.message:String(error)};log(`${label}.failed`,results[label] as object)}
  }

  // Publishing guard: the cleared media must not reach any account outside its scope.
  const guard:Record<string,unknown>={};
  const affiliateResult=results.affiliate as {masterId?:string};
  if(affiliateResult.masterId){
    const other=must(await admin.from("tiktok_accounts").insert({owner_id:owner,display_name:"Pilot other account",mode:"AFFILIATE"}).select("id").single(),"other");
    for(const [name,account] of [["sandbox",affiliate.accountId],["otherAccount",String(other.id)]]){
      const v=await admin.rpc("media_rights_violations",{p_owner:owner,p_video_kind:"MASTER",p_video_id:affiliateResult.masterId,p_account:account});
      guard[name]=v.error?{error:v.error.message}:v.data;
    }
  }
  const report={ranAt:new Date().toISOString(),database:"local supabase start stack, destroyed after the job",results,publishingGuard:guard,
    env:{creative:process.env.CREATIVE_AI_PROVIDER,tts:process.env.THAI_TTS_PROVIDER??"none"}};
  await writeFile(join(outDir,"full-path-report.json"),JSON.stringify(report,null,2));
  for(const f of ["mock-bottle.mp4","mock-bottle.png"])await copyFile(join(mediaDir,f),join(outDir,f));
  const ok=Object.values(results).every(r=>!(r as {error?:string}).error);
  log("done",{ok});if(!ok)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exit(1)});
