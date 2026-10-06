import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLatestVideoGate } from "@/features/compliance/services";
import { ownsVideoStoragePath } from "@/features/video/storage";
import { autoVideoQualityOutcome } from "./execution-policy";
import { exportContentGate, readPostOutput } from "./post-outputs";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Store-only ZIP with fixed entry names; no shell, files on disk, or caller-controlled paths. */
export function createPostPackageZip(entries: readonly { name: "video.mp4" | "caption.txt" | "package.json"; bytes: Uint8Array }[]) {
  const local: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"), bytes = Buffer.from(entry.bytes), checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name); offset += header.length + name.length + bytes.length;
  }
  const centralBytes = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

export async function buildAuthorizedPostPackage(client: SupabaseClient, ownerId: string, outputId: string) {
  const output = await readPostOutput(client, ownerId, outputId);
  if (output.posting_mode !== "EXPORT" || output.status !== "READY") throw new Error("post_export_not_ready");
  const [account, video, gate] = await Promise.all([
    client.from("tiktok_accounts").select("id").eq("owner_id", ownerId).eq("id", output.tiktok_account_id).maybeSingle(),
    client.from("master_videos").select("tiktok_account_id,product_id,storage_path,status,quality_status,quality_score,quality_explanation_json,provider")
      .eq("owner_id", ownerId).eq("id", output.video_id).eq("tiktok_account_id", output.tiktok_account_id).maybeSingle(),
    getLatestVideoGate(client, ownerId, output.video_id),
  ]);
  if (account.error || !account.data || video.error || !video.data || video.data.product_id !== output.product_id
    || autoVideoQualityOutcome(video.data).kind !== "ADVANCE" || !exportContentGate(gate)
    || !ownsVideoStoragePath(ownerId, String(video.data.storage_path))) throw new Error("post_export_not_ready");
  const asset = await client.from("media_assets").select("mime_type,checksum")
    .eq("owner_id", ownerId).eq("storage_path", video.data.storage_path).eq("asset_type", "VIDEO").maybeSingle();
  if (asset.error || !asset.data || asset.data.mime_type !== "video/mp4") throw new Error("post_export_media_invalid");
  const media = await client.storage.from("video-assets").download(video.data.storage_path);
  if (media.error || !media.data || media.data.size > 52_428_800 || media.data.size < 1) throw new Error("post_export_media_unavailable");
  const videoBytes = new Uint8Array(await media.data.arrayBuffer());
  if (createHash("sha256").update(videoBytes).digest("hex") !== asset.data.checksum) throw new Error("post_export_media_changed");
  const hashtags = Array.isArray(output.hashtags_json) ? output.hashtags_json.filter(value => typeof value === "string").slice(0, 30) : [];
  const caption = [output.caption, hashtags.map(value => value.startsWith("#") ? value : `#${value}`).join(" ")].filter(Boolean).join("\n\n");
  // Project the public product reference rather than exporting an arbitrary stored JSON object.
  const reference = output.product_reference_json;
  const product = { title: typeof reference?.title === "string" ? reference.title : "", url: null as string | null };
  try { const url = new URL(reference?.url ?? ""); if (url.protocol === "https:" && !url.username && !url.password) product.url = url.toString(); } catch { /* Unknown reference stays unknown. */ }
  const manifest = { caption: output.caption, hashtags,
    product, suggestedPostingTime: output.suggested_post_at,
    video: "video.mp4", publishing: "โพสต์ด้วยตนเอง", aiGenerated: true };
  return createPostPackageZip([{ name: "video.mp4", bytes: videoBytes },
    { name: "caption.txt", bytes: Buffer.from(caption, "utf8") },
    { name: "package.json", bytes: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }]);
}
