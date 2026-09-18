import type { CreativeContext } from "./types";

export interface CreativeContextInput {
  assignment:{id:string;final_score:number;reason_json:Record<string,unknown>};
  account:{id:string;display_name:string;effective_mode:"GROWTH"|"AFFILIATE";follower_count:number;preferred_categories:string[]};
  product:{id:string;title:string;category_key:string;current_price:number;original_price:number|null;commission_rate:number;commission_amount:number;rating:number|null;review_count:number};
  productScore?:{product_momentum_score:number;creative_potential_score:number;data_confidence:number}|null;
  categoryScore?:{category_momentum_score:number;commercial_opportunity_score:number;state:string;confidence_component:number;saturation_component:number}|null;
  affinity?:{affinity_score:number|string;confidence:number|string}|null;
  assignmentScore:{account_product_fit_score:number;final_viral_opportunity_score:number};
  history?:{angle_type:string;hook:string}[];
  growthRecommendation?:{category_key:string|null;hook:string|null;angle:string|null;cta:string|null;experiment_axis:string|null;confidence:number;evidence_json:Record<string,unknown>}|null;
}
export function buildCreativeContext(i:CreativeContextInput):CreativeContext {
  return {
    assignment:{id:i.assignment.id,score:Number(i.assignment.final_score),reason:String(i.assignment.reason_json.plannerReason??"Selected by daily planner")},
    account:{id:i.account.id,name:i.account.display_name,mode:i.account.effective_mode,followers:i.account.follower_count,preferredCategories:i.account.preferred_categories},
    product:{id:i.product.id,title:i.product.title,category:i.product.category_key,price:Number(i.product.current_price),originalPrice:i.product.original_price===null?null:Number(i.product.original_price),commissionRate:Number(i.product.commission_rate),commissionAmount:Number(i.product.commission_amount),rating:i.product.rating,reviewCount:i.product.review_count,momentum:Number(i.productScore?.product_momentum_score??0),creativePotential:Number(i.productScore?.creative_potential_score??0)},
    category:{momentum:Number(i.categoryScore?.category_momentum_score??0),commercialOpportunity:Number(i.categoryScore?.commercial_opportunity_score??0),state:i.categoryScore?.state??"LOW_DATA",saturation:Number(i.categoryScore?.saturation_component??100)/100},
    affinity:{score:Number(i.affinity?.affinity_score??.5),confidence:Number(i.affinity?.confidence??0)},
    signals:{accountProductFit:Number(i.assignmentScore.account_product_fit_score),finalViralOpportunity:Number(i.assignmentScore.final_viral_opportunity_score),productConfidence:Number(i.productScore?.data_confidence??0),categoryConfidence:Number(i.categoryScore?.confidence_component??0)/100},
    historicalCreativeSignals:{recentAngleTypes:(i.history??[]).map(h=>h.angle_type).slice(0,10),recentHooks:(i.history??[]).map(h=>h.hook).slice(0,10)},
    growthLearning:i.account.effective_mode==="GROWTH"&&i.growthRecommendation?{preferredCategory:i.growthRecommendation.category_key,recommendedHook:i.growthRecommendation.hook,recommendedAngle:i.growthRecommendation.angle,cta:i.growthRecommendation.cta,experimentAxis:i.growthRecommendation.experiment_axis,confidence:Number(i.growthRecommendation.confidence),sourceEvidence:i.growthRecommendation.evidence_json}:null,
  };
}
