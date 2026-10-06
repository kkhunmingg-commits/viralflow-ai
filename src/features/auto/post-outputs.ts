import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestVideoGate } from "@/features/compliance/services";
import { ownsVideoStoragePath } from "@/features/video/storage";
import { autoVideoQualityOutcome, type PostingMode } from "./execution-policy";
import type { ExecutionClaim } from "./processor";

export type PostOutputStatus = "READY" | "SCHEDULED" | "DRAFT_UPLOADED" | "WAITING_FOR_USER" | "PUBLISHED" | "FAILED" | "REVIEW_REQUIRED";
export interface PostOutputRow {
  id: string; owner_id: string; tiktok_account_id: string; auto_run_id: string; item_index: number;
  video_id: string; product_id: string; publishing_queue_id: string | null; posting_mode: PostingMode;
  status: PostOutputStatus; caption: string; hashtags_json: string[];
  product_reference_json: { title: string; url: string | null }; suggested_post_at: string | null;
  published_at?: string | null;
}
function must(error: { message: string } | null) { if (error) throw new Error("post_output_read_failed"); }
function checkpointId(claim: ExecutionClaim, key: string) {
  const value = claim.checkpoint[key];
  if (typeof value !== "string" || !value) throw new Error("post_output_context_missing");
  return value;
}
export async function executionPostingMode(client: SupabaseClient, claim: ExecutionClaim): Promise<PostingMode> {
  const run = await client.from("auto_runs").select("posting_mode,tiktok_account_id")
    .eq("owner_id", claim.ownerId).eq("id", claim.runId).maybeSingle();
  must(run.error);
  if (!run.data || (run.data.tiktok_account_id && run.data.tiktok_account_id !== claim.accountId)) throw new Error("post_run_account_mismatch");
  const mode = run.data.posting_mode ?? "AUTO";
  if (!["AUTO", "DRAFT", "EXPORT"].includes(mode)) throw new Error("post_mode_invalid");
  if (claim.postingMode && claim.postingMode !== mode) throw new Error("post_mode_snapshot_mismatch");
  return mode as PostingMode;
}

/** Export is independent of TikTok posting permissions, never independent of content gates. */
export function exportContentGate(gate: Awaited<ReturnType<typeof getLatestVideoGate>>) {
  if (gate.compliance?.overall_status !== "PASS") return false;
  return ["ORIGINAL", "ACCEPTABLE_VARIATION"].includes(String(gate.originality?.originality_status));
}
function publicProductUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
export async function ensurePostOutput(client: SupabaseClient, claim: ExecutionClaim, mode: PostingMode, queueId: string | null = null): Promise<PostOutputRow> {
  const existing = await client.from("post_outputs").select("*").eq("owner_id", claim.ownerId)
    .eq("auto_run_id", claim.runId).eq("tiktok_account_id", claim.accountId).eq("item_index", claim.itemIndex).maybeSingle();
  must(existing.error);
  if (existing.data) {
    if (existing.data.posting_mode !== mode || existing.data.video_id !== checkpointId(claim, "videoId")) throw new Error("post_output_identity_mismatch");
    if (queueId && existing.data.publishing_queue_id !== queueId) throw new Error("post_output_queue_mismatch");
    return existing.data as PostOutputRow;
  }
  const [video, run, product] = await Promise.all([
    client.from("master_videos").select("id,tiktok_account_id,product_id,selected_script_id,storage_path,status,quality_status,quality_score,quality_explanation_json,provider")
      .eq("owner_id", claim.ownerId).eq("id", checkpointId(claim, "videoId")).eq("tiktok_account_id", claim.accountId).maybeSingle(),
    client.from("auto_runs").select("posting_mode,tiktok_account_id,schedule_slot_key")
      .eq("owner_id", claim.ownerId).eq("id", claim.runId).maybeSingle(),
    client.from("products").select("id,title,product_url").eq("owner_id", claim.ownerId).eq("id", checkpointId(claim, "productId")).maybeSingle(),
  ]);
  for (const result of [video, run, product]) must(result.error);
  if (!video.data || !run.data || !product.data || video.data.product_id !== product.data.id
    || (run.data.tiktok_account_id && run.data.tiktok_account_id !== claim.accountId)
    || (run.data.posting_mode ?? "AUTO") !== mode
    || autoVideoQualityOutcome(video.data).kind !== "ADVANCE"
    || !ownsVideoStoragePath(claim.ownerId, String(video.data.storage_path))) throw new Error("post_output_not_ready");
  const script = await client.from("scripts").select("caption,hashtags_json").eq("owner_id", claim.ownerId)
    .eq("id", video.data.selected_script_id).maybeSingle();
  must(script.error);
  if (!script.data) throw new Error("post_output_script_missing");
  let suggestedAt: string | null = claim.scheduledFor && Number.isFinite(Date.parse(claim.scheduledFor)) ? claim.scheduledFor : null;
  if (typeof run.data.schedule_slot_key === "string") {
    const slot = await client.from("post_schedule_slots").select("scheduled_at")
      .eq("owner_id", claim.ownerId).eq("tiktok_account_id", claim.accountId).eq("slot_key", run.data.schedule_slot_key).maybeSingle();
    must(slot.error);
    suggestedAt = typeof slot.data?.scheduled_at === "string" ? slot.data.scheduled_at : null;
  }
  const row = { owner_id: claim.ownerId, tiktok_account_id: claim.accountId, auto_run_id: claim.runId,
    item_index: claim.itemIndex, video_id: video.data.id, product_id: product.data.id, posting_mode: mode,
    publishing_queue_id: queueId, status: "READY", caption: String(script.data.caption ?? "").slice(0, 2200),
    hashtags_json: Array.isArray(script.data.hashtags_json) ? script.data.hashtags_json.filter((value: unknown) => typeof value === "string").slice(0, 30) : [],
    product_reference_json: { title: String(product.data.title ?? ""), url: publicProductUrl(product.data.product_url) }, suggested_post_at: suggestedAt };
  const inserted = await client.from("post_outputs").upsert(row,
    { onConflict: "owner_id,auto_run_id,tiktok_account_id,item_index", ignoreDuplicates: true });
  must(inserted.error);
  const saved = await client.from("post_outputs").select("*").eq("owner_id", claim.ownerId)
    .eq("auto_run_id", claim.runId).eq("tiktok_account_id", claim.accountId).eq("item_index", claim.itemIndex).maybeSingle();
  must(saved.error);
  if (!saved.data || saved.data.video_id !== row.video_id || saved.data.posting_mode !== mode) throw new Error("post_output_persist_failed");
  return saved.data as PostOutputRow;
}
export async function updatePostOutput(client: SupabaseClient, claim: ExecutionClaim, status: PostOutputStatus, publishedAt?: string | null) {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "PUBLISHED" && publishedAt && Number.isFinite(Date.parse(publishedAt))) patch.published_at = publishedAt;
  const result = await client.from("post_outputs").update(patch)
    .eq("owner_id", claim.ownerId).eq("auto_run_id", claim.runId).eq("tiktok_account_id", claim.accountId)
    .eq("item_index", claim.itemIndex).neq("status", "PUBLISHED");
  must(result.error);
}
export async function readPostOutput(client: SupabaseClient, ownerId: string, outputId: string) {
  const result = await client.from("post_outputs").select("*").eq("owner_id", ownerId).eq("id", outputId).maybeSingle();
  must(result.error);
  if (!result.data) throw new Error("post_output_not_found");
  return result.data as PostOutputRow;
}
