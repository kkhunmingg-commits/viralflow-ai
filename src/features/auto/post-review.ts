import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TikTokPublishingService } from "@/features/publishing/services";
import type { PublishSettings } from "@/features/publishing/types";
import { readPostOutput } from "./post-outputs";

export const postReviewSettingsSchema = z.object({
  caption: z.string().max(2200), privacyLevel: z.string().max(50).nullable(),
  disableComment: z.boolean(), disableDuet: z.boolean(), disableStitch: z.boolean(), isAigc: z.boolean(),
  commercialContent: z.object({ brand_content_toggle: z.boolean().optional(), brand_organic_toggle: z.boolean().optional() }).strict(),
}).strict();

export async function readPostReview(client: SupabaseClient, ownerId: string, outputId: string) {
  const output = await readPostOutput(client, ownerId, outputId);
  if (!output.publishing_queue_id || output.posting_mode === "EXPORT") throw new Error("post_review_not_available");
  const [queue, account] = await Promise.all([
    client.from("publishing_queue").select("status,caption_snapshot,is_aigc,publish_mode")
      .eq("owner_id", ownerId).eq("tiktok_account_id", output.tiktok_account_id).eq("video_id", output.video_id)
      .eq("id", output.publishing_queue_id).maybeSingle(),
    client.from("tiktok_accounts").select("privacy_level_options,comment_disabled,duet_disabled,stitch_disabled,audit_status")
      .eq("owner_id", ownerId).eq("id", output.tiktok_account_id).maybeSingle(),
  ]);
  if (queue.error || !queue.data || account.error || !account.data || queue.data.status !== "REVIEW_REQUIRED") throw new Error("post_review_not_available");
  const options = Array.isArray(account.data.privacy_level_options)
    ? account.data.privacy_level_options.filter((value: unknown) => typeof value === "string") as string[] : [];
  return { output, queue, customer: { caption: String(queue.data.caption_snapshot),
    privacyOptions: account.data.audit_status === "AUDITED" ? options : options.filter(value => value === "SELF_ONLY"),
    requiresPrivacy: queue.data.publish_mode === "DIRECT_POST", disableCommentRequired: Boolean(account.data.comment_disabled),
    disableDuetRequired: Boolean(account.data.duet_disabled), disableStitchRequired: Boolean(account.data.stitch_disabled),
    aiDisclosureRequired: Boolean(queue.data.is_aigc) } };
}

export async function approvePostOutput(client: SupabaseClient, admin: SupabaseClient, ownerId: string, outputId: string, settings: PublishSettings) {
  const { output } = await readPostReview(client, ownerId, outputId);
  // The existing exact consent snapshot, creator checks and atomic queue transition remain authoritative.
  const service = new TikTokPublishingService(admin);
  await service.recordConsent(ownerId, output.publishing_queue_id!, settings);
  const scheduled = output.suggested_post_at && Date.parse(output.suggested_post_at) > Date.now();
  if (scheduled) await service.schedulePublish(ownerId, output.publishing_queue_id!, output.suggested_post_at!);
  const saved = await admin.from("post_outputs").update({ status: scheduled ? "SCHEDULED" : "READY", updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("tiktok_account_id", output.tiktok_account_id).eq("id", output.id).eq("status", "REVIEW_REQUIRED");
  if (saved.error) throw new Error("post_review_save_failed");
}
