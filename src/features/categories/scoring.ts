import type { AccountCategoryAffinity, TikTokAccount } from "@/features/accounts/types";
import type { CategoryAggregate, CategoryProductInput, CategoryScore, CategorySnapshot, CategoryState, AccountAffinityInput, CalculatedAffinity } from "./types";

export const CATEGORY_SCORE_VERSION="category-momentum-v1";
const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(n)?n:0));
const round=(n:number)=>Math.round(n*10000)/10000;
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
function percentile(values:number[],p:number) { if(!values.length)return 0; const sorted=values.toSorted((a,b)=>a-b); const i=(sorted.length-1)*p; const lo=Math.floor(i),hi=Math.ceil(i); return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo); }
function winsorizedMean(values:number[]) { if(!values.length)return 0; const cap=Math.max(10,percentile(values,.75)*2); return mean(values.map(v=>Math.min(v,cap))); }

export function calculateCategorySaturation(input:{productCount:number;competition:number;velocity:number;acceleration:number;creative:number}) {
 const density=input.productCount/(input.productCount+12);
 const highVelocity=clamp(Math.log1p(input.velocity)/Math.log1p(100));
 const slowing=highVelocity*clamp(-input.acceleration);
 return round(clamp(.35*density+.30*input.competition+.20*slowing+.15*(1-input.creative)));
}

export function aggregateCategorySnapshot(items:CategoryProductInput[],capturedAt:string):CategoryAggregate {
 const scores=items.map(i=>i.score), momentums=scores.map(s=>s.product_momentum_score);
 const accelerations=scores.map(s=>s.sales_acceleration);
 const velocities=scores.map(s=>s.sales_velocity);
 const lastDeltas=items.map(({history})=>{const sorted=history.toSorted((a,b)=>a.captured_at.localeCompare(b.captured_at)); const last=sorted.at(-1); const first=sorted.find(r=>Date.parse(r.captured_at)>=Date.parse(last?.captured_at??capturedAt)-86400000)??last; return last&&first?Math.max(0,last.units_sold-first.units_sold):0;});
 const accelerating=scores.filter(s=>s.explanation_json.trend==="ACCELERATING").length;
 const rising=scores.filter(s=>["ACCELERATING","RISING"].includes(s.explanation_json.trend)).length;
 const falling=scores.filter(s=>s.explanation_json.trend==="FALLING").length;
 const competition=mean(scores.map(s=>1-s.competition_score/100));
 const creative=mean(scores.map(s=>s.creative_potential_score/100));
 const robustVelocity=winsorizedMean(velocities);
 const acceleration=percentile(accelerations,.5);
 const confidence=round(clamp(mean(scores.map(s=>s.data_confidence))*items.length/(items.length+3)));
 const saturation=calculateCategorySaturation({productCount:items.length,competition,velocity:robustVelocity,acceleration,creative});
 const commercial=100*mean(scores.map(s=>Math.sqrt(clamp(s.commission_score/100)*clamp(s.viral_opportunity_base_score/100))));
 const price=100*mean(scores.map(s=>s.price_attractiveness/100));
 const conversion=100*mean(scores.map(s=>Math.sqrt(clamp(s.rating_score/100)*clamp(s.review_confidence))));
 const snapshot:CategorySnapshot={captured_at:capturedAt,product_count:items.length,active_product_count:items.filter(i=>i.product.status==="available").length,
  accelerating_product_count:accelerating,rising_product_count:rising,falling_product_count:falling,
  median_product_momentum:round(percentile(momentums,.5)),mean_product_momentum:round(mean(momentums)),top_quartile_momentum:round(percentile(momentums,.75)),
  sales_delta:Math.round(lastDeltas.reduce((a,b)=>a+b,0)),sales_velocity:round(robustVelocity),sales_acceleration:round(acceleration),
  average_commission_rate:round(mean(items.map(i=>i.product.commission_rate))),median_commission_amount:round(percentile(items.map(i=>i.product.commission_amount),.5)),
  competition_signal:round(competition),saturation_signal:saturation,data_confidence:confidence};
 return {snapshot,commercialComponent:round(commercial),priceComponent:round(price),conversionProxy:round(conversion),creativeComponent:round(creative*100),
  explanation:{signals:{robustAggregation:{score:round(percentile(momentums,.5)),reason:"Median and upper quartile prevent one outlier from controlling the category."}},assumptions:["Current opportunity is weighted above historical totals.","Competition and creative inputs remain provider-pluggable proxies."],shares:{accelerating:items.length?accelerating/items.length:0,rising:items.length?rising/items.length:0,falling:items.length?falling/items.length:0},robustVelocity:round(robustVelocity),productIds:items.map(i=>i.product.id)}};
}

export function calculateCategoryState(snapshot:CategorySnapshot,momentum:number):CategoryState {
 if(snapshot.product_count<3||snapshot.data_confidence<.35)return "LOW_DATA";
 const breadth=snapshot.rising_product_count/snapshot.product_count;
 if(snapshot.saturation_signal>=.68&&(snapshot.sales_acceleration<-.1||breadth<.3))return "SATURATED";
 if(momentum>=60&&snapshot.sales_acceleration>.15&&breadth>=.5)return "HOT";
 if(momentum>=50&&snapshot.sales_acceleration>.03&&breadth>=.35)return "RISING";
 if(snapshot.sales_acceleration<-.12||snapshot.falling_product_count/snapshot.product_count>=.5)return "FALLING";
 return "STABLE";
}

export function calculateCategoryMomentum(aggregate:CategoryAggregate,now=new Date(aggregate.snapshot.captured_at)):CategoryScore {
 const s=aggregate.snapshot,n=Math.max(s.product_count,1);
 const breadth=100*clamp(.7*s.accelerating_product_count/n+.3*s.rising_product_count/n);
 const momentumComponent=.6*s.median_product_momentum+.4*s.top_quartile_momentum;
 const velocity=100*clamp(Math.log1p(s.sales_velocity)/Math.log1p(100));
 const acceleration=50+40*Math.tanh(s.sales_acceleration);
 const confidence=s.data_confidence;
 const momentum=100*clamp((.30*momentumComponent+.25*breadth+.15*velocity+.15*acceleration+.15*aggregate.creativeComponent)/100*(.25+.75*confidence));
 const competition=100*(1-s.competition_signal), saturation=100*(1-s.saturation_signal);
 const commercial=100*clamp((.40*momentum+.25*aggregate.commercialComponent+.10*aggregate.priceComponent+.10*aggregate.conversionProxy+.10*competition+.05*breadth)/100*(.2+.8*confidence)*(1-.25*s.saturation_signal));
 const state=calculateCategoryState(s,momentum);
 return {calculated_at:now.toISOString(),product_momentum_component:round(momentumComponent),acceleration_component:round(acceleration),breadth_component:round(breadth),commercial_component:aggregate.commercialComponent,competition_component:round(competition),saturation_component:round(saturation),confidence_component:round(confidence*100),category_momentum_score:round(momentum),commercial_opportunity_score:round(commercial),state,score_version:CATEGORY_SCORE_VERSION,explanation_json:{...aggregate.explanation,signals:{...aggregate.explanation.signals,breadth:{score:round(breadth),reason:"70% accelerating share plus 30% rising-or-accelerating share."},velocity:{score:round(velocity),reason:"Winsorized per-product velocity on a logarithmic scale."},commercial:{score:aggregate.commercialComponent,reason:"Commission quality and product opportunity, balanced across products."},saturation:{score:round(100*s.saturation_signal),reason:"Density, competition, high-volume slowing, and low creative headroom."}}}};
}

export function calculateCategoryCommercialOpportunity(aggregate:CategoryAggregate){return calculateCategoryMomentum(aggregate).commercial_opportunity_score;}

export function calculateAccountCategoryAffinity(input:AccountAffinityInput):CalculatedAffinity {
 const views=Math.max(0,input.views),engagementRate=views?input.engagements/views:0,followConversion=views?input.followersGained/views:0,ctr=views?input.productClicks/views:0,conversion=input.productClicks?input.orders/input.productClicks:0,cpv=views?input.commission/views*1000:0;
 const growth=.45*clamp(engagementRate/.12)+.55*clamp(followConversion/.02);
 const affiliate=.20*clamp(ctr/.08)+.35*clamp(conversion/.08)+.30*clamp(cpv/120)+.15*clamp(input.gmv/Math.max(input.orders,1)/800);
 const confidence=clamp(input.sampleSize/(input.sampleSize+12)*views/(views+5000));
 const raw=input.mode==="GROWTH"?growth:affiliate;
 return {affinity_score:round(.5+confidence*(raw-.5)),confidence:round(confidence),sample_size:input.sampleSize,engagement_rate:round(engagementRate),follow_conversion:round(followConversion),ctr:round(ctr),conversion_rate:round(conversion),commission_per_1000_views:round(cpv)};
}

export function calculateAccountCategoryFit(account:Pick<TikTokAccount,"effective_mode">,category:CategoryScore,affinity:Pick<AccountCategoryAffinity,"affinity_score"|"confidence">|null) {
 const a=affinity?Number(affinity.affinity_score):.5,c=affinity?Number(affinity.confidence):0;
 const categoryBase=account.effective_mode==="GROWTH"?.75*category.category_momentum_score+.25*category.commercial_opportunity_score:.15*category.category_momentum_score+.85*category.commercial_opportunity_score;
 const fit=categoryBase*(.20+1.60*(.5+c*(a-.5)))*(.5+.5*category.confidence_component/100);
 return {score:round(clamp(fit,0,100)),confidence:round(Math.sqrt(c*category.confidence_component/100))};
}
