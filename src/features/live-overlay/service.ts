import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStateFile, saveStateFile } from "@/features/flow-farm/service";
import { praewSources } from "@/features/ai-live/lineup-service";
import { PRAEW_MAX_PRODUCTS, liveBlockStart, praewProducts, selectLiveLineup, type LiveCandidate, type PostedTikTokProduct, type TikTokLivePick } from "@/features/ai-live/live-director";
import { configSchema, emptyConfig, parseToken, type OverlayConfig, type OverlayProduct, type StoredOverlay } from "./model";

const ASSET_BUCKET = "video-assets";
const path = (owner: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(owner)) throw new Error("INVALID_OWNER");
  return `owner/${owner}/praew-live/overlay.json`;
};
const newSecret = () => randomBytes(24).toString("base64url");

export async function readOverlay(admin: SupabaseClient, owner: string): Promise<StoredOverlay | null> {
  const stored = await readStateFile<StoredOverlay>(admin, path(owner));
  if (!stored) return null;
  const parsed = configSchema.safeParse(stored);
  return { ...(parsed.success ? parsed.data : emptyConfig()), secret: String(stored.secret ?? ""), updatedAt: String(stored.updatedAt ?? "") };
}

/** The owner's layout; the first read creates the file so the OBS link exists from the start. */
export async function ownOverlay(admin: SupabaseClient, owner: string): Promise<StoredOverlay> {
  const stored = await readOverlay(admin, owner);
  if (stored?.secret) return stored;
  const fresh = { ...emptyConfig(), ...stored, secret: newSecret(), updatedAt: new Date().toISOString() };
  await saveStateFile(admin, path(owner), fresh, "overlay_not_saved");
  return fresh;
}

export async function saveOverlay(admin: SupabaseClient, owner: string, config: OverlayConfig, rotate = false) {
  const current = await ownOverlay(admin, owner);
  const next: StoredOverlay = { ...configSchema.parse(config), secret: rotate ? newSecret() : current.secret, updatedAt: new Date().toISOString() };
  await saveStateFile(admin, path(owner), next, "overlay_not_saved");
  return next;
}

/** The OBS page has no sign-in: its link carries the owner id and the secret, checked here. */
export async function overlayByToken(admin: SupabaseClient, token: string | null) {
  const parsed = parseToken(token);
  if (!parsed) return null;
  const stored = await readOverlay(admin, parsed.owner);
  if (!stored?.secret) return null;
  const a = Buffer.from(stored.secret), b = Buffer.from(parsed.secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { owner: parsed.owner, overlay: stored };
}

/** The same products Praew talks about (same order), with a listing photo and a plain price where one is known. */
export function overlayProductsFrom(candidates: readonly LiveCandidate[], now: Date,
  postedTikTok: readonly PostedTikTokProduct[] = [], picks: readonly TikTokLivePick[] = []): OverlayProduct[] {
  const blockStart = liveBlockStart(now);
  const list = praewProducts(selectLiveLineup(candidates, blockStart), candidates, PRAEW_MAX_PRODUCTS, postedTikTok, picks);
  return list.map(p => {
    const c = p.source === "TIKTOK_PICK" ? picks.find(x => x.title.slice(0, 200) === p.name)
      : p.source === "TIKTOK_SALES" ? candidates.find(x => x.title.slice(0, 120) === p.name)
      : p.source === "POSTED_TIKTOK" ? postedTikTok.find(x => x.title.slice(0, 120) === p.name) : undefined;
    return {
      name: p.name, facts: p.facts, where: p.where,
      price: c?.price ? `฿${c.price.toLocaleString("th-TH")}` : null,
      image: p.image ?? null,
    };
  });
}
export async function overlayProducts(client: SupabaseClient, owner: string, now = new Date()) {
  const s = await praewSources(client, owner, now);
  return overlayProductsFrom(s.candidates, now, s.postedTikTok, s.picks);
}

/** Only the owner's own files can be shown through an overlay link. */
export const ownsAsset = (owner: string, ref: string) =>
  ref.startsWith(`owner/${owner}/`) && !ref.includes("..") && /^[A-Za-z0-9/_.-]{1,400}$/.test(ref);

export async function signedAsset(admin: SupabaseClient, owner: string, ref: string) {
  if (!ownsAsset(owner, ref)) return null;
  const signed = await admin.storage.from(ASSET_BUCKET).createSignedUrl(ref, 6 * 3600);
  return signed.error ? null : signed.data.signedUrl;
}

/** A picture the owner adds to the overlay: uploaded straight from the browser (PNG keeps transparency). */
export async function overlayUploadUrl(admin: SupabaseClient, owner: string, type: "image/png" | "image/jpeg") {
  path(owner);
  const file = `owner/${owner}/live-overlay/${randomBytes(9).toString("base64url")}.${type === "image/png" ? "png" : "jpg"}`;
  const signed = await admin.storage.from(ASSET_BUCKET).createSignedUploadUrl(file);
  if (signed.error || !signed.data) throw new Error("UPLOAD_URL_UNAVAILABLE");
  return { path: file, signedUrl: signed.data.signedUrl, token: signed.data.token };
}

/** The OBS page polls every few seconds; the product list is worked out at most once a minute. */
const PRODUCTS_TTL_MS = 60_000;
export async function cachedOverlayProducts(admin: SupabaseClient, owner: string, now = new Date()): Promise<OverlayProduct[]> {
  const file = `owner/${owner}/praew-live/overlay-products.json`;
  const cached = await readStateFile<{ at: string; products: OverlayProduct[] }>(admin, file);
  if (cached && now.getTime() - Date.parse(cached.at) < PRODUCTS_TTL_MS) return cached.products;
  try {
    const products = await overlayProducts(admin, owner, now);
    await saveStateFile(admin, file, { at: now.toISOString(), products }, "overlay_products_not_saved").catch(() => {});
    return products;
  } catch {
    return cached?.products ?? [];
  }
}
