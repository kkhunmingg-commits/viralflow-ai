import { createHash } from "node:crypto";
import type { AccountBaseline, Metric, VideoMetrics, WinnerInput, WinnerResult } from "./types";

const clamp=(value:number,min=0,max=100)=>Math.min(max,Math.max(min,value));
const ratio=(value:Metric,denominator:Metric):Metric=>value===null||denominator===null||denominator<=0?null:value/denominator;
const relative=(value:Metric,baseline:number)=>value===null?null:clamp(50+50*((value-Math.max(baseline,1e-9))/Math.max(baseline,1e-9)));
function weighted(parts:Array<[Metric,number]>) { const available=parts.filter((x):x is [number,number]=>x[0]!==null); const total=available.reduce((s,x)=>s+x[1],0); return total?available.reduce((s,[v,w])=>s+v*w,0)/total:null; }

export function normalizeMetrics(metrics:VideoMetrics) {
  return {
    engagementRate: ratio(([metrics.likes,metrics.comments,metrics.shares].some(v=>v!==null))?[metrics.likes,metrics.comments,metrics.shares].reduce<number>((s,v)=>s+(v??0),0):null,metrics.views),
    shareRate:ratio(metrics.shares,metrics.views), favoriteRate:ratio(metrics.favorites,metrics.views), clickRate:ratio(metrics.clicks,metrics.views),
    conversionRate:ratio(metrics.orders,metrics.clicks), gmvPerThousand:metrics.gmv===null||metrics.views===null||metrics.views<=0?null:metrics.gmv*1000/metrics.views,
    commissionPerThousand:metrics.commission===null||metrics.views===null||metrics.views<=0?null:metrics.commission*1000/metrics.views,
  };
}
export function decayForAge(ageHours:number,halfLifeHours=72){return clamp(Math.pow(0.5,Math.max(0,ageHours)/halfLifeHours),0.25,1);}
export function calculateWinner(input:WinnerInput):WinnerResult {
  const n=normalizeMetrics(input), views=input.views??0;
  const sampleFactor=clamp(Math.sqrt(views/1000),0,1), freshnessFactor=decayForAge(input.ageHours);
  const confidence=clamp(input.sourceConfidence*sampleFactor*freshnessFactor,0,1);
  const components:Record<string,number|null>={views:relative(input.views,input.baseline.views),engagement:relative(n.engagementRate,input.baseline.engagementRate),shares:relative(n.shareRate,input.baseline.shareRate),favorites:relative(n.favoriteRate,input.baseline.favoriteRate),followers:input.followerDelta===null||input.followerDelta===undefined?null:clamp(50+input.followerDelta*5),category:input.categoryRelative===undefined?null:clamp(input.categoryRelative),clicks:relative(n.clickRate,input.baseline.clickRate),conversion:relative(n.conversionRate,input.baseline.conversionRate),gmv:relative(n.gmvPerThousand,input.baseline.gmvPerThousand),commission:relative(n.commissionPerThousand,input.baseline.commissionPerThousand)};
  const growthRaw=weighted([[components.views,.25],[components.engagement,.25],[components.shares,.2],[components.favorites,.1],[components.followers,.1],[components.category,.1]]);
  const affiliateRaw=input.commerceAvailable?weighted([[components.conversion,.3],[components.gmv,.25],[components.commission,.2],[components.clicks,.15],[components.views,.1]]):null;
  const growthScore=growthRaw===null?null:clamp(50+(growthRaw-50)*confidence);
  const affiliateScore=affiliateRaw===null?null:clamp(50+(affiliateRaw-50)*confidence);
  const finalScore=input.mode==="GROWTH"?growthScore:affiliateScore;
  const enough=views>=200&&input.ageHours>=2&&confidence>=.2&&finalScore!==null;
  const decision=!enough?"INSUFFICIENT_DATA":finalScore>=62?"SCALE":finalScore<38?"STOP":"WATCH";
  return {growthScore,affiliateScore,finalScore,decision,confidence,sampleFactor,freshnessFactor,components};
}
export function evidenceHash(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
export function defaultBaseline():AccountBaseline{return{views:1000,engagementRate:.08,shareRate:.012,favoriteRate:.015,clickRate:.025,conversionRate:.05,gmvPerThousand:500,commissionPerThousand:75};}
const median=(values:number[],fallback:number)=>{if(!values.length)return fallback;const sorted=values.toSorted((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
export function deriveAccountBaseline(history:VideoMetrics[],fallback=defaultBaseline()):AccountBaseline{
 const normalized=history.map(normalizeMetrics),present=(key:keyof ReturnType<typeof normalizeMetrics>)=>normalized.map(row=>row[key]).filter((value):value is number=>value!==null);
 return{views:median(history.map(row=>row.views).filter((value):value is number=>value!==null),fallback.views),engagementRate:median(present("engagementRate"),fallback.engagementRate),shareRate:median(present("shareRate"),fallback.shareRate),favoriteRate:median(present("favoriteRate"),fallback.favoriteRate),clickRate:median(present("clickRate"),fallback.clickRate),conversionRate:median(present("conversionRate"),fallback.conversionRate),gmvPerThousand:median(present("gmvPerThousand"),fallback.gmvPerThousand),commissionPerThousand:median(present("commissionPerThousand"),fallback.commissionPerThousand)};
}
