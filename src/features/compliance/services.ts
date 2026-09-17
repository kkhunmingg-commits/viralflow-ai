import type {SupabaseClient} from "@supabase/supabase-js";
import {runContentComplianceCheck} from "./compliance";
import {calculateOriginality} from "./originality";
import {calculateAccountPublishHealth,evaluatePublishEligibility} from "./publishing";
import type {OriginalityMetadata} from "./types";

type Row=Record<string,unknown>;
async function one(client:SupabaseClient,table:string,owner:string,id:string){
  const {data,error}=await client.from(table).select("*").eq("owner_id",owner).eq("id",id).maybeSingle();
  if(error)throw new Error(error.message);
  return data as Row|null;
}
const text=(value:unknown)=>String(value??"");

function latestByVideo<T extends {video_id:string}>(rows:T[]){
  const latest=new Map<string,T>();
  for(const row of rows)if(!latest.has(row.video_id))latest.set(row.video_id,row);
  return latest;
}

export async function runPrePublishGate(client:SupabaseClient,owner:string,kind:"master"|"variation",videoId:string,userApproved=false){
  const video=await one(client,kind==="master"?"master_videos":"video_variations",owner,videoId);
  if(!video)throw new Error("Video not found");
  const master=kind==="master"?video:await one(client,"master_videos",owner,text(video.master_video_id));
  if(!master)throw new Error("Master video not found");

  const [project,script,account,product,angle]=await Promise.all([
    one(client,"creative_projects",owner,text(master.creative_project_id)),
    one(client,"scripts",owner,text(master.selected_script_id)),
    one(client,"tiktok_accounts",owner,text(master.tiktok_account_id)),
    one(client,"products",owner,text(master.product_id)),
    client.from("creative_angles").select("*").eq("owner_id",owner).eq("creative_project_id",text(master.creative_project_id)).eq("is_selected",true).maybeSingle().then(result=>{if(result.error)throw new Error(result.error.message);return result.data as Row|null}),
  ]);
  if(!project||!script||!account||!product)throw new Error("Compliance context is incomplete");

  const scriptText=[script.hook_text,script.voice_script,script.cta_text,script.caption].map(text).join(" ");
  const approvedFacts=[product.title,product.description,product.brand].filter(Boolean).map(text);
  const effectiveMode=text(account.effective_mode||project.mode) as "GROWTH"|"AFFILIATE";
  const compliance=runContentComplianceCheck({
    text:scriptText,
    approvedProductFacts:approvedFacts,
    mode:effectiveMode,
    cartAvailable:account.cart_enabled===true,
    affiliateAvailable:account.ecommerce_permission===true,
    inheritedRisk:(angle?.policy_status??"REVIEW") as "SAFE"|"REVIEW"|"REJECT",
    aiGenerated:true,
    aiModified:true,
    provider:text(master.provider),
    provenanceAvailable:Boolean(master.storage_path),
  });

  const [masters,variations,scripts,todayStats,previousHealth]=await Promise.all([
    client.from("master_videos").select("id,tiktok_account_id,product_id,creative_project_id,selected_script_id").eq("owner_id",owner),
    client.from("video_variations").select("id,master_video_id,tiktok_account_id,product_id,creative_project_id,hook_variant,cta_variant,scene_config_json,audio_config_json").eq("owner_id",owner),
    client.from("scripts").select("id,hook_text,cta_text,scene_plan_json").eq("owner_id",owner),
    client.from("account_daily_stats").select("posts_published,posts_failed").eq("owner_id",owner).eq("tiktok_account_id",text(master.tiktok_account_id)).eq("stat_date",new Date().toISOString().slice(0,10)).maybeSingle(),
    client.from("account_publish_health").select("observed_platform_cap,internal_safety_limit").eq("owner_id",owner).eq("tiktok_account_id",text(master.tiktok_account_id)).maybeSingle(),
  ]);
  for(const result of [masters,variations,scripts,todayStats,previousHealth])if(result.error)throw new Error(result.error.message);

  const scriptMap=new Map((scripts.data??[]).map(item=>[item.id,item]));
  const history:OriginalityMetadata[]=[
    ...(masters.data??[]).map(item=>{const itemScript=scriptMap.get(item.selected_script_id);return {videoId:item.id,accountId:item.tiktok_account_id,masterId:item.id,productId:item.product_id,creativeProjectId:item.creative_project_id,hook:itemScript?.hook_text??"",scenes:itemScript?.scene_plan_json??[],cta:itemScript?.cta_text??"",audio:{voice:"master"}}}),
    ...(variations.data??[]).map(item=>({videoId:item.id,accountId:item.tiktok_account_id,masterId:item.master_video_id,productId:item.product_id,creativeProjectId:item.creative_project_id,hook:item.hook_variant,scenes:item.scene_config_json,cta:item.cta_variant,audio:item.audio_config_json})),
  ];
  const candidate:OriginalityMetadata=kind==="master"
    ?{videoId,accountId:text(master.tiktok_account_id),masterId:text(master.id),productId:text(master.product_id),creativeProjectId:text(master.creative_project_id),hook:text(script.hook_text),scenes:script.scene_plan_json,cta:text(script.cta_text),audio:{voice:"master"}}
    :{videoId,accountId:text(video.tiktok_account_id),masterId:text(video.master_video_id),productId:text(video.product_id),creativeProjectId:text(video.creative_project_id),hook:text(video.hook_variant),scenes:video.scene_config_json,cta:text(video.cta_variant),audio:video.audio_config_json};
  const originality=calculateOriginality(candidate,history);
  const postsToday=Number(todayStats.data?.posts_published??0);
  const failedPostsToday=Number(todayStats.data?.posts_failed??0);
  const health=calculateAccountPublishHealth({
    effectiveMode,
    authorizationStatus:text(account.authorization_status),
    sourceAccountStatus:text(account.account_status),
    dailyTarget:Number(account.daily_post_target),
    dailyHardLimit:Number(account.daily_post_hard_limit),
    observedPlatformCap:previousHealth.data?.observed_platform_cap==null?null:Number(previousHealth.data.observed_platform_cap),
    internalSafetyLimit:Number(previousHealth.data?.internal_safety_limit??10),
    postsToday,
    failedPostsToday,
    shopPermission:account.ecommerce_permission===true,
    cartEnabled:account.cart_enabled===true,
  });
  const eligibility=evaluatePublishEligibility({
    complianceStatus:compliance.overallStatus,
    originalityStatus:originality.status,
    qualityStatus:text(video.quality_status),
    health,
    requiresShopPermission:effectiveMode==="AFFILIATE",
    shopPermission:account.ecommerce_permission===true&&account.cart_enabled===true,
    userApproved,
  });

  const now=new Date().toISOString();
  const healthRow={
    owner_id:owner,
    tiktok_account_id:master.tiktok_account_id,
    requested_mode:account.mode,
    effective_mode:effectiveMode,
    account_status:health.accountStatus,
    authorization_status:account.authorization_status,
    daily_target:account.daily_post_target,
    daily_hard_limit:account.daily_post_hard_limit,
    observed_platform_cap:previousHealth.data?.observed_platform_cap??null,
    internal_safety_limit:previousHealth.data?.internal_safety_limit??10,
    effective_publish_cap:health.effectivePublishCap,
    posts_today:postsToday,
    failed_posts_today:failedPostsToday,
    health_status:health.healthStatus,
    blockers_json:health.blockers,
  };
  const [complianceInsert,originalityInsert,healthUpsert,eligibilityInsert]=await Promise.all([
    client.from("content_compliance_checks").insert({owner_id:owner,video_id:videoId,creative_project_id:master.creative_project_id,tiktok_account_id:master.tiktok_account_id,claim_status:compliance.claimStatus,product_truth_status:compliance.productTruthStatus,aigc_status:compliance.aigcStatus,policy_status:compliance.policyStatus,overall_status:compliance.overallStatus,issues_json:compliance.issues,explanation_json:{version:compliance.version,aigc:compliance.aigc},checked_at:now}),
    client.from("originality_checks").insert({owner_id:owner,video_id:videoId,tiktok_account_id:master.tiktok_account_id,same_account_similarity:originality.sameAccountSimilarity,cross_account_similarity:originality.crossAccountSimilarity,hook_similarity:originality.hookSimilarity,scene_similarity:originality.sceneSimilarity,audio_similarity:originality.audioSimilarity,overall_similarity:originality.overallSimilarity,originality_status:originality.status,matched_video_ids_json:originality.matchedVideoIds,explanation_json:{version:originality.version}}),
    client.from("account_publish_health").upsert(healthRow,{onConflict:"owner_id,tiktok_account_id"}),
    client.from("publish_eligibility_checks").insert({owner_id:owner,video_id:videoId,tiktok_account_id:master.tiktok_account_id,compliance_pass:eligibility.compliancePass,originality_pass:eligibility.originalityPass,quality_pass:eligibility.qualityPass,account_health_pass:eligibility.accountHealthPass,creator_limit_pass:eligibility.creatorLimitPass,shop_permission_pass:eligibility.shopPermissionPass,user_approval_required:true,user_approved:userApproved,final_status:eligibility.finalStatus,blockers_json:eligibility.blockers}),
  ]);
  for(const result of [complianceInsert,originalityInsert,healthUpsert,eligibilityInsert])if(result.error)throw new Error(result.error.message);
  return {compliance,originality,health,eligibility};
}

export async function listComplianceDashboard(client:SupabaseClient,owner:string){
  const [eligibility,compliance,originality,health,accounts,masters,variations,products]=await Promise.all([
    client.from("publish_eligibility_checks").select("*").eq("owner_id",owner).order("created_at",{ascending:false}),
    client.from("content_compliance_checks").select("*").eq("owner_id",owner).order("checked_at",{ascending:false}),
    client.from("originality_checks").select("*").eq("owner_id",owner).order("created_at",{ascending:false}),
    client.from("account_publish_health").select("*").eq("owner_id",owner).order("updated_at",{ascending:false}),
    client.from("tiktok_accounts").select("id,display_name,mode,effective_mode").eq("owner_id",owner),
    client.from("master_videos").select("id,product_id").eq("owner_id",owner),
    client.from("video_variations").select("id,master_video_id,product_id").eq("owner_id",owner),
    client.from("products").select("id,title").eq("owner_id",owner),
  ]);
  for(const result of [eligibility,compliance,originality,health,accounts,masters,variations,products])if(result.error)throw new Error(result.error.message);
  const accountMap=new Map((accounts.data??[]).map(account=>[account.id,account]));
  const masterMap=new Map((masters.data??[]).map(master=>[master.id,master.product_id]));
  const variationMap=new Map((variations.data??[]).map(variation=>[variation.id,variation]));
  const productMap=new Map((products.data??[]).map(product=>[product.id,product.title]));
  const complianceMap=latestByVideo(compliance.data??[]);
  const originalityMap=latestByVideo(originality.data??[]);
  const latestEligibility=[...latestByVideo(eligibility.data??[]).values()];
  return {
    items:latestEligibility.map(item=>{
      const variation=variationMap.get(item.video_id);
      const productId=variation?.product_id??masterMap.get(item.video_id);
      const account=accountMap.get(item.tiktok_account_id);
      return {...item,account_name:account?.display_name??"Unknown",requested_mode:account?.mode??"—",effective_mode:account?.effective_mode??"—",product_title:productMap.get(productId??"")??"Video",video_link_id:variation?.master_video_id??item.video_id,compliance:complianceMap.get(item.video_id),originality:originalityMap.get(item.video_id)};
    }),
    health:(health.data??[]).map(item=>({...item,account_name:accountMap.get(item.tiktok_account_id)?.display_name??"Unknown"})),
  };
}

export async function getLatestVideoGate(client:SupabaseClient,owner:string,videoId:string){
  const get=(table:string,order:string)=>client.from(table).select("*").eq("owner_id",owner).eq("video_id",videoId).order(order,{ascending:false}).limit(1).maybeSingle();
  const [compliance,originality,eligibility]=await Promise.all([get("content_compliance_checks","checked_at"),get("originality_checks","created_at"),get("publish_eligibility_checks","created_at")]);
  for(const result of [compliance,originality,eligibility])if(result.error)throw new Error(result.error.message);
  let health:Row|null=null;
  if(eligibility.data?.tiktok_account_id){
    const result=await client.from("account_publish_health").select("*").eq("owner_id",owner).eq("tiktok_account_id",eligibility.data.tiktok_account_id).maybeSingle();
    if(result.error)throw new Error(result.error.message);
    health=result.data as Row|null;
  }
  return {compliance:compliance.data,originality:originality.data,eligibility:eligibility.data,health};
}
