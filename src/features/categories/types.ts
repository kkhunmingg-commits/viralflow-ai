import type { AccountCategoryAffinity, EffectiveMode, TikTokAccount } from "@/features/accounts/types";
import type { Product, ProductScore, ProductSnapshot, RadarItem } from "@/features/products/types";

export type CategoryState = "HOT"|"RISING"|"STABLE"|"FALLING"|"SATURATED"|"LOW_DATA";
export interface Category { id:string; owner_id:string; category_key:string; display_name:string; parent_category_key:string|null; provider:string; status:"active"|"inactive"; first_seen_at:string; last_seen_at:string; created_at:string; updated_at:string }
export interface CategorySnapshot {
 id?:string; owner_id?:string; category_id?:string; captured_at:string;
 product_count:number; active_product_count:number; accelerating_product_count:number; rising_product_count:number; falling_product_count:number;
 median_product_momentum:number; mean_product_momentum:number; top_quartile_momentum:number;
 sales_delta:number; sales_velocity:number; sales_acceleration:number; average_commission_rate:number; median_commission_amount:number;
 competition_signal:number; saturation_signal:number; data_confidence:number;
}
export interface CategoryExplanation { signals:Record<string,{score:number;reason:string}>; assumptions:string[]; shares:{accelerating:number;rising:number;falling:number}; robustVelocity:number; productIds:string[] }
export interface CategoryScore {
 id?:string; owner_id?:string; category_id?:string; snapshot_id?:string; calculated_at:string;
 product_momentum_component:number; acceleration_component:number; breadth_component:number; commercial_component:number;
 competition_component:number; saturation_component:number; confidence_component:number; category_momentum_score:number;
 commercial_opportunity_score:number; state:CategoryState; score_version:string; explanation_json:CategoryExplanation;
}
export interface CategoryProductInput { product:Product; score:ProductScore; history:ProductSnapshot[] }
export interface CategoryAggregate { snapshot:CategorySnapshot; commercialComponent:number; priceComponent:number; conversionProxy:number; creativeComponent:number; explanation:CategoryExplanation }
export interface AccountAffinityInput { mode:EffectiveMode; sampleSize:number; views:number; engagements:number; followersGained:number; productClicks:number; orders:number; gmv:number; commission:number }
export interface CalculatedAffinity { affinity_score:number; confidence:number; sample_size:number; engagement_rate:number; follow_conversion:number; ctr:number; conversion_rate:number; commission_per_1000_views:number }
export interface AccountFit { account:TikTokAccount; affinity:AccountCategoryAffinity|null; score:number; confidence:number }
export interface CategoryRadarItem { category:Category; snapshot:CategorySnapshot; score:CategoryScore; bestAccount:AccountFit|null; fits:AccountFit[] }
export interface CategoryDetail extends CategoryRadarItem { snapshotHistory:CategorySnapshot[]; scoreHistory:CategoryScore[]; products:RadarItem[] }
