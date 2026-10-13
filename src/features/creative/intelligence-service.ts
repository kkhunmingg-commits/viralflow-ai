import type {SupabaseClient} from "@supabase/supabase-js";
import type {CreativeContext} from "./types";
import {planExistingCreativeContext} from "./intelligence";
import type {CreativeOutcome} from "../analytics/creative-learning";
import type {TrendObservation} from "../growth-manager/topics";
import {ownsVideoStoragePath} from "../video/storage";

type Row=Record<string,unknown>;
const optionalMissing=(error:{code?:string}|null)=>error&&["42P01","PGRST205"].includes(error.code??"");
const metric=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null;

/** Owner/account-scoped reads only; never calls OAuth, providers, tokens, scheduler, or publishing. */
export async function readCreativeIntelligence(client:SupabaseClient,owner:string,context:CreativeContext,
  options:{now?:Date;trends?:TrendObservation[]}={}) {
  const now=options.now??new Date(),accountId=context.account.id;
  const [account,assets,permission]=await Promise.all([
    client.from("tiktok_accounts").select("id,is_mock,authorization_status").eq("owner_id",owner).eq("id",accountId).maybeSingle(),
    client.from("media_assets").select("id,product_id,asset_type,source_type,storage_path,duration_seconds").eq("owner_id",owner).eq("product_id",context.product.id).in("source_type",["UPLOAD","PRODUCT"]),
    client.from("auto_account_discovery").select("can_execute,affiliate_allowed,valid_until").eq("owner_id",owner).eq("tiktok_account_id",accountId).maybeSingle(),
  ]);
  if(account.error||!account.data||assets.error||(permission.error&&!optionalMissing(permission.error)))throw new Error("CREATIVE_INTELLIGENCE_SOURCE_UNAVAILABLE");
  const realAccount=account.data.is_mock===false && account.data.authorization_status==="authorized";
  const optedIn=realAccount&&permission.data?.can_execute===true&&Date.parse(String(permission.data.valid_until))>now.getTime();
  const affiliateEligible=optedIn&&permission.data?.affiliate_allowed===true;
  const outcomes:CreativeOutcome[]=[];
  if(optedIn){
    const since=new Date(now.getTime()-30*86400000).toISOString();
    const snapshots=await client.from("video_analytics_snapshots").select("*").eq("owner_id",owner).eq("tiktok_account_id",accountId)
      .in("source",["TIKTOK_DISPLAY","TIKTOK_SHOP_ANALYTICS"]).gte("source_snapshot_at",since).order("source_snapshot_at",{ascending:false}).limit(200);
    if(snapshots.error&&!optionalMissing(snapshots.error))throw new Error("CREATIVE_ANALYTICS_UNAVAILABLE");
    const rows=(snapshots.data??[]) as Row[],ids=[...new Set(rows.filter(r=>r.video_kind==="MASTER").map(r=>String(r.video_id)))];
    if(ids.length){
      const masters=await client.from("master_videos").select("id,creative_project_id,selected_script_id,created_at").eq("owner_id",owner).eq("tiktok_account_id",accountId).in("id",ids);
      if(masters.error)throw new Error("CREATIVE_ANALYTICS_UNAVAILABLE");
      const projectIds=[...new Set((masters.data??[]).map(r=>String(r.creative_project_id)))];
      const scriptIds=[...new Set((masters.data??[]).map(r=>String(r.selected_script_id)))];
      if(projectIds.length&&scriptIds.length){
        const [projects,scripts]=await Promise.all([
          client.from("creative_projects").select("id,mode").eq("owner_id",owner).eq("tiktok_account_id",accountId).in("id",projectIds),
          client.from("scripts").select("id,creative_project_id,creative_angle_id,hook_text,updated_at").eq("owner_id",owner).in("id",scriptIds).in("creative_project_id",projectIds),
        ]);
        if(projects.error||scripts.error)throw new Error("CREATIVE_ANALYTICS_UNAVAILABLE");
        const angleIds=[...new Set((scripts.data??[]).map(r=>String(r.creative_angle_id)))];
        const angles=angleIds.length?await client.from("creative_angles").select("id,creative_project_id,angle_type").eq("owner_id",owner).in("id",angleIds).in("creative_project_id",projectIds):{data:[],error:null};
        if(angles.error)throw new Error("CREATIVE_ANALYTICS_UNAVAILABLE");
        for(const row of rows){
          const master=masters.data?.find(m=>m.id===row.video_id),project=projects.data?.find(p=>p.id===master?.creative_project_id);
          const script=scripts.data?.find(s=>s.id===master?.selected_script_id),angle=angles.data?.find(a=>a.id===script?.creative_angle_id);
          if(row.video_kind!=="MASTER"||!master||!project||project.mode!==context.account.mode||!script||!angle||
            script.creative_project_id!==project.id||angle.creative_project_id!==project.id)continue;
          // A post's historical hook cannot be reconstructed from a script edited after rendering.
          const unchanged=Date.parse(String(script.updated_at))<=Date.parse(String(master.created_at));
          outcomes.push({evidenceId:String(row.id),ownerId:owner,accountId,videoId:String(row.video_id),mode:project.mode,
            source:row.source as CreativeOutcome["source"],authorized:realAccount,observedAt:String(row.source_snapshot_at),
            hook:unchanged?String(script.hook_text):"",angle:unchanged?String(angle.angle_type):"",
            metrics:{views:metric(row.views),likes:metric(row.likes),comments:metric(row.comments),shares:metric(row.shares),favorites:metric(row.favorites),clicks:metric(row.clicks),orders:metric(row.orders),gmv:metric(row.gmv),commission:metric(row.commission)},
            // The existing Display ingestion does not provide these metrics or per-video follower attribution.
            attributedFollowers:null,retention:null,completionRate:null});
        }
      }
    }
  }
  const availableAssets=(assets.data??[]).filter(a=>ownsVideoStoragePath(owner,String(a.storage_path))&&["PRODUCT_IMAGE","IMAGE","VIDEO"].includes(a.asset_type));
  const result=planExistingCreativeContext(context,{ownerId:owner,now,optedIn,affiliateEligible,realAccount,
    facts:[],trends:options.trends??[],outcomes,mechanism:"UNKNOWN",
    // Upload/catalog presence does not attest rights, real product identity, or correct mechanism operation.
    assets:availableAssets.map(a=>({id:String(a.id),kind:a.asset_type==="VIDEO"?"REAL_FOOTAGE":"REAL_IMAGE",source:a.source_type==="UPLOAD"?"OWNER":"AUTHORIZED_CATALOG",
      reference:String(a.storage_path),productId:String(a.product_id),durationSeconds:metric(a.duration_seconds)??undefined,rightsConfirmed:false,reviewed:false}))});
  return {...result,evidenceReadiness:{availableAssetCount:availableAssets.length,verifiedProductFactCount:0,
    reason:"ภาพอัปโหลดและข้อมูลสินค้าเดิมยังไม่ใช่หลักฐานที่ผ่านการตรวจสิทธิ์และความถูกต้อง",analyticsWindow:"Latest 200 snapshots within 30 days; partial coverage is not total account performance"}};
}
