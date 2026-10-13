import type { AccountAutomation, FrequencyRecommendation } from "./contracts";

export interface FrequencyEvidence {
  history: { posts: number; views: number; engagements: number }[];
  publishCap: number | null; ready: number; candidates: number;
  estimatedUnitCost: number | null; paidPermitted: boolean;
  // Real measured throughput only; unknown is not represented as infinite or zero-cost capacity.
  measuredGenerationPerDay: number | null; providerAutomated: boolean; accountHealthy: boolean;
  producedToday?:number; publishedToday?:number; budgetSpentToday?:number;
}
/** Explainable local planning policy over real observations. No paid model call or fabricated AI prediction. */
export function analyzeFrequency(config: AccountAutomation, data: FrequencyEvidence): FrequencyRecommendation {
  if (!data.accountHealthy) return {generation:0,publishing:0,reason:"ACCOUNT_HEALTH",confidence:0};
  const history=data.history.filter(d=>d.posts>0&&d.views>0&&[d.posts,d.views,d.engagements].every(Number.isFinite));
  // Three independent observed days are an evidence threshold, never an account/clip limit.
  if (history.length < 3) return {generation:0,publishing:0,reason:"FREQUENCY_DATA_REQUIRED",confidence:0};
  const split=Math.max(1,Math.floor(history.length/2)),older=history.slice(0,split),recent=history.slice(split);
  const performance=(rows:typeof history)=>rows.reduce((n,d)=>n+d.views+d.engagements,0)/Math.max(1,rows.reduce((n,d)=>n+d.posts,0));
  const trend=recent.length?Math.sqrt(performance(recent)/Math.max(1,performance(older))):1;
  // Change gradually according to measured response, not a fixed clip quota.
  const baseline=history.reduce((n,d)=>n+d.posts,0)/history.length;
  const proposed=Math.max(0,Math.round(baseline*Math.min(1.5,Math.max(.5,trend))));
  const minutes=config.spreadFullDay?1440:new Set(config.windows.flatMap(w=>Array.from({length:w.end-w.start},(_,i)=>w.start+i))).size;
  const windowCapacity=Math.floor(minutes/config.minimumGapMinutes);
  const cadence=Math.min(proposed,windowCapacity);
  const publishing=data.publishCap===null?0:Math.max(0,Math.min(cadence,data.publishCap));
  const produced=data.producedToday??0,need=Math.max(0,publishing-(data.publishedToday??0)-data.ready);
  const paidCapacity=data.estimatedUnitCost!==null&&data.estimatedUnitCost>0&&data.paidPermitted
    ? Math.floor(Math.max(0,config.dailyBudgetUsd-(data.budgetSpentToday??0))/data.estimatedUnitCost):0;
  const generation=data.providerAutomated&&data.measuredGenerationPerDay!==null
    ? produced+Math.max(0,Math.min(need,data.candidates,paidCapacity,Math.max(0,Math.floor(data.measuredGenerationPerDay)-produced))):0;
  return {generation,publishing,confidence:history.length/(history.length+4),reason:!data.providerAutomated?"ASSISTED":data.publishCap===null?"PLATFORM_CAP_UNKNOWN":need>generation?"CAPACITY_SHORTAGE":"OBSERVED_PERFORMANCE"};
}

export interface ResourceSnapshot { cpuUnits:number;cpuBusy:number|null;freeBytes:number;totalBytes:number;rssBytes:number;measuredJobBytes:number|null;providerSlots:number|null;queueDepth:number; }
export function adaptiveConcurrency(s:ResourceSnapshot) {
  if (s.queueDepth<1 || s.freeBytes<=0 || s.cpuUnits<1) return 0;
  // Resource bounds, not account bounds. Unknown cost/CPU/providercap starts conservatively.
  const bytes=s.measuredJobBytes??Math.max(s.rssBytes,256*1024*1024),headroom=Math.max(0,s.freeBytes-s.totalBytes*.15);
  const memory=Math.floor(headroom/bytes),cpu=s.cpuBusy===null?1:Math.floor(s.cpuUnits*Math.max(0,1-s.cpuBusy));
  if (memory<1||cpu<1)return 0;
  return Math.max(0,Math.min(memory,cpu,s.providerSlots??1,s.queueDepth));
}
