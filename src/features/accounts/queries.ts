import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountCategoryAffinity,
  AccountDailyStat,
  TikTokAccount,
} from "@/features/accounts/types";

export async function getOwnerAccounts(
  supabase: SupabaseClient,
  ownerId: string,
) {
  const { data, error } = await supabase
    .from("tiktok_accounts")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as TikTokAccount[];
}

export async function getOwnerTodayStats(
  supabase: SupabaseClient,
  ownerId: string,
  statDate: string,
) {
  const { data, error } = await supabase
    .from("account_daily_stats")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("stat_date", statDate);

  if (error) throw error;
  return (data ?? []) as AccountDailyStat[];
}

export async function getAccountDetailData(
  supabase: SupabaseClient,
  ownerId: string,
  accountId: string,
) {
  const [accountResult, statsResult, affinityResult] = await Promise.all([
    supabase
      .from("tiktok_accounts")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("id", accountId)
      .maybeSingle(),
    supabase
      .from("account_daily_stats")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("tiktok_account_id", accountId)
      .order("stat_date", { ascending: false })
      .limit(14),
    supabase
      .from("account_category_affinity")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("tiktok_account_id", accountId)
      .order("score", { ascending: false }),
  ]);

  if (accountResult.error) throw accountResult.error;
  if (statsResult.error) throw statsResult.error;
  if (affinityResult.error) throw affinityResult.error;

  return {
    account: accountResult.data as TikTokAccount | null,
    stats: (statsResult.data ?? []) as AccountDailyStat[],
    affinities: (affinityResult.data ?? []) as AccountCategoryAffinity[],
  };
}
