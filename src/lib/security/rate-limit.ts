import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { RequestSecurityError, assertRateLimitResult } from "./request";

type RateLimitClient = Pick<SupabaseClient, "rpc">;

export async function enforceRateLimit(
  input: {
    scope: string;
    keyHash: string;
    limit: number;
    windowSeconds: number;
  },
  client: RateLimitClient = createAdminClient(),
) {
  const { data, error } = await client.rpc("consume_security_rate_limit", {
    p_scope: input.scope,
    p_key_hash: input.keyHash,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  assertRateLimitResult(data, error);
}

export async function enforceOwnerMutationRateLimit(scope: string, ownerId: string) {
  if (!serverEnv.supabaseSecretKey) {
    throw new RequestSecurityError("rate_limit_unavailable", 503);
  }
  await enforceRateLimit({
    scope: `owner-mutation:${scope}`,
    keyHash: createHash("sha256").update(ownerId).digest("hex"),
    limit: serverEnv.authenticatedMutationRateLimit,
    windowSeconds: 60,
  });
}
