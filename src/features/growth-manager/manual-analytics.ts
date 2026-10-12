import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TikTokAnalyticsProvider, type VideoAnalyticsObservation } from "../analytics/provider";
import { TikTokTokenService } from "../tiktok/services";
import { serverEnv } from "@/lib/server-env";

/** An internal snapshot identity, never a fabricated TikTok post ID or publish confirmation. */
export function externalSnapshotIdentity(account: string, post: string) {
  const hex=createHash("sha256").update(`${account}:${post}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function verifiedManualObservations(rows: VideoAnalyticsObservation[], ids: string[], now: Date) {
  const allowed=new Set(ids);
  return rows.filter(row=>allowed.has(row.externalVideoId)&&row.source==="TIKTOK_DISPLAY"&&row.sourceConfidence>0&&
    !!row.publishedAt&&Number.isFinite(Date.parse(row.publishedAt))&&Date.parse(row.publishedAt)<=now.getTime()&&
    row.capturedAt===now.toISOString());
}
export function manualAnalyticsBatch(ids:string[],now:Date){
  const unique=[...new Set(ids)],batches=Math.ceil(unique.length/20);
  if(!batches)return [];
  // Rotate even unavailable/private reports: an unreturned old ID must not starve newer clips.
  const offset=(Math.floor(now.getTime()/(12*3600000))%batches)*20;
  return unique.slice(offset,offset+20);
}
/** Owner-reported URLs are only inputs to official verification; no fake PUBLISHED queue rows. */
export async function collectManualPilotAnalytics(admin: SupabaseClient, input: {owner:string;account:string;token:string;ids:string[];scopes:string[]}, now:Date) {
  if(!input.ids.length||!input.scopes.includes("video.list")||serverEnv.tiktokAnalyticsProvider!=="official"||
    !serverEnv.tiktokAnalyticsRealMode||serverEnv.tiktokProvider!=="official")return;
  // One account's bounded read batch per discovery lease. Remaining reports are revisited on the next cycle.
  const ids=manualAnalyticsBatch(input.ids,now),provider=new TikTokAnalyticsProvider(true);
  const rows=await provider.fetchVideoAnalytics({accountId:input.account,externalVideoIds:ids,
    accessToken:await new TikTokTokenService(admin).getAccessToken(input.owner,input.account),capturedAt:now.toISOString()});
  const observations=verifiedManualObservations(rows,ids,now).map(row=>({
    ...row,videoId:externalSnapshotIdentity(input.account,row.externalVideoId),
  }));
  const result=await admin.rpc("record_growth_manual_analytics",{p_owner:input.owner,p_account:input.account,p_token:input.token,p_observations:observations});
  if(result.error)throw new Error("GROWTH_ANALYTICS_STORAGE_UNAVAILABLE");
}
