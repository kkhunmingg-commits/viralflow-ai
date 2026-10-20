/* Shared pilot helpers for a throwaway local Supabase stack (supabase start), never a hosted project.
 * Sandbox accounts have no TikTok credentials; every rights record is scoped to the sandbox account. */
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
import {approveEvidenceCreative,createProjectFromAssignment,generateEvidenceStrategyProject} from "../../src/features/creative/services";
import {recordMediaRights,reviewMediaRights} from "../../src/features/video/media-rights-service";
import {buildMasterVideo} from "../../src/features/video/services";
import {videoStorageBucket,videoStoragePath} from "../../src/features/video/storage";

export type Row=Record<string,unknown>;
export const log=(step:string,detail:unknown={})=>console.log(JSON.stringify({step,...(detail as object)}));
export const must=(result:{data:unknown;error:{message:string}|null},what:string):Row=>{if(result.error||result.data==null)throw new Error(`${what}: ${result.error?.message??"no data"}`);return result.data as Row};

/** A fresh owner with a service client (server side) and a signed-in client (the owner's review). */
export async function pilotOwner(){
  const url=process.env.SUPABASE_URL!,service=process.env.SUPABASE_SERVICE_KEY!,anon=process.env.SUPABASE_ANON_KEY!;
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const email=`pilot-${Date.now()}@example.test`,password=randomUUID();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
  const user=createClient(url,anon,{auth:{persistSession:false}});
  const signedIn=await user.auth.signInWithPassword({email,password});if(signedIn.error)throw signedIn.error;
  return {admin,user,owner:created.data.user.id};
}

export async function sandboxAccount(admin:SupabaseClient,owner:string,mode:"AFFILIATE"|"GROWTH",config:Row={}){
  const account=must(await admin.from("tiktok_accounts").insert({owner_id:owner,display_name:`Pilot sandbox ${mode} (no TikTok login)`,mode,
    is_mock:false,authorization_status:"authorized",
    // effective_mode is generated: Affiliate needs these shop flags, Growth ignores them.
    ...(mode==="AFFILIATE"?{follower_count:1000,shop_creator_eligible:true,ecommerce_permission:true,cart_enabled:true}:{}),account_notes:"Throwaway pilot record in a local database. No TikTok token exists."}).select("id").single(),"account");
  const accountId=String(account.id);
  must(await admin.from("auto_account_discovery").insert({owner_id:owner,tiktok_account_id:accountId,mode,verified:true,can_execute:true,affiliate_allowed:mode==="AFFILIATE",
    valid_until:new Date(Date.now()+86400000).toISOString()}).select("tiktok_account_id").single(),"permission");
  if(Object.keys(config).length)must(await admin.from("account_automation_settings").upsert({owner_id:owner,tiktok_account_id:accountId,config},{onConflict:"owner_id,tiktok_account_id"}).select("tiktok_account_id").single(),"settings");
  return accountId;
}

export async function sandboxProduct(admin:SupabaseClient,owner:string,title:string){
  const now=new Date().toISOString();
  return String(must(await admin.from("products").insert({owner_id:owner,external_provider:"pilot-mock",external_product_id:randomUUID(),title,slug:`pilot-${randomUUID()}`,
    category_key:"home",current_price:199,commission_rate:.1,commission_amount:19.9,review_count:0,units_sold:0,status:"available",
    provider_metadata:{pilot:true,note:"Fictional product drawn for pipeline testing"},first_seen_at:now,last_seen_at:now}).select("id").single(),"product").id);
}

/** One scored, selected assignment. Assignments are unique per product and day, so repeats use earlier days. */
// Days count back from when the pilot started, so a run that crosses midnight cannot reuse a day.
const PILOT_START=Date.now();
export async function sandboxAssignment(admin:SupabaseClient,owner:string,accountId:string,productId:string,mode:"AFFILIATE"|"GROWTH",daysAgo=0){
  const now=new Date().toISOString(),day=new Date(PILOT_START-daysAgo*86400000).toISOString().slice(0,10),c=50;
  const score=must(await admin.from("account_product_scores").insert({owner_id:owner,tiktok_account_id:accountId,product_id:productId,run_id:randomUUID(),calculated_at:now,
    product_component:c,category_component:c,account_category_component:c,commercial_component:c,mode_fit_component:c,confidence_component:c,freshness_component:c,competition_component:c,
    account_product_fit_score:c,final_viral_opportunity_score:c,effective_mode:mode,eligible:true,score_version:"pilot",explanation_json:{pilot:true}}).select("id").single(),"score");
  return String(must(await admin.from("product_assignments").insert({owner_id:owner,tiktok_account_id:accountId,product_id:productId,category_key:"home",score_id:score.id,
    assignment_date:day,rank_for_account:1,effective_mode:mode,final_score:c,status:"SELECTED",score_version:"pilot",reason_json:{pilot:true}}).select("id").single(),"assignment").id);
}

export async function uploadMedia(admin:SupabaseClient,owner:string,productId:string,mediaDir:string,file:string,type:"VIDEO"|"PRODUCT_IMAGE",duration:number|null){
  const path=videoStoragePath(owner,"products",productId,`${randomUUID()}-${file}`);
  const bytes=await readFile(join(mediaDir,file));
  must(await admin.storage.from(videoStorageBucket).upload(path,bytes,{contentType:type==="VIDEO"?"video/mp4":"image/png"}),"upload");
  const asset=must(await admin.from("media_assets").insert({owner_id:owner,product_id:productId,asset_type:type,source_type:"UPLOAD",storage_path:path,
    mime_type:type==="VIDEO"?"video/mp4":"image/png",width:1080,height:1920,duration_seconds:duration,provider:"owner-upload",model:"pilot-original-drawing",
    checksum:createHash("sha256").update(bytes).digest("hex")}).select("id").single(),"asset");
  return String(asset.id);
}

export async function clearRights(admin:SupabaseClient,owner:string,assetId:string,role:"REAL_FOOTAGE"|"REAL_IMAGE",accountId:string){
  const {id}=await recordMediaRights(admin,owner,{mediaAssetId:assetId,originSource:"OWNER_CREATED",assetRole:role,
    sourceReference:"System-drawn test media (scripts/pilot/make_mock_product.py). Fictional product, not for publishing.",rightsholder:"ViralFlow pilot owner",
    licenseType:"Original work created for this test",allowsCommercial:true,allowsEdit:true,allowsPromotion:true,depictsProductOperation:false,
    platformScope:["TIKTOK"],accountScope:[accountId],musicConstraints:"",likenessConstraints:"",expiresAt:undefined} as never,null);
  await reviewMediaRights(admin,owner,id,"APPROVED");return id;
}

/** Creative Brain -> owner review stand-in -> Video Factory, then the stored master is downloaded to outDir. */
export async function runProject(admin:SupabaseClient,user:SupabaseClient,owner:string,assignmentId:string,label:string,outDir:string){
  const timings:Record<string,number>={};let t=Date.now();
  // Planning and rendering run as the server does (service role); only the review runs as the signed-in owner.
  const project=await createProjectFromAssignment(admin,owner,assignmentId);
  const generated=await generateEvidenceStrategyProject(admin,owner,String(project.id),{forAutoWorker:true});timings.creativeSeconds=(Date.now()-t)/1000;
  const plan=generated.intelligence.plan,selected=plan.concepts.find(c=>c.id===plan.selectedConceptId)!;
  // What the model thought and chose, next to what the gates and the experiment did with it.
  const intel=generated.intelligence as {output?:{selectedId?:string;selectionReason?:string;alternativesReason?:string}|null;raw?:{brainstorm?:string;wallSeconds?:number}|null;
    decision?:{status?:string}|null;usage?:unknown};
  const ai={source:plan.source,llmSelectedId:intel.output?.selectedId??null,finalSelectedId:plan.selectedConceptId,experiment:intel.decision?.status??null,
    selectionReason:intel.output?.selectionReason??null,alternativesReason:intel.output?.alternativesReason??null,brainstorm:intel.raw?.brainstorm??null,
    llmSeconds:intel.raw?.wallSeconds??null,usage:intel.usage??null,
    ideas:plan.concepts.map(c=>({id:c.id,status:c.status,method:c.production.method,format:c.production.story?.format??null,hook:c.concept.hook,
      beats:c.production.story?.beats.map(b=>b.text)??null,reasons:c.reasons}))};
  log(`${label}.ai`,ai);
  log(`${label}.creative`,{selected:selected.id,method:selected.production.method,ready:selected.production.ready,missing:selected.production.missingEvidence,
    topic:plan.topic,topicBasis:plan.topicBasis,story:selected.production.story,concepts:plan.concepts.map(c=>({id:c.id,status:c.status,method:c.production.method}))});
  const row=must(await user.from("creative_projects").select("selected_angle_id,selected_script_id").eq("id",String(project.id)).single(),"project");
  // Stand-in for the owner's review screen: the pilot owner signs the same three checks a person ticks.
  await approveEvidenceCreative(user,owner,String(project.id),String(row.selected_angle_id),String(row.selected_script_id),
    {creativeApproved:true,factualAccuracyApproved:true,mediaRightsApproved:true});
  const script=must(await user.from("scripts").select("hook_text,voice_script,cta_text,caption,hashtags_json").eq("id",String(row.selected_script_id)).single(),"script");
  t=Date.now();const master=await buildMasterVideo(admin,owner,String(project.id));timings.renderSeconds=(Date.now()-t)/1000;
  const stored=must(await admin.from("master_videos").select("id,status,quality_status,quality_score,quality_explanation_json,storage_path,model,estimated_cost_usd").eq("id",String(master.id)).single(),"master");
  const blob=await admin.storage.from(videoStorageBucket).download(String(stored.storage_path));
  if(blob.error||!blob.data)throw new Error(`download: ${blob.error?.message}`);
  await writeFile(join(outDir,`${label}.mp4`),new Uint8Array(await blob.data.arrayBuffer()));
  log(`${label}.master`,{status:stored.status,quality:stored.quality_status,score:stored.quality_score,timings});
  return {projectId:String(project.id),masterId:String(stored.id),selected:{id:selected.id,method:selected.production.method,story:selected.production.story,topic:plan.topic,topicBasis:plan.topicBasis,warnings:plan.warnings},ai,script,master:stored,timings};
}
