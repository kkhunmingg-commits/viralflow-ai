import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { liveDeviceStatus } from "./device-registry";
import { LOCAL_LEASE_VERSIONS, readLocalEntitlement } from "./local-license";
import { ownsAvailableLiveSelection } from "./local-license-server";
import { signLiveEnvelope, type LiveSigningConfiguration } from "./server-config";

export const productContextRequestSchema = z.strictObject({
  deviceId: z.uuid(), accountId: z.uuid(), productIds: z.array(z.uuid()).min(1).max(10),
}).refine((value) => new Set(value.productIds).size === value.productIds.length);

const text = z.string().trim().min(1).max(512);
const extraFacts = z.object({
  stock: z.number().int().nonnegative().max(1_000_000_000).optional(),
  colors: z.array(text.max(80)).max(30).optional(), sizes: z.array(text.max(80)).max(30).optional(),
  shipping: text.optional(), promotion: text.optional(), purchase: text.optional(),
  attributes: z.record(z.string().min(1).max(100), text).refine((value) => Object.keys(value).length <= 20).optional(),
  faq: z.record(z.string().min(1).max(100), text).refine((value) => Object.keys(value).length <= 20).optional(),
});
const productRow = z.object({
  id: z.uuid(), owner_id: z.uuid(), title: z.string().min(1).max(300),
  current_price: z.number().finite().nonnegative().max(100_000_000), currency: z.literal("THB"),
  updated_at: z.iso.datetime({ offset: true }), provider_metadata: z.record(z.string(), z.unknown()),
});

export function projectLiveProductFacts(row: z.infer<typeof productRow>) {
  // Only explicit store facts are synchronized. Availability is not inventory,
  // original_price is not a promised promotion, and product URLs are not claims.
  const metadata = extraFacts.safeParse(row.provider_metadata.live_commerce);
  return { price: row.current_price, currency: row.currency, ...(metadata.success ? metadata.data : {}) };
}

export async function issueLiveProductContext(input: {
  client: Pick<SupabaseClient, "from">; registry: Pick<SupabaseClient, "from" | "rpc">;
  ownerId: string; appMetadata: unknown; request: z.infer<typeof productContextRequestSchema>;
  signing: LiveSigningConfiguration; nowSeconds?: number;
}) {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const entitlement = readLocalEntitlement(input.appMetadata, now);
  if (!entitlement) return null;
  const device = await liveDeviceStatus(input.registry, input.ownerId, input.request.deviceId, input.appMetadata, now);
  if (!device.device.authorized || !device.entitled) return null;
  if (!await ownsAvailableLiveSelection(input.client, input.ownerId, input.request.accountId, input.request.productIds)) return null;
  const { data, error } = await input.client.from("products")
    .select("id,owner_id,title,current_price,currency,updated_at,provider_metadata")
    .eq("owner_id", input.ownerId).in("id", input.request.productIds).eq("status", "available");
  if (error || !Array.isArray(data) || data.length !== input.request.productIds.length) return null;
  const rows = data.map((row) => productRow.safeParse(row));
  if (rows.some((row) => !row.success)) return null;
  const products = rows.map((parsed) => {
    if (!parsed.success) throw new Error("product_context_invalid");
    const row = parsed.data;
    if (row.owner_id !== input.ownerId || !input.request.productIds.includes(row.id)) throw new Error("product_context_invalid");
    return { productId: row.id, name: row.title.slice(0, 160), version: row.updated_at, facts: projectLiveProductFacts(row) };
  });
  if (new Set(products.map((row) => row.productId)).size !== products.length) return null;
  // Database reads may take time. Recheck entitlement immediately before signing.
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!readLocalEntitlement(input.appMetadata, issuedAt)) return null;
  return signLiveEnvelope({ v: 1, purpose: "AI_LIVE_PRODUCT_CONTEXT", ownerId: input.ownerId,
    deviceId: input.request.deviceId, accountId: input.request.accountId, productIds: input.request.productIds,
    products, issuedAt, expiresAt: Math.min(issuedAt + 120, Math.floor(Date.parse(entitlement.expiresAt) / 1000)),
    versions: LOCAL_LEASE_VERSIONS }, input.signing);
}
