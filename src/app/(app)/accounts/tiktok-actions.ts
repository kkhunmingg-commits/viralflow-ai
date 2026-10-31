"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { TikTokCreatorService, TikTokTokenService } from "@/features/tiktok/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";

async function ownerId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");
  await enforceOwnerMutationRateLimit("tiktok-account", data.user.id);
  return data.user.id;
}

export async function refreshTikTokCreatorInfo(accountId: string) {
  const owner = await ownerId();
  await new TikTokCreatorService().queryCreatorInfo(owner, accountId, true);
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
}

export async function disconnectTikTokAccount(accountId: string) {
  const owner = await ownerId();
  await new TikTokTokenService().revokeAndDisconnect(owner, accountId);
  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  redirect("/accounts?disconnected=1");
}

export async function hideDisconnectedTikTokAccount(
  accountId: string,
  _previousState: { error: string | null },
): Promise<{ error: string | null }> {
  void _previousState;
  if (!z.uuid().safeParse(accountId).success) {
    return { error: "ไม่สามารถนำบัญชีนี้ออกจากรายการได้" };
  }

  try {
    const owner = await ownerId();
    const { data, error } = await createAdminClient()
      .from("tiktok_accounts")
      .update({ hidden_at: new Date().toISOString() })
      .eq("owner_id", owner)
      .eq("id", accountId)
      .eq("provider", "tiktok")
      .eq("is_mock", false)
      .eq("connection_status", "DISCONNECTED")
      .in("authorization_status", ["revoked", "disconnected"])
      .is("hidden_at", null)
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return { error: "นำบัญชีออกไม่ได้ โปรดตรวจสอบว่ายกเลิกการเชื่อมต่อแล้ว" };
    }

    revalidatePath("/accounts");
    revalidatePath("/dashboard");
    revalidatePath("/auto");
    revalidatePath("/categories");
    return { error: null };
  } catch {
    return { error: "นำบัญชีออกไม่ได้ โปรดลองอีกครั้ง" };
  }
}
