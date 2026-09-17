"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TikTokCreatorService, TikTokTokenService } from "@/features/tiktok/services";
import { createClient } from "@/lib/supabase/server";

async function ownerId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");
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
  redirect(`/accounts/${accountId}?disconnected=1`);
}
