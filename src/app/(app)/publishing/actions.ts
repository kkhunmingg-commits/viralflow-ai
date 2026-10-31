"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TikTokPublishingService } from "@/features/publishing/services";
import {createShoppableIntentForQueue} from "@/features/commerce/services";
import {z} from "zod";
import type { PublishSettings } from "@/features/publishing/types";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";

async function ownerId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");
  await enforceOwnerMutationRateLimit("publishing", data.user.id);
  return data.user.id;
}

export async function queueVideoAction(formData: FormData) {
  const owner = await ownerId();
  const accountId = String(formData.get("account_id") ?? "");
  const videoId = String(formData.get("video_id") ?? "");
  const videoKind = String(formData.get("video_kind") ?? "MASTER") as "MASTER" | "VARIATION";
  const publishMode = "DIRECT_POST" as const;
  const row = await new TikTokPublishingService().queueVideo({
    ownerId: owner, accountId, videoId, videoKind, publishMode,
    sourceMethod: "FILE_UPLOAD",
    idempotencyKey: `${videoKind}:${videoId}:${publishMode}`,
  });
  revalidatePath("/publishing");
  redirect(`/publishing/${row.id}`);
}

function refresh(queueId: string) {
  revalidatePath("/publishing");
  revalidatePath(`/publishing/${queueId}`);
}

export async function preparePublishAction(queueId: string) {
  await new TikTokPublishingService().preparePublish(await ownerId(), queueId);
  refresh(queueId);
}

export async function createShoppableIntentAction(queueId:string,formData:FormData){const productId=z.string().uuid().parse(formData.get("shop_product_id"));await createShoppableIntentForQueue(await ownerId(),queueId,productId);refresh(queueId)}

export async function consentPublishAction(queueId: string, formData: FormData) {
  const settings: PublishSettings = {
    caption: String(formData.get("caption") ?? ""),
    privacyLevel: String(formData.get("privacy_level") ?? "") || null,
    disableComment: formData.get("allow_comment") !== "on",
    disableDuet: formData.get("allow_duet") !== "on",
    disableStitch: formData.get("allow_stitch") !== "on",
    isAigc: formData.get("is_aigc") === "on",
    commercialContent: {
      brand_organic_toggle: formData.get("brand_organic_toggle") === "on",
      brand_content_toggle: formData.get("brand_content_toggle") === "on",
    },
  };
  await new TikTokPublishingService().recordConsent(await ownerId(), queueId, settings);
  refresh(queueId);
}

export async function sendPublishAction(queueId: string, mode: "DRAFT_UPLOAD" | "DIRECT_POST") {
  if (mode !== "DIRECT_POST") throw new Error("direct_post_only");
  if (serverEnv.tiktokPublishingProvider !== "official" || !serverEnv.tiktokPublishingRealMode) {
    throw new Error("official_direct_post_not_enabled");
  }
  const service = new TikTokPublishingService();
  const owner = await ownerId();
  await service.directPost(owner, queueId);
  refresh(queueId);
}

export async function schedulePublishAction(queueId: string, formData: FormData) {
  const value = String(formData.get("scheduled_for") ?? "");
  await new TikTokPublishingService().schedulePublish(await ownerId(), queueId, value);
  refresh(queueId);
}

export async function fetchPublishStatusAction(queueId: string) {
  await new TikTokPublishingService().fetchPublishStatus(await ownerId(), queueId);
  refresh(queueId);
}

export async function cancelPublishAction(queueId: string) {
  await new TikTokPublishingService().cancelQueuedPublish(await ownerId(), queueId);
  refresh(queueId);
}

export async function retryPublishAction(queueId: string) {
  if (serverEnv.tiktokPublishingProvider !== "official" || !serverEnv.tiktokPublishingRealMode) {
    throw new Error("official_direct_post_not_enabled");
  }
  await new TikTokPublishingService().retryPublish(await ownerId(), queueId);
  refresh(queueId);
}
