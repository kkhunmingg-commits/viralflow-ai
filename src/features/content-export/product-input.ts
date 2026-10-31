import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FFmpegVideoRenderer } from "@/features/video/renderer";
import { videoStoragePath } from "@/features/video/storage";
import { contentExportConfig } from "./config";
export const productInputSchema = z.object({ title: z.string().trim().min(1).max(300), category: z.string().trim().min(1).max(80),
  price: z.coerce.number().finite().min(0).max(1_000_000), rights: z.literal("on") });
export function assertProductImage(bytes: Uint8Array, mime: string) {
  if (bytes.length < 32 || bytes.length > 750_000) throw new Error("product_image_invalid");
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString() === "WEBP";
  if (!(mime === "image/jpeg" && jpeg || mime === "image/png" && png || mime === "image/webp" && webp)) throw new Error("product_image_invalid");
}
export async function saveContentProduct(admin: SupabaseClient, owner: string, form: FormData) {
  const config = contentExportConfig(); if (!config.enabled || !config.allowedOwners.includes(owner)) throw new Error("content_not_configured");
  const input = productInputSchema.parse(Object.fromEntries(form));
  const image = form.get("image"); if (!(image instanceof File) || image.size > 750_000) throw new Error("product_image_invalid");
  const bytes = new Uint8Array(await image.arrayBuffer()); assertProductImage(bytes, image.type);
  const id = randomUUID(), dir = join(tmpdir(), "viralflow-product-input", id); await mkdir(dir, { recursive: true });
  let media;
  try { const path = join(dir, "image"); await writeFile(path, bytes); media = await new FFmpegVideoRenderer().probe(path);
    if (media.width < 100 || media.height < 100 || media.width > 4096 || media.height > 4096) throw new Error("product_image_invalid");
  } finally { await rm(dir, { recursive: true, force: true }); }
  const path = videoStoragePath(owner, "products", id, image.type === "image/jpeg" ? "reference.jpg" : image.type === "image/png" ? "reference.png" : "reference.webp");
  const uploaded = await admin.storage.from("video-assets").upload(path, bytes, { contentType: image.type, upsert: false });
  if (uploaded.error) throw new Error("product_upload_failed");
  const now = new Date().toISOString();
  const product = await admin.from("products").insert({ id, owner_id: owner, external_provider: "owner", external_product_id: id,
    title: input.title, slug: id, category_key: input.category, current_price: input.price,
    commission_rate: 0, commission_amount: 0, rating: null, review_count: 0, units_sold: 0, status: "available",
    provider_metadata: { source: "OWNER_SUPPLIED", metricsAvailability: "UNKNOWN", claimsVerified: false }, first_seen_at: now, last_seen_at: now });
  if (product.error) { await admin.storage.from("video-assets").remove([path]); throw new Error("product_save_failed"); }
  const asset = await admin.from("media_assets").insert({ owner_id: owner, product_id: id, asset_type: "PRODUCT_IMAGE", source_type: "UPLOAD",
    storage_path: path, mime_type: image.type, width: media.width, height: media.height, checksum: createHash("sha256").update(bytes).digest("hex") });
  if (asset.error) {
    await admin.from("products").delete().eq("owner_id", owner).eq("id", id).eq("external_provider", "owner");
    await admin.storage.from("video-assets").remove([path]); throw new Error("product_save_failed");
  }
  return { id, title: input.title };
}
