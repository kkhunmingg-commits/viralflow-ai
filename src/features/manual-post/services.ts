import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownsVideoStoragePath, videoStorageBucket } from "@/features/video/storage";
import { storedClipExportReady } from "./gates";
import { assertMp4, createPostPackageZip, postCaption } from "./package";

type Row = Record<string, unknown>;
export interface ManualClip { id: string; name: string; accountName: string; ready: boolean; caption: string; }
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error("export_unavailable");
  return result.data;
}
const videoColumns = "id,tiktok_account_id,product_id,selected_script_id,storage_path,status,quality_status,quality_score,quality_explanation_json,provider,updated_at";
async function clipContext(client: SupabaseClient, owner: string, video: Row) {
  const [accountResult, productResult, scriptResult, complianceResult, originalityResult, assetResult] = await Promise.all([
    client.from("tiktok_accounts").select("id,display_name").eq("owner_id", owner).eq("id", video.tiktok_account_id).is("hidden_at", null).maybeSingle(),
    client.from("products").select("id,title,product_url").eq("owner_id", owner).eq("id", video.product_id).maybeSingle(),
    client.from("scripts").select("id,caption,hashtags_json,updated_at").eq("owner_id", owner).eq("id", video.selected_script_id).maybeSingle(),
    client.from("content_compliance_checks").select("overall_status,checked_at").eq("owner_id", owner).eq("video_id", video.id).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("originality_checks").select("originality_status,created_at").eq("owner_id", owner).eq("video_id", video.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("media_assets").select("mime_type,checksum").eq("owner_id", owner).eq("storage_path", video.storage_path).eq("asset_type", "VIDEO").maybeSingle(),
  ]);
  const account = checked(accountResult), product = checked(productResult), script = checked(scriptResult),
    compliance = checked(complianceResult), originality = checked(originalityResult), asset = checked(assetResult);
  return { account, product, script, asset,
    ready: !!account && !!product && !!asset && asset.mime_type === "video/mp4" && /^[a-f0-9]{64}$/i.test(String(asset.checksum))
      && ownsVideoStoragePath(owner, String(video.storage_path)) && storedClipExportReady(video, compliance, originality, script) };
}
export async function listManualClips(client: SupabaseClient, owner: string, account?: string) {
  let query = client.from("master_videos").select(videoColumns).eq("owner_id", owner).order("created_at", { ascending: false }).limit(20);
  if (account) query = query.eq("tiktok_account_id", account);
  const videos = checked(await query) ?? [];
  return Promise.all(videos.map(async (video): Promise<ManualClip> => {
    const context = await clipContext(client, owner, video);
    return { id: String(video.id), name: String(context.product?.title ?? "วิดีโอ"),
      accountName: String(context.account?.display_name ?? "บัญชีของคุณ"), ready: context.ready,
      caption: typeof context.script?.caption === "string" ? context.script.caption : "" };
  }));
}
export async function buildStoredClipPackage(client: SupabaseClient, owner: string, videoId: string) {
  const video = checked(await client.from("master_videos").select(videoColumns).eq("owner_id", owner).eq("id", videoId).maybeSingle());
  if (!video) throw new Error("export_unavailable");
  const context = await clipContext(client, owner, video);
  if (!context.ready || !context.script || !context.product || !context.asset) throw new Error("export_not_ready");
  const media = checked(await client.storage.from(videoStorageBucket).download(String(video.storage_path)));
  if (!media || media.size > 50 * 1024 * 1024) throw new Error("export_media_unavailable");
  const bytes = new Uint8Array(await media.arrayBuffer());
  assertMp4(bytes, context.asset.mime_type);
  if (createHash("sha256").update(bytes).digest("hex") !== context.asset.checksum) throw new Error("export_media_changed");
  const hashtags = Array.isArray(context.script.hashtags_json) ? context.script.hashtags_json.filter((x: unknown): x is string => typeof x === "string") : [];
  const copy = postCaption(String(context.script.caption ?? ""), hashtags);
  let productUrl: string | null = null;
  try { const url = new URL(context.product.product_url); if (url.protocol === "https:" && !url.username && !url.password) productUrl = url.toString(); } catch { /* no public reference */ }
  const manifest = { video: "video.mp4", caption: copy.caption, hashtags: copy.hashtags,
    product: { title: context.product.title, url: productUrl }, publishing: "โพสต์ด้วยตนเอง", aiGenerated: true,
    source: "VIRAL_FLOW_VIDEO", instructions: "ตรวจคลิปและระบุ AI-generated ใน TikTok ก่อนโพสต์" };
  const encoder = new TextEncoder();
  return createPostPackageZip([{ name: "video.mp4", bytes }, { name: "caption.txt", bytes: encoder.encode(copy.text) },
    { name: "package.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2)) }]);
}
