import "server-only";
import { randomUUID, type KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOCAL_LEASE_VERSIONS,
  allowedLeaseExpiry,
  signLocalLease,
  type LocalGrantRequest,
  type LocalLeasePayload,
} from "./local-license";

export async function ownsAvailableLiveSelection(
  client: Pick<SupabaseClient, "from">,
  ownerId: string,
  accountId: string,
  productIds: string[],
): Promise<boolean> {
  const [accountResult, productResult] = await Promise.all([
    client.from("tiktok_accounts")
      .select("id,owner_id,is_mock,authorization_status,hidden_at")
      .eq("owner_id", ownerId).eq("id", accountId).is("hidden_at", null).maybeSingle(),
    client.from("products")
      .select("id,owner_id,status")
      .eq("owner_id", ownerId).in("id", productIds).eq("status", "available"),
  ]);
  if (accountResult.error || productResult.error) return false;
  const account = accountResult.data;
  if (!account || account.id !== accountId || account.owner_id !== ownerId
    || account.is_mock !== false || account.authorization_status !== "authorized"
    || account.hidden_at !== null) return false;
  const products = productResult.data;
  return Array.isArray(products) && products.length === productIds.length
    && new Set(products.map((product) => product.id)).size === productIds.length
    && products.every((product) => product.owner_id === ownerId && product.status === "available"
      && productIds.includes(product.id));
}

export async function issueLocalLease(input: {
  client: Pick<SupabaseClient, "from">;
  ownerId: string;
  appMetadata: unknown;
  request: LocalGrantRequest;
  signingKey: KeyObject;
  nowSeconds?: number;
  grantId?: string;
}) {
  const preliminaryNow = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (allowedLeaseExpiry(input.appMetadata, input.request.deviceId, preliminaryNow) === null) return null;
  if (!await ownsAvailableLiveSelection(input.client, input.ownerId, input.request.accountId, input.request.productIds)) return null;
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiresAt = allowedLeaseExpiry(input.appMetadata, input.request.deviceId, issuedAt);
  if (expiresAt === null) return null;
  const payload: LocalLeasePayload = {
    v: 1,
    ownerId: input.ownerId,
    deviceId: input.request.deviceId,
    challenge: input.request.challenge,
    accountId: input.request.accountId,
    productIds: input.request.productIds,
    grantId: input.grantId ?? randomUUID(),
    issuedAt,
    expiresAt,
    entitled: true,
    versions: LOCAL_LEASE_VERSIONS,
  };
  return signLocalLease(payload, input.signingKey);
}
