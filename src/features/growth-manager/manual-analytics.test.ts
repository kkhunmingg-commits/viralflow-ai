import {it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("../tiktok/services",()=>({TikTokTokenService:class{}}));
vi.mock("@/lib/server-env",()=>({serverEnv:{}}));
import {externalSnapshotIdentity,verifiedManualObservations,manualAnalyticsBatch} from "./manual-analytics";
import type {VideoAnalyticsObservation} from "../analytics/provider";
it("keeps manual outcomes unverified until official observation and preserves missing metrics",()=>{
 const now=new Date("2026-10-12T00:00:00Z"),row:VideoAnalyticsObservation={externalVideoId:"123",source:"TIKTOK_DISPLAY",sourceConfidence:.95,capturedAt:now.toISOString(),publishedAt:"2026-10-10T00:00:00Z",views:50,likes:2,comments:null,shares:null,favorites:null,clicks:null,orders:null,gmv:null,commission:null};
 expect(verifiedManualObservations([row],[],now)).toEqual([]);
 expect(verifiedManualObservations([{...row,source:"MOCK"},{...row,publishedAt:null},{...row,capturedAt:"2027-01-01T00:00:00Z"},row],["123"],now)).toEqual([row]);
 expect(externalSnapshotIdentity("account-a","123")).toBe(externalSnapshotIdentity("account-a","123"));
 expect(externalSnapshotIdentity("account-b","123")).not.toBe(externalSnapshotIdentity("account-a","123"));
 expect(row.orders).toBeNull();
 const ids=Array.from({length:65},(_,i)=>String(i)),seen=new Set<string>();
 for(let i=0;i<4;i++){const batch=manualAnalyticsBatch(ids,new Date(now.getTime()+i*12*3600000));expect(batch.length).toBeLessThanOrEqual(20);batch.forEach(id=>seen.add(id));}
 expect(seen.size).toBe(65);
});
