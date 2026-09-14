import type {
  AccountCategoryAffinity,
  AccountDailyStat,
  AccountMode,
  AccountPerformanceSummary,
  AccountReadiness,
  DashboardSummary,
  EffectiveMode,
  ReadinessBlockerCode,
  TikTokAccount,
} from "./types";

type ModeInput = Pick<
  TikTokAccount,
  "mode" | "follower_count" | "ecommerce_permission" | "cart_enabled"
>;

export function getAccountEffectiveMode(account: ModeInput): EffectiveMode {
  if (account.mode !== "AUTO") return account.mode;

  return account.follower_count >= 1000 &&
    account.ecommerce_permission === true &&
    account.cart_enabled === true
    ? "AFFILIATE"
    : "GROWTH";
}

export function getAccountAffiliateReadiness(
  account: TikTokAccount,
): AccountReadiness {
  const followerReady = account.follower_count >= 1000;
  const ecommerceReady = account.ecommerce_permission === true;
  const cartReady = account.cart_enabled === true;
  const authorizationReady = account.authorization_status === "authorized";
  const accountActive = account.account_status === "active";
  const effectiveMode = getAccountEffectiveMode(account);
  const blockers: ReadinessBlockerCode[] = [];

  if (!followerReady) blockers.push("FOLLOWERS_BELOW_1000");
  if (!ecommerceReady) blockers.push("ECOMMERCE_PERMISSION_MISSING");
  if (!cartReady) blockers.push("CART_NOT_ENABLED");
  if (!authorizationReady) blockers.push("AUTHORIZATION_NOT_READY");
  if (!accountActive) blockers.push("ACCOUNT_NOT_ACTIVE");

  const canAffiliate = followerReady && ecommerceReady && cartReady && authorizationReady;

  return {
    accountId: account.id,
    effectiveMode,
    followerReady,
    ecommerceReady,
    cartReady,
    authorizationReady,
    canAffiliate,
    canPublish:
      accountActive &&
      authorizationReady &&
      (effectiveMode === "GROWTH" || canAffiliate),
    blockers,
  };
}

export function getAccountGrowthReadiness(account: TikTokAccount) {
  const readiness = getAccountAffiliateReadiness(account);
  const blockers = readiness.blockers.filter(
    (blocker) =>
      blocker === "AUTHORIZATION_NOT_READY" || blocker === "ACCOUNT_NOT_ACTIVE",
  );

  return {
    accountId: account.id,
    effectiveMode: readiness.effectiveMode,
    authorizationReady: readiness.authorizationReady,
    canPublish: blockers.length === 0,
    blockers,
  };
}

export function getAccountCategoryAffinity(
  affinities: AccountCategoryAffinity[],
) {
  return affinities.toSorted((left, right) => {
    const scoreDifference = Number(right.score) - Number(left.score);
    return scoreDifference || Number(right.confidence) - Number(left.confidence);
  });
}

export function getAccountPerformanceSummary(
  stats: AccountDailyStat[],
): AccountPerformanceSummary {
  return stats.reduce<AccountPerformanceSummary>(
    (summary, stat) => ({
      followersGained: summary.followersGained + stat.followers_gained,
      views: summary.views + stat.views,
      engagements:
        summary.engagements + stat.likes + stat.comments + stat.shares,
      postsPublished: summary.postsPublished + stat.posts_published,
      postsFailed: summary.postsFailed + stat.posts_failed,
      productClicks: summary.productClicks + stat.product_clicks,
      orders: summary.orders + stat.orders,
      gmv: summary.gmv + Number(stat.gmv),
      commission: summary.commission + Number(stat.commission),
    }),
    {
      followersGained: 0,
      views: 0,
      engagements: 0,
      postsPublished: 0,
      postsFailed: 0,
      productClicks: 0,
      orders: 0,
      gmv: 0,
      commission: 0,
    },
  );
}

export function getDashboardSummary(
  accounts: TikTokAccount[],
  todayStats: AccountDailyStat[],
): DashboardSummary {
  const performance = getAccountPerformanceSummary(todayStats);
  let growthAccounts = 0;
  let affiliateAccounts = 0;
  let blockedAccounts = 0;
  let plannedPosts = 0;
  let followerTotal = 0;

  for (const account of accounts) {
    const mode = getAccountEffectiveMode(account);
    const readiness = getAccountAffiliateReadiness(account);
    if (mode === "GROWTH") growthAccounts += 1;
    if (mode === "AFFILIATE") affiliateAccounts += 1;
    if (!readiness.canPublish) blockedAccounts += 1;
    plannedPosts += account.daily_post_target;
    followerTotal += account.follower_count;
  }

  return {
    ...performance,
    totalAccounts: accounts.length,
    growthAccounts,
    affiliateAccounts,
    blockedAccounts,
    plannedPosts,
    followerTotal,
  };
}

export const accountModes: readonly AccountMode[] = [
  "AUTO",
  "GROWTH",
  "AFFILIATE",
];
