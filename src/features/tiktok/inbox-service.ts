import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { OfficialTikTokPublishingProvider, TikTokStatusRequestError } from "@/features/publishing/provider";
import { TikTokTokenService } from "./services";
import { sandboxPrivatePostAccountId } from "./sandbox-private-post";
import { assertInboxAccess, type InboxReceipt, type InboxStore } from "./inbox-flow";

export async function inboxContext(ownerId: string, accountId: string, key?: string) {
  const admin = createAdminClient();
  const token = await new TikTokTokenService(admin).getAccessToken(ownerId, accountId);
  const { data: account, error } = await admin.from("tiktok_accounts")
    .select("owner_id,open_id,is_mock,authorization_status,granted_scopes")
    .eq("owner_id", ownerId).eq("id", accountId).single();
  if (error || !account) throw new Error("account_unavailable");
  const target = sandboxPrivatePostAccountId();
  const { data: sandbox } = target ? await admin.from("tiktok_accounts").select("open_id").eq("id", target).single() : { data: null };
  assertInboxAccess({
    ownerId, accountOwner: account.owner_id, authorized: account.authorization_status === "authorized",
    mock: account.is_mock, scopes: account.granted_scopes ?? [], official: serverEnv.tiktokProvider === "official",
    productionApproved: serverEnv.tiktokPublishingRealMode && serverEnv.tiktokVideoUploadApproved && !serverEnv.tiktokClientKey?.startsWith("sb"),
    sandboxEnabled: !!target, accountIdentity: account.open_id, sandboxIdentity: sandbox?.open_id ?? null,
  });
  const scope = () => admin.from("tiktok_inbox_uploads").select("id,status,media_sha256,video_size,provider_publish_id")
    .eq("owner_id", ownerId).eq("tiktok_account_id", accountId);
  const store: InboxStore = {
    async reserve(hash, size) {
      if (!key) throw new Error("key_required");
      const { data, error: insertError } = await admin.from("tiktok_inbox_uploads").insert({
        owner_id: ownerId, tiktok_account_id: accountId, idempotency_key: key, media_sha256: hash, video_size: size,
      }).select("id,status,media_sha256,video_size,provider_publish_id").single();
      if (data) return { receipt: data as InboxReceipt, created: true };
      if (insertError?.code !== "23505") throw new Error("receipt_unavailable");
      const { data: existing, error: readError } = await scope().or(`idempotency_key.eq.${key},media_sha256.eq.${hash}`).limit(1).single();
      if (readError || !existing) throw new Error("receipt_unavailable");
      return { receipt: existing as InboxReceipt, created: false };
    },
    async update(id, patch) {
      const { data, error: updateError } = await admin.from("tiktok_inbox_uploads")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("owner_id", ownerId).eq("tiktok_account_id", accountId).eq("id", id)
        .not("status", "in", "(SEND_TO_USER_INBOX,PUBLISH_COMPLETE,FAILED)")
        .select("id,status,media_sha256,video_size,provider_publish_id").single();
      if (!data && updateError?.code === "PGRST116") {
        const current = await scope().eq("id", id).single();
        if (current.data && ["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"].includes(current.data.status)) return current.data as InboxReceipt;
      }
      if (updateError || !data) throw new Error("receipt_unavailable");
      return data as InboxReceipt;
    },
  };
  const request: typeof fetch = async (url, options) => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
    if (!response.ok && options?.method === "POST") {
      const envelope = await response.clone().json().catch(() => null);
      if (typeof envelope?.error?.code === "string") throw new TikTokStatusRequestError(
        envelope.error.code.slice(0, 100), "", typeof envelope.error.log_id === "string" ? envelope.error.log_id.slice(0, 100) : null,
      );
    }
    return response;
  };
  return { token, store, provider: new OfficialTikTokPublishingProvider(request, serverEnv.tiktokAllowedUploadHosts),
    async receipt(id: string) {
      const { data, error: receiptError } = await scope().eq("id", id).single();
      if (receiptError || !data) throw new Error("receipt_unavailable");
      return data as InboxReceipt;
    },
  };
}
