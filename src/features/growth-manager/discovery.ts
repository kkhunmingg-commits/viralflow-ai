import { getAccountEffectiveMode } from "../accounts/account-performance";

export type AutoMode = "GROWTH" | "AFFILIATE";
export interface AccountObservation {
  owner: string; account: string; identity: string; previousMode: AutoMode;
  connected: boolean; optedIn: boolean;
  followers: { count: number; at: string; identity: string; source: "TIKTOK_DISPLAY" | "MOCK" } | null;
  commerce: { at: string; source: "tiktok_shop" | "mock"; authorized: boolean;
    eligible: boolean; ecommerce: boolean; cart: boolean } | null;
}
export interface AccountClassification {
  mode: AutoMode; reason: string; followers: number | null; verified: boolean;
  canExecute: boolean; affiliateAllowed: boolean;
  validUntil: string | null;
  commerceRevoked: boolean;
}
const fresh = (at: string, now: Date) => {
  const age = now.getTime() - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= 24 * 3600000;
};
/** Reuse the account brain, but never equate the legacy default follower_count=0 with evidence. */
export function classifyAccount(input: AccountObservation, now: Date): AccountClassification {
  const f = input.followers, c = input.commerce;
  const revoked = c?.source === "tiktok_shop" && fresh(c.at, now) && (c.authorized===false || c.eligible===false || c.ecommerce===false || c.cart===false);
  const valid = !!f && f.source === "TIKTOK_DISPLAY" && f.identity === input.identity &&
    Number.isSafeInteger(f.count) && f.count >= 0 && fresh(f.at, now);
  const commerceReady = !!c && c.source === "tiktok_shop" && fresh(c.at, now) && c.authorized && c.eligible && c.ecommerce && c.cart;
  const affiliateAllowed = valid && f.count >= 1000 && commerceReady && input.connected;
  const mode = valid ? getAccountEffectiveMode({ mode: "AUTO", follower_count: f.count,
    shop_creator_eligible: commerceReady, ecommerce_permission: commerceReady, cart_enabled: commerceReady })
    : revoked ? "GROWTH" : input.previousMode;
  const reason = !input.connected ? "RECONNECT_REQUIRED" : !valid ? "FOLLOWERS_UNKNOWN" :
    f.count < 1000 ? "GROWTH_READY" : affiliateAllowed ? "AFFILIATE_READY" : "ELIGIBILITY_PENDING";
  return { mode, reason, followers: valid ? f.count : null, verified: valid,
    commerceRevoked: revoked,
    validUntil: valid ? new Date(Math.min(Date.parse(f.at)+86400000, mode==="AFFILIATE"&&c ? Date.parse(c.at)+86400000 : Infinity)).toISOString() : null,
    affiliateAllowed, canExecute: input.connected && input.optedIn && valid && (mode === "GROWTH" || affiliateAllowed) };
}

/** Stable pagination is transport only. Accounts appearing later are picked up without deployment. */
export async function discoverAccounts<T>(load: (from: number, to: number) => Promise<T[]>, pageSize = 500): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("INVALID_PAGE_SIZE");
  const result: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await load(from, from + pageSize - 1); result.push(...page);
    if (page.length < pageSize) return result;
  }
}
