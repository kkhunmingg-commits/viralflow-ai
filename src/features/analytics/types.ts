export type Metric = number | null;
export type AnalyticsMode = "GROWTH" | "AFFILIATE";
export type WinnerDecision = "STOP" | "WATCH" | "SCALE" | "INSUFFICIENT_DATA";
export type AnalyticsSource = "MOCK" | "TIKTOK_DISPLAY" | "TIKTOK_SHOP_ANALYTICS";

export interface VideoMetrics {
  views: Metric; likes: Metric; comments: Metric; shares: Metric; favorites: Metric;
  clicks: Metric; orders: Metric; gmv: Metric; commission: Metric;
}
export interface AccountBaseline {
  views: number; engagementRate: number; shareRate: number; favoriteRate: number;
  clickRate: number; conversionRate: number; gmvPerThousand: number; commissionPerThousand: number;
}
export interface WinnerInput extends VideoMetrics {
  id: string; accountId: string; mode: AnalyticsMode; ageHours: number;
  followerDelta?: Metric; sourceConfidence: number; categoryRelative?: number;
  commerceAvailable: boolean; baseline: AccountBaseline;
}
export interface WinnerResult {
  growthScore: Metric; affiliateScore: Metric; finalScore: Metric; decision: WinnerDecision;
  confidence: number; sampleFactor: number; freshnessFactor: number; components: Record<string, number | null>;
}
export interface AnalyticsSummary {
  totalVideos: number; scale: number; watch: number; stop: number; insufficient: number;
  views: number; orders: number; gmv: number; commission: number;
}
export interface WinnerRow {
  id:string; tiktok_account_id:string; video_id:string; video_kind:string; mode:AnalyticsMode;
  growth_score:number|null; affiliate_score:number|null; final_score:number|null; decision:WinnerDecision;
  confidence:number; evaluated_at:string; components_json:Record<string,number|null>; explanation_json:Record<string,unknown>;
}
export interface VideoSnapshotRow extends VideoMetrics {
  id:string; tiktok_account_id:string; video_id:string; video_kind:string; external_video_id:string;
  product_id:string|null; category_id:string|null; source:AnalyticsSource; source_snapshot_at:string; source_confidence:number;
}
export interface LearningSignalRow {
  id:string; tiktok_account_id:string; dimension_type:string; dimension_value:string; effect:number; weight:number;
  confidence:number; decay_factor:number; sample_size:number; observed_at:string;
}
export interface ExperimentVariant {
  axis:"HOOK"|"SCENE"|"CTA"|"TEMPLATE"|"PUBLISH_TIMING"; controlValue:string; variantValue:string;
  originalityRequired:true; idempotencyKey:string;
}
