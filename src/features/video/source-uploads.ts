import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { portraitProductReference, validateNarrationAudio } from "./media-composition";
import { videoStoragePath } from "./storage";
import { VIDEO_BUCKET } from "./types";

export const VIDEO_SOURCE_UPLOAD_MAX_BYTES = 750_000;
type SourceKind = "PRODUCT_IMAGE" | "VOICE";
type Row = Record<string, unknown>;
const imageTypes: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const voiceTypes: Record<string, string> = { "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg" };

function matchesFileType(bytes: Uint8Array, mime: string) {
  const prefix = Buffer.from(bytes), starts = (value: string, offset = 0) => prefix.subarray(offset, offset + value.length).toString("ascii") === value;
  if (mime === "image/jpeg") return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (mime === "image/png") return prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return starts("RIFF") && starts("WEBP", 8);
  if (mime === "audio/wav" || mime === "audio/x-wav") return starts("RIFF") && starts("WAVE", 8);
  if (mime === "audio/mpeg") return starts("ID3") || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0 && (prefix[1] & 0x06) !== 0);
  if (mime === "audio/mp4") return starts("ftyp", 4);
  if (mime === "audio/ogg") return starts("OggS");
  return false;
}

async function owned(client: SupabaseClient, ownerId: string, table: string, id: string): Promise<Row> {
  const { data, error } = await client.from(table).select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("video_source_not_found");
  return data as Row;
}

/** Save only the owner's validated original photograph or narration; generation happens separately. */
export async function uploadVideoFactorySource(client: SupabaseClient, ownerId: string, masterId: string, kind: SourceKind, file: File) {
  if (kind !== "PRODUCT_IMAGE" && kind !== "VOICE") throw new Error("video_source_type_invalid");
  if (!(file instanceof File) || !file.size || file.size > VIDEO_SOURCE_UPLOAD_MAX_BYTES) throw new Error("video_source_size_invalid");
  const mime = file.type.trim().toLowerCase(), types = kind === "PRODUCT_IMAGE" ? imageTypes : voiceTypes;
  const extension = Object.hasOwn(types, mime) ? types[mime] : undefined;
  if (!extension) throw new Error("video_source_type_invalid");
  const master = await owned(client, ownerId, "master_videos", masterId);
  if (!master.creative_project_id || !master.product_id) throw new Error("video_source_not_found");
  const [project, product, account] = await Promise.all([
    owned(client, ownerId, "creative_projects", String(master.creative_project_id)),
    owned(client, ownerId, "products", String(master.product_id)),
    owned(client, ownerId, "tiktok_accounts", String(master.tiktok_account_id)),
  ]);
  if (project.product_id !== product.id || project.tiktok_account_id !== account.id || master.tiktok_account_id !== account.id) throw new Error("video_source_identity_invalid");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > VIDEO_SOURCE_UPLOAD_MAX_BYTES) throw new Error("video_source_size_invalid");
  if (!matchesFileType(bytes, mime)) throw new Error("video_source_file_invalid");
  const original = new Blob([bytes], { type: mime });
  try {
    if (kind === "PRODUCT_IMAGE") await portraitProductReference(original);
    else await validateNarrationAudio(original);
  } catch { throw new Error("video_source_file_invalid"); }
  const storagePath = videoStoragePath(ownerId, kind === "PRODUCT_IMAGE" ? "products" : "masters",
    String(kind === "PRODUCT_IMAGE" ? product.id : master.id), `source-${randomUUID()}.${extension}`);
  const bucket = client.storage.from(VIDEO_BUCKET);
  const uploaded = await bucket.upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (uploaded.error) throw new Error("video_source_upload_failed");
  try {
    const asset = await client.from("media_assets").upsert({ owner_id: ownerId, product_id: product.id,
      creative_project_id: project.id, asset_type: kind, source_type: "UPLOAD", storage_path: storagePath,
      mime_type: mime, provider: "upload", model: "owner-source-v1", checksum: createHash("sha256").update(bytes).digest("hex") },
    { onConflict: "owner_id,storage_path" });
    if (asset.error) throw new Error("video_source_asset_write_failed");
  } catch (error) {
    await bucket.remove([storagePath]).catch(() => undefined);
    throw error;
  }
  return { assetType: kind, storagePath };
}
