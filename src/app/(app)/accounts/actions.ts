"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { serverEnv } from "@/lib/server-env";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

const triState = z.enum(["true", "false", "unknown"]).transform((value) =>
  value === "unknown" ? null : value === "true",
);

const accountSchema = z
  .object({
    display_name: z.string().trim().min(1).max(80),
    username: z
      .string()
      .trim()
      .transform((value) => value.replace(/^@/, ""))
      .pipe(z.string().regex(/^[A-Za-z0-9._]{2,32}$/)),
    follower_count: z.coerce.number().int().min(0),
    following_count: z.coerce.number().int().min(0),
    mode: z.enum(["AUTO", "GROWTH", "AFFILIATE"]),
    ecommerce_permission: triState,
    cart_enabled: triState,
    shop_creator_eligible: triState,
    daily_post_target: z.coerce.number().int().min(0).max(20),
    daily_post_hard_limit: z.coerce.number().int().min(0).max(20),
    account_status: z.enum([
      "unknown",
      "active",
      "restricted",
      "suspended",
      "disconnected",
    ]),
    authorization_status: z.enum([
      "disconnected",
      "pending",
      "authorized",
      "expired",
      "revoked",
      "error",
    ]),
    preferred_categories: z
      .string()
      .transform((value) =>
        [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))],
      )
      .pipe(z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/)).max(12)),
    account_notes: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => value || null),
  })
  .refine((value) => value.daily_post_target <= value.daily_post_hard_limit, {
    message: "Daily target must not exceed the hard limit",
    path: ["daily_post_target"],
  });

function formValues(formData: FormData) {
  return accountSchema.parse(Object.fromEntries(formData));
}

async function authenticatedOwner() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");
  await enforceOwnerMutationRateLimit("accounts", data.user.id);
  return { supabase, ownerId: data.user.id };
}

function refreshAccountPages(accountId?: string) {
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  if (accountId) revalidatePath(`/accounts/${accountId}`);
}

export async function createMockAccount(formData: FormData) {
  const values = formValues(formData);
  const { supabase, ownerId } = await authenticatedOwner();
  const { error } = await supabase.from("tiktok_accounts").insert({
    ...values,
    owner_id: ownerId,
    is_mock: true,
  });
  if (error) throw new Error(error.message);
  refreshAccountPages();
}

export async function updateMockAccount(accountId: string, formData: FormData) {
  const values = formValues(formData);
  const { supabase, ownerId } = await authenticatedOwner();
  const { data, error } = await supabase
    .from("tiktok_accounts")
    .update(values)
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .eq("is_mock", true)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only an owned mock account can be edited");
  refreshAccountPages(accountId);
}

export async function deleteMockAccount(accountId: string) {
  const { supabase, ownerId } = await authenticatedOwner();
  const { error } = await supabase
    .from("tiktok_accounts")
    .delete()
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .eq("is_mock", true);
  if (error) throw new Error(error.message);
  refreshAccountPages(accountId);
}

export async function seedDevelopmentAccounts() {
  if (process.env.NODE_ENV !== "development" || !serverEnv.allowDevMockSeed) {
    throw new Error("Development mock seeding is disabled");
  }

  const { supabase, ownerId } = await authenticatedOwner();
  const seeds = [
    { display_name: "Account A", username: "viralflow.account.a", follower_count: 620, ecommerce_permission: false, cart_enabled: false, authorization_status: "authorized", account_status: "active", preferred_categories: ["beauty"], daily_post_target: 3 },
    { display_name: "Account B", username: "viralflow.account.b", follower_count: 1450, ecommerce_permission: true, cart_enabled: true, authorization_status: "authorized", account_status: "active", preferred_categories: ["home", "beauty"], daily_post_target: 5 },
    { display_name: "Account C", username: "viralflow.account.c", follower_count: 3800, ecommerce_permission: true, cart_enabled: true, authorization_status: "authorized", account_status: "active", preferred_categories: ["gadgets"], daily_post_target: 6 },
    { display_name: "Blocked account", username: "viralflow.blocked", follower_count: 2400, ecommerce_permission: true, cart_enabled: true, authorization_status: "disconnected", account_status: "restricted", preferred_categories: ["gadgets"], daily_post_target: 2 },
  ];

  const { data: accounts, error } = await supabase.from("tiktok_accounts").upsert(
    seeds.map((seed) => ({
      ...seed,
      owner_id: ownerId,
      following_count: 0,
      mode: "AUTO",
      shop_creator_eligible: seed.ecommerce_permission,
      daily_post_hard_limit: 15,
      account_notes: "Development-only mock scenario",
      is_mock: true,
    })),
    { onConflict: "owner_id,username" },
  ).select("id, username, follower_count");
  if (error) throw new Error(error.message);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(new Date());
  const seededAccounts = accounts ?? [];
  const { error: statsError } = await supabase.from("account_daily_stats").upsert(
    seededAccounts.map((account, index) => ({
      owner_id: ownerId,
      tiktok_account_id: account.id,
      stat_date: today,
      followers_start: Math.max(0, account.follower_count - (index + 1) * 7),
      followers_end: account.follower_count,
      views: (index + 1) * 2400,
      likes: (index + 1) * 180,
      comments: (index + 1) * 24,
      shares: (index + 1) * 12,
      posts_published: index + 1,
      posts_failed: index === 3 ? 1 : 0,
      product_clicks: (index + 1) * 30,
      orders: index === 0 ? 0 : (index + 1) * 2,
      gmv: index === 0 ? 0 : (index + 1) * 990,
      commission: index === 0 ? 0 : (index + 1) * 99,
    })),
    { onConflict: "owner_id,tiktok_account_id,stat_date" },
  );
  if (statsError) throw new Error(statsError.message);

  const { error: affinityError } = await supabase.from("account_category_affinity").upsert(
    seededAccounts.map((account, index) => ({
      owner_id: ownerId,
      tiktok_account_id: account.id,
      category_key: ["beauty", "home", "gadgets", "gadgets"][index],
      score: [0.62, 0.86, 0.91, 0.48][index],
      affinity_score: [0.72, 0.9, 0.88, 0.48][index],
      confidence: [0.35, 0.72, 0.8, 0.3][index],
      sample_size: (index + 1) * 10,
      views: (index + 1) * 2400,
      engagements: (index + 1) * 216,
      followers_gained: (index + 1) * 7,
      product_clicks: (index + 1) * 30,
      orders: index === 0 ? 0 : (index + 1) * 2,
      gmv: index === 0 ? 0 : (index + 1) * 990,
      commission: index === 0 ? 0 : (index + 1) * 99,
      last_calculated_at: new Date().toISOString(),
    })),
    { onConflict: "owner_id,tiktok_account_id,category_key" },
  );
  if (affinityError) throw new Error(affinityError.message);
  refreshAccountPages();
}
