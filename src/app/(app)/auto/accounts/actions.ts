"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { dashboard, saveAccountConfig, readAccountConfig } from "@/features/multi-account/service";
import { accountAutomationSchema } from "@/features/multi-account/contracts";

async function auth() {
  const client = await createClient(), { data } = await client.auth.getUser();
  if (!data.user) throw new Error("กรุณาเข้าสู่ระบบ");
  await enforceOwnerMutationRateLimit("multi-account", data.user.id);
  return { admin: createAdminClient(), owner: data.user.id };
}
export async function refreshAccountsAction() { const { admin, owner } = await auth(); return dashboard(admin, owner); }
export async function saveAccountAction(accountId: string, values: unknown) {
  const { admin, owner } = await auth();
  const id = z.string().uuid().parse(accountId), prior = await readAccountConfig(admin, owner, id);
  // Audience preferences cannot be forged by this customer endpoint; only measured server data can populate them.
  const config = accountAutomationSchema.parse(values); config.audienceMinutes = prior.audienceMinutes;
  await saveAccountConfig(admin, owner, id, config); return dashboard(admin, owner);
}
