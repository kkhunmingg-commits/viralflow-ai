import type {SupabaseClient} from "@supabase/supabase-js";
import type {AccountBaseline,AnalyticsSummary,LearningSignalRow,VideoSnapshotRow,WinnerRow} from "./types";
import type {WinnerResult} from "./types";
import type {VideoAnalyticsObservation} from "./provider";
import {evidenceHash} from "./scoring";

async function read<T>(client:SupabaseClient,table:string,ownerId:string,limit=500){const {data,error}=await client.from(table).select("*").eq("owner_id",ownerId).order("created_at",{ascending:false}).limit(limit);if(error)throw new Error(`Analytics query failed: ${error.message}`);return(data??[]) as T[];}
function latestWinners(rows:WinnerRow[]){const latest=new Map<string,WinnerRow>();for(const row of rows)if(!latest.has(`${row.video_kind}:${row.video_id}`))latest.set(`${row.video_kind}:${row.video_id}`,row);return [...latest.values()];}
export async function getAnalyticsOverview(client:SupabaseClient,ownerId:string){
 const [scores,snapshots,accounts,products]=await Promise.all([read<WinnerRow>(client,"winner_scores",ownerId),read<VideoSnapshotRow>(client,"video_analytics_snapshots",ownerId),client.from("tiktok_accounts").select("id,display_name,effective_mode").eq("owner_id",ownerId),client.from("products").select("id,title").eq("owner_id",ownerId)]);
 if(accounts.error)throw new Error(accounts.error.message);if(products.error)throw new Error(products.error.message);
 const winners=latestWinners(scores);const summary:AnalyticsSummary={totalVideos:winners.length,scale:winners.filter(x=>x.decision==="SCALE").length,watch:winners.filter(x=>x.decision==="WATCH").length,stop:winners.filter(x=>x.decision==="STOP").length,insufficient:winners.filter(x=>x.decision==="INSUFFICIENT_DATA").length,views:snapshots.reduce((s,x)=>s+(x.views??0),0),orders:snapshots.reduce((s,x)=>s+(x.orders??0),0),gmv:snapshots.reduce((s,x)=>s+(x.gmv??0),0),commission:snapshots.reduce((s,x)=>s+(x.commission??0),0)};
 return{summary,winners,snapshots,accounts:(accounts.data??[]) as Array<{id:string;display_name:string;effective_mode:string}>,products:(products.data??[]) as Array<{id:string;title:string}>};
}
export async function getAccountAnalytics(client:SupabaseClient,ownerId:string,id:string){
 const [account,winners,snapshots]=await Promise.all([
  client.from("tiktok_accounts").select("id,display_name,effective_mode").eq("owner_id",ownerId).eq("id",id).maybeSingle(),
  client.from("winner_scores").select("*").eq("owner_id",ownerId).eq("tiktok_account_id",id).order("evaluated_at",{ascending:false}).limit(500),
  client.from("video_analytics_snapshots").select("*").eq("owner_id",ownerId).eq("tiktok_account_id",id).order("source_snapshot_at",{ascending:false}).limit(500),
 ]);if(account.error||winners.error||snapshots.error)throw new Error("Analytics query failed");if(!account.data)return null;
 return{account:account.data,winners:latestWinners((winners.data??[]) as WinnerRow[]),snapshots:(snapshots.data??[]) as VideoSnapshotRow[]};
}
export async function getVideoAnalytics(client:SupabaseClient,ownerId:string,id:string){
 const [snapshots,winners]=await Promise.all([
  client.from("video_analytics_snapshots").select("*").eq("owner_id",ownerId).eq("video_id",id).order("source_snapshot_at",{ascending:false}).limit(500),
  client.from("winner_scores").select("*").eq("owner_id",ownerId).eq("video_id",id).order("evaluated_at",{ascending:false}).limit(500),
 ]);if(snapshots.error||winners.error)throw new Error("Analytics query failed");if(!snapshots.data?.length)return null;
 return{snapshots:snapshots.data as VideoSnapshotRow[],winners:latestWinners((winners.data??[]) as WinnerRow[])};
}
export async function getProductAnalytics(client:SupabaseClient,ownerId:string,id:string){
 const [product,snapshots]=await Promise.all([
  client.from("products").select("id,title").eq("owner_id",ownerId).eq("id",id).maybeSingle(),
  client.from("video_analytics_snapshots").select("*").eq("owner_id",ownerId).eq("product_id",id).order("source_snapshot_at",{ascending:false}).limit(500),
 ]);if(product.error||snapshots.error)throw new Error("Analytics query failed");if(!product.data)return null;
 return{product:product.data,snapshots:(snapshots.data??[]) as VideoSnapshotRow[]};
}
export async function getLearningOverview(client:SupabaseClient,ownerId:string){const [signals,decisions,experiments]=await Promise.all([read<LearningSignalRow>(client,"learning_signals",ownerId),read<Record<string,unknown>>(client,"learning_decisions",ownerId),read<Record<string,unknown>>(client,"experiment_variants",ownerId)]);return{signals,decisions,experiments};}

export async function persistVideoEvaluation(admin:SupabaseClient,input:{ownerId:string;accountId:string;videoId:string;videoKind:"MASTER"|"VARIATION"|"EXTERNAL";mode:"GROWTH"|"AFFILIATE";observation:VideoAnalyticsObservation;result:WinnerResult;baseline:AccountBaseline;productId?:string|null}){
 const {externalVideoId,capturedAt,sourceConfidence,publishedAt,...metrics}=input.observation;
 const availability=Object.fromEntries((["views","likes","comments","shares","favorites","clicks","orders","gmv","commission"] as const).map(key=>[key,input.observation[key]===null?"UNKNOWN":"AVAILABLE"]));
 const snapshotValues={owner_id:input.ownerId,tiktok_account_id:input.accountId,video_id:input.videoId,video_kind:input.videoKind,external_video_id:externalVideoId,product_id:input.productId??null,source_snapshot_at:capturedAt,published_at:publishedAt??null,...metrics,source_confidence:sourceConfidence,availability_json:availability,raw_metadata_json:{}};
 const inserted=await admin.from("video_analytics_snapshots").insert(snapshotValues).select("id").maybeSingle();
 let snapshot=inserted.data;if(inserted.error?.code==="23505"){const existing=await admin.from("video_analytics_snapshots").select("id").eq("owner_id",input.ownerId).eq("source",input.observation.source).eq("external_video_id",input.observation.externalVideoId).eq("source_snapshot_at",input.observation.capturedAt).single();if(existing.error)throw new Error(existing.error.message);snapshot=existing.data;}else if(inserted.error)throw new Error(inserted.error.message);if(!snapshot)throw new Error("analytics_snapshot_missing");
 const hash=evidenceHash({snapshotId:snapshot.id,mode:input.mode,result:input.result});const scoreValues={owner_id:input.ownerId,tiktok_account_id:input.accountId,video_snapshot_id:snapshot.id,video_id:input.videoId,video_kind:input.videoKind,mode:input.mode,growth_score:input.result.growthScore,affiliate_score:input.result.affiliateScore,final_score:input.result.finalScore,decision:input.result.decision,confidence:input.result.confidence,sample_factor:input.result.sampleFactor,freshness_factor:input.result.freshnessFactor,account_baseline_json:input.baseline,components_json:input.result.components,explanation_json:{relativeTo:"ACCOUNT_BASELINE"},evidence_hash:hash,evaluated_at:new Date().toISOString()};
 const scored=await admin.from("winner_scores").insert(scoreValues).select("id").maybeSingle();if(scored.error?.code==="23505"){const existing=await admin.from("winner_scores").select("id").eq("owner_id",input.ownerId).eq("video_id",input.videoId).eq("video_kind",input.videoKind).eq("score_version","winner-detection-v1").eq("evidence_hash",hash).single();if(existing.error)throw new Error(existing.error.message);return{snapshotId:snapshot.id,winnerScoreId:existing.data.id,duplicate:true};}if(scored.error)throw new Error(scored.error.message);return{snapshotId:snapshot.id,winnerScoreId:scored.data!.id,duplicate:false};
}
