import { describe, expect, it } from "vitest";
import {
  getAccountAffiliateReadiness,
  getAccountCategoryAffinity,
  getAccountEffectiveMode,
  getAccountGrowthReadiness,
  getAccountPerformanceSummary,
  getDashboardSummary,
} from "./account-performance";
import type {
  AccountCategoryAffinity,
  AccountDailyStat,
  TikTokAccount,
} from "./types";

const baseAccount: TikTokAccount = {
  id: "account-a",
  owner_id: "owner-a",
  display_name: "Account A",
  username: "account.a",
  follower_count: 620,
  following_count: 10,
  mode: "AUTO",
  effective_mode: "GROWTH",
  shop_creator_eligible: false,
  ecommerce_permission: false,
  cart_enabled: false,
  daily_post_target: 3,
  daily_post_hard_limit: 15,
  account_status: "active",
  authorization_status: "authorized",
  preferred_categories: [],
  account_notes: null,
  last_synced_at: null,
  is_mock: true,
  created_at: "2026-09-14T00:00:00Z",
  updated_at: "2026-09-14T00:00:00Z",
};

const account = (overrides: Partial<TikTokAccount> = {}): TikTokAccount => ({
  ...baseAccount,
  ...overrides,
});

const stat = (overrides: Partial<AccountDailyStat> = {}): AccountDailyStat => ({
  id: "stat-a",
  owner_id: "owner-a",
  tiktok_account_id: "account-a",
  stat_date: "2026-09-14",
  followers_start: 600,
  followers_end: 620,
  followers_gained: 20,
  views: 1000,
  likes: 80,
  comments: 10,
  shares: 5,
  posts_published: 3,
  posts_failed: 1,
  product_clicks: 22,
  orders: 4,
  gmv: "1290.50",
  commission: "129.05",
  created_at: "2026-09-14T00:00:00Z",
  updated_at: "2026-09-14T00:00:00Z",
  ...overrides,
});

describe("getAccountEffectiveMode", () => {
  it.each([
    [account({ follower_count: 999, ecommerce_permission: true, cart_enabled: true }), "GROWTH"],
    [account({ follower_count: 1000, ecommerce_permission: false, cart_enabled: true }), "GROWTH"],
    [account({ follower_count: 1000, ecommerce_permission: true, cart_enabled: false }), "GROWTH"],
    [account({ follower_count: 1000, ecommerce_permission: null, cart_enabled: true }), "GROWTH"],
    [account({ follower_count: 1000, ecommerce_permission: true, cart_enabled: null }), "GROWTH"],
    [account({ follower_count: 1000, shop_creator_eligible: true, ecommerce_permission: true, cart_enabled: true }), "AFFILIATE"],
    [account({ mode: "GROWTH", follower_count: 5000, ecommerce_permission: true, cart_enabled: true }), "GROWTH"],
    [account({ mode: "AFFILIATE", follower_count: 20, ecommerce_permission: false, cart_enabled: false }), "GROWTH"],
  ] as const)("คำนวณโหมดตามเงื่อนไข", (input, expected) => {
    expect(getAccountEffectiveMode(input)).toBe(expected);
  });
});

describe("account readiness", () => {
  it("สร้าง blocker ครบและไม่ให้ affiliate จากจำนวนผู้ติดตามเพียงอย่างเดียว", () => {
    const result = getAccountAffiliateReadiness(
      account({ follower_count: 3800, ecommerce_permission: null, cart_enabled: false, authorization_status: "disconnected" }),
    );
    expect(result.canAffiliate).toBe(false);
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toEqual([
      "SHOP_CREATOR_NOT_ELIGIBLE",
      "ECOMMERCE_PERMISSION_MISSING",
      "CART_NOT_ENABLED",
      "AUTHORIZATION_NOT_READY",
    ]);
  });

  it("แยก readiness สำหรับการโพสต์แบบ growth", () => {
    expect(getAccountGrowthReadiness(baseAccount).canPublish).toBe(true);
  });
});

describe("performance aggregation", () => {
  it("รวมข้อมูลสถิติและ dashboard จากโมเดล", () => {
    const accounts = [
      account(),
      account({ id: "account-b", follower_count: 1450, shop_creator_eligible: true, ecommerce_permission: true, cart_enabled: true, effective_mode: "AFFILIATE", daily_post_target: 5 }),
      account({ id: "account-c", account_status: "restricted", authorization_status: "disconnected", daily_post_target: 2 }),
    ];
    const result = getDashboardSummary(accounts, [stat()]);
    expect(result).toMatchObject({
      totalAccounts: 3,
      growthAccounts: 2,
      affiliateAccounts: 1,
      blockedAccounts: 1,
      plannedPosts: 10,
      followerTotal: 2690,
      followersGained: 20,
      orders: 4,
      gmv: 1290.5,
      commission: 129.05,
    });
    expect(getAccountPerformanceSummary([stat()]).engagements).toBe(95);
  });

  it("เรียง affinity ตาม score และ confidence", () => {
    const rows = [
      { category_key: "beauty", score: "0.7", confidence: "0.9" },
      { category_key: "home", score: "0.9", confidence: "0.5" },
    ] as AccountCategoryAffinity[];
    expect(getAccountCategoryAffinity(rows)[0]?.category_key).toBe("home");
  });
});
