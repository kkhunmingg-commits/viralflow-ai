/* Full-path pilot on a throwaway local Supabase stack (supabase start in CI), never a hosted project.
 * Creative Brain -> Media Rights -> Thai TTS -> Local Composer -> Quality Check -> stored master video.
 * Product media is original test media drawn by scripts/pilot/make_mock_product.py; the sandbox
 * account has no TikTok credentials and every rights record is scoped to it.
 * Run: node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/full-path-pilot.ts <mock-media-dir> <out-dir> */
import {copyFile,mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {approveEvidenceCreative,createProjectFromAssignment,generateEvidenceStrategyProject} from "../../src/features/creative/services";
import {addContentEvidence,recordMediaRights,reviewMediaRights} from "../../src/features/video/media-rights-service";
import {buildMasterVideo} from "../../src/features/video/services";
import {videoStorageBucket,videoStoragePath} from "../../src/features/video/storage";

const [mediaDir,outDir]=process.argv.slice(2);
const url=process.env.SUPABASE_URL!,service=process.env.SUPABASE_SERVICE_KEY!,anon=process.env.SUPABASE_ANON_KEY!;
const log=(step:string,detail:unknown={})=>console.log(JSON.stringify({step,...(detail as object)}));
type Row=Record<string,unknown>;
const must=(result:{data:unknown;error:{message:string}|null},what:string):Row=>{if(result.error||result.data==null)throw new Error(`${what}: ${result.error?.message??"no data"}`);return result.data as Row};

async function sandbox(admin:SupabaseClient,owner:string,mode:"AFFILIATE"|"GROWTH",title:string){
  const now=new Date().toISOString(),day=now.slice(0,10);
  const account=must(await admin.from("tiktok_accounts").insert({owner_id:owner,display_name:`Pilot sandbox ${mode} (no TikTok login)`,mode,
    is_mock:false,authorization_status:"authorized",account_notes:"Throwaway pilot record in a local database. No TikTok token exists."}).select("id").single(),"account");
  const product=must(await admin.from("products").insert({owner_id:owner,external_provider:"pilot-mock",external_product_id:randomUUID(),title,slug:`pilot-${randomUUID()}`,
    category_key:"home",current_price:199,commission_rate:.1,commission_amount:19.9,review_count:0,units_sold:0,status:"available",
    provider_metadata:{pilot:true,note:"Fictional product drawn for pipeline testing"},first_seen_at:now,last_seen_at:now}).select("id").single(),"product");
  const c=50;const score=must(await admin.from("account_product_scores").insert({owner_id:owner,tiktok_account_id:account.id,product_id:product.id,run_id:randomUUID(),calculated_at:now,
    product_component:c,category_component:c,account_category_component:c,commercial_component:c,mode_fit_component:c,confidence_component:c,freshness_component:c,competition_component:c,
    account_product_fit_score:c,final_viral_opportunity_score:c,effective_mode:mode,eligible:true,score_version:"pilot",explanation_json:{pilot:true}}).select("id").single(),"score");
  const assignment=must(await admin.from("product_assignments").insert({owner_id:owner,tiktok_account_id:account.id,product_id:product.id,category_key:"home",score_id:score.id,
    assignment_date:day,rank_for_account:1,effective_mode:mode,final_score:c,status:"SELECTED",score_version:"pilot",reason_json:{pilot:true}}).select("id").single(),"assignment");
  must(await admin.from("auto_account_discovery").insert({owner_id:owner,tiktok_account_id:account.id,mode,verified:true,can_execute:true,affiliate_allowed:mode==="AFFILIATE",
    valid_until:new Date(Date.now()+86400000).toISOString()}).select("tiktok_account_id").single(),"permission");
  return {accountId:String(account.id),productId:String(product.id),assignmentId:String(assignment.id)};
}

async function uploadMedia(admin:SupabaseClient,owner:string,productId:string,file:string,type:"VIDEO"|"PRODUCT_IMAGE",duration:number|null){
  const path=videoStoragePath(owner,"products",productId,`${randomUUID()}-${file}`);
  const bytes=await readFile(join(mediaDir,file));
  must(await admin.storage.from(videoStorageBucket).upload(path,bytes,{contentType:type==="VIDEO"?"video/mp4":"image/png"}),"upload");
  const asset=must(await admin.from("media_assets").insert({owner_id:owner,product_id:productId,asset_type:type,source_type:"UPLOAD",storage_path:path,
    mime_type:type==="VIDEO"?"video/mp4":"image/png",width:1080,height:1920,duration_seconds:duration,provider:"owner-upload",model:"pilot-original-drawing",
    checksum:createHash("sha256").update(bytes).digest("hex")}).select("id").single(),"asset");
  return String(asset.id);
}

async function clearRights(admin:SupabaseClient,owner:string,assetId:string,role:"REAL_FOOTAGE"|"REAL_IMAGE",accountId:string){
  const {id}=await recordMediaRights(admin,owner,{mediaAssetId:assetId,originSource:"OWNER_CREATED",assetRole:role,
    sourceReference:"System-drawn test media (scripts/pilot/make_mock_product.py). Fictional product, not for publishing.",rightsholder:"ViralFlow pilot owner",
    licenseType:"Original work created for this test",allowsCommercial:true,allowsEdit:true,allowsPromotion:true,depictsProductOperation:false,
    platformScope:["TIKTOK"],accountScope:[accountId],musicConstraints:"",likenessConstraints:"",expiresAt:undefined} as never,null);
  await reviewMediaRights(admin,owner,id,"APPROVED");return id;
}

async function runProject(user:SupabaseClient,owner:string,assignmentId:string,label:string){
  const timings:Record<string,number>={};let t=Date.now();
  const project=await createProjectFromAssignment(user,owner,assignmentId);
  const generated=await generateEvidenceStrategyProject(user,owner,String(project.id));timings.creativeSeconds=(Date.now()-t)/1000;
  const plan=generated.intelligence.plan,selected=plan.concepts.find(c=>c.id===plan.selectedConceptId)!;
  log(`${label}.creative`,{selected:selected.id,method:selected.production.method,ready:selected.production.ready,missing:selected.production.missingEvidence,
    concepts:plan.concepts.map(c=>({id:c.id,status:c.status,method:c.production.method}))});
  const row=must(await user.from("creative_projects").select("selected_angle_id,selected_script_id").eq("id",String(project.id)).single(),"project");
  // Stand-in for the owner's review screen: the pilot owner signs the same three checks a person ticks.
  await approveEvidenceCreative(user,owner,String(project.id),String(row.selected_angle_id),String(row.selected_script_id),
    {creativeApproved:true,factualAccuracyApproved:true,mediaRightsApproved:true});
  const script=must(await user.from("scripts").select("hook_text,voice_script,cta_text,caption").eq("id",String(row.selected_script_id)).single(),"script");
  t=Date.now();const master=await buildMasterVideo(user,owner,String(project.id));timings.renderSeconds=(Date.now()-t)/1000;
  const stored=must(await user.from("master_videos").select("id,status,quality_status,quality_score,quality_explanation_json,storage_path,model,estimated_cost_usd").eq("id",String(master.id)).single(),"master");
  const file=join(outDir,`${label}.mp4`);
  const blob=await user.storage.from(videoStorageBucket).download(String(stored.storage_path));
  if(blob.error||!blob.data)throw new Error(`download: ${blob.error?.message}`);
  await writeFile(file,new Uint8Array(await blob.data.arrayBuffer()));
  log(`${label}.master`,{status:stored.status,quality:stored.quality_status,score:stored.quality_score,timings});
  return {projectId:String(project.id),masterId:String(stored.id),selected:{id:selected.id,method:selected.production.method},script,master:stored,timings};
}

async function main(){
  await mkdir(outDir,{recursive:true});
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const email=`pilot-${Date.now()}@example.test`,password=randomUUID();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
  const owner=created.data.user.id;
  const user=createClient(url,anon,{auth:{persistSession:false}});
  const signedIn=await user.auth.signInWithPassword({email,password});if(signedIn.error)throw signedIn.error;
  log("owner",{owner});

  // Affiliate: original mock product footage and still, cleared in the ledger for the sandbox account only.
  const affiliate=await sandbox(admin,owner,"AFFILIATE","ขวดน้ำเก็บความเย็น ฟ้าเย็น 500 มล. (สินค้าทดสอบ)");
  const clip=await uploadMedia(admin,owner,affiliate.productId,"mock-bottle.mp4","VIDEO",10);
  const still=await uploadMedia(admin,owner,affiliate.productId,"mock-bottle.png","PRODUCT_IMAGE",null);
  const rights=[await clearRights(admin,owner,clip,"REAL_FOOTAGE",affiliate.accountId),await clearRights(admin,owner,still,"REAL_IMAGE",affiliate.accountId)];
  const day=new Date(Date.now()-3600000).toISOString();
  for(const statement of ["ขวดสีฟ้า ฝาสีดำมีห่วงหิ้ว","ความจุ 500 มิลลิลิตร"])
    await addContentEvidence(admin,owner,{productId:affiliate.productId,statement,source:"OWNER_FOOTAGE",sourceReference:"Visible in the pilot test media",role:"SELLING_POINT",capturedAt:day});
  log("affiliate.rights",{clip,still,rights});

  // Growth: no media at all; one short verified fact for an original graphic story.
  const growth=await sandbox(admin,owner,"GROWTH","หัวข้อจัดโต๊ะ (บัญชีทดสอบ)");
  await addContentEvidence(admin,owner,{productId:growth.productId,statement:"วางของใช้บ่อยไว้ใกล้มือ",source:"AUTHORIZED_SOURCE",sourceReference:"Pilot fact written for this test",role:"OBSERVATION",capturedAt:day});

  const results:Record<string,unknown>={};
  for(const [label,s] of [["affiliate",affiliate],["growth",growth]] as const){
    try{results[label]=await runProject(user,owner,s.assignmentId,label)}catch(error){results[label]={error:error instanceof Error?error.message:String(error)};log(`${label}.failed`,results[label] as object)}
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
  log("done",{ok:Object.values(results).every(r=>!(r as {error?:string}).error)});
}
main().catch(error=>{console.error(error);process.exit(1)});
