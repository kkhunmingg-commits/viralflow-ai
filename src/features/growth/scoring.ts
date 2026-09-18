import type {FollowerEfficiency,GrowthInput,GrowthScore} from "./types";
const clamp=(v:number,min=0,max=100)=>Math.min(max,Math.max(min,v));
const ratio=(a:number|null,b:number|null)=>a===null||b===null||b<=0?null:a/b;
const component=(value:number|null,target:number)=>value===null?null:clamp(value/target*50);
const weighted=(parts:Array<[number|null,number]>)=>{const valid=parts.filter((x):x is [number,number]=>x[0]!==null),weight=valid.reduce((s,x)=>s+x[1],0);return weight?valid.reduce((s,[v,w])=>s+v*w,0)/weight:null;};
export function calculateFollowerEfficiency(input:{followerDelta:number|null;views:number|null;videos:number|null;followersStart:number|null;days:number|null;previousRollingRate:number|null;attributionConfidence:number}):FollowerEfficiency{
 const followersPer1000Views=input.followerDelta===null||input.views===null||input.views<=0?null:input.followerDelta*1000/input.views;
 const followersPerVideo=ratio(input.followerDelta,input.videos),growthRate=ratio(input.followerDelta,input.followersStart);
 const daily=input.followerDelta===null||input.days===null||input.days<=0?null:input.followerDelta/input.days;
 const rollingGrowthRate=daily===null?null:input.previousRollingRate===null?daily:daily*.6+input.previousRollingRate*.4;
 return{followersPer1000Views,followersPerVideo,growthRate,rollingGrowthRate,attributionConfidence:input.followerDelta===null?0:clamp(input.attributionConfidence,0,1)};
}
export function growthFreshness(ageHours:number,halfLifeHours=168){return clamp(Math.pow(.5,Math.max(0,ageHours)/halfLifeHours),.2,1);}
export function calculateGrowthOptimizationScore(input:GrowthInput):GrowthScore{
 const engagementRate=ratio(input.engagement,input.views),commentRate=ratio(input.comments,input.views),shareRate=ratio(input.shares,input.views),followerRate=input.followerDelta===null||input.views===null||input.views<=0?null:input.followerDelta*1000/input.views;
 const components={followerEfficiency:component(followerRate,8),engagement:component(engagementRate,.10),comments:component(commentRate,.015),shares:component(shareRate,.02),viewVelocity:input.viewVelocityRatio===null?null:clamp(50*input.viewVelocityRatio),accountImprovement:input.accountRelativeImprovement===null?null:clamp(50+input.accountRelativeImprovement*50),categoryImprovement:input.categoryImprovement===null?null:clamp(50+input.categoryImprovement*50)};
 const raw=weighted([[components.followerEfficiency,.25],[components.engagement,.16],[components.shares,.14],[components.comments,.10],[components.viewVelocity,.12],[components.accountImprovement,.15],[components.categoryImprovement,.08]]);
 const sampleFactor=clamp(Math.sqrt(Math.max(0,input.views??0)/1500),0,1),freshness=growthFreshness(input.ageHours),coverage=Object.values(components).filter(v=>v!==null).length/Object.keys(components).length;
 const confidence=clamp(input.sourceConfidence*sampleFactor*freshness*coverage*(input.followerDelta===null?1:Math.max(.25,input.followerAttributionConfidence)),0,1);
 if(raw===null||input.sampleSize<3||confidence<.18)return{score:null,confidence,decision:"INSUFFICIENT_DATA",components,freshness};
 const score=clamp(50+(raw-50)*confidence);return{score,confidence,decision:confidence<.4?"OBSERVE":"OPTIMIZE",components,freshness};
}
