export type AccountMode = "AUTO" | "GROWTH" | "AFFILIATE";
export type EffectiveMode = Exclude<AccountMode, "AUTO">;
export type AuthorizationStatus =
  | "disconnected"
  | "pending"
  | "authorized"
  | "expired"
  | "revoked"
  | "error";

export interface TikTokAccount {
  id: string;
  owner_id: string;
  display_name: string;
  username: string;
  follower_count: number;
  following_count: number;
  mode: AccountMode;
  effective_mode: EffectiveMode;
  shop_creator_eligible: boolean | null;
  ecommerce_permission: boolean | null;
  cart_enabled: boolean | null;
  daily_post_target: number;
  daily_post_hard_limit: number;
  account_status: string;
  authorization_status: AuthorizationStatus;
  preferred_categories: string[];
  account_notes: string | null;
  last_synced_at: string | null;
  is_mock: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccountDailyStat {
  id: string;
  owner_id: string;
  tiktok_account_id: string;
  stat_date: string;
  followers_start: number;
  followers_end: number;
  followers_gained: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  posts_published: number;
  posts_failed: number;
  product_clicks: number;
  orders: number;
  gmv: number | string;
  commission: number | string;
  created_at: string;
  updated_at: string;
}

export interface AccountCategoryAffinity {
  id: string;
  owner_id: string;
  tiktok_account_id: string;
  category_key: string;
  score: number | string;
  affinity_score: number | string;
  confidence: number | string;
  sample_size: number;
  views: number;
  engagements: number;
  followers_gained: number;
  product_clicks: number;
  orders: number;
  gmv: number | string;
  commission: number | string;
  engagement_rate: number | string;
  follow_conversion: number | string;
  ctr: number | string;
  conversion_rate: number | string;
  commission_per_1000_views: number | string;
  last_calculated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ReadinessBlockerCode =
  | "FOLLOWERS_BELOW_1000"
  | "ECOMMERCE_PERMISSION_MISSING"
  | "CART_NOT_ENABLED"
  | "AUTHORIZATION_NOT_READY"
  | "ACCOUNT_NOT_ACTIVE";

export interface AccountReadiness {
  accountId: string;
  effectiveMode: EffectiveMode;
  followerReady: boolean;
  ecommerceReady: boolean;
  cartReady: boolean;
  authorizationReady: boolean;
  canAffiliate: boolean;
  canPublish: boolean;
  blockers: ReadinessBlockerCode[];
}

export interface AccountPerformanceSummary {
  followersGained: number;
  views: number;
  engagements: number;
  postsPublished: number;
  postsFailed: number;
  productClicks: number;
  orders: number;
  gmv: number;
  commission: number;
}

export interface DashboardSummary extends AccountPerformanceSummary {
  totalAccounts: number;
  growthAccounts: number;
  affiliateAccounts: number;
  blockedAccounts: number;
  plannedPosts: number;
  followerTotal: number;
}
