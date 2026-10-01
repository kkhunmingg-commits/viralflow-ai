import "server-only";
import type { KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { readJsonBodyWithLimit, RequestSecurityError } from "@/lib/security/request";
import { parseLocalLeaseSigningKey } from "./local-license";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export function deviceResponse(body: unknown, status = 200) { return Response.json(body, { status, headers }); }
export async function deviceJsonBody(request: Request) { return JSON.parse(await readJsonBodyWithLimit(request, 4096)) as unknown; }
export async function deviceHttp(request: Request, mutate: boolean, handler: (context: {
  ownerId: string; appMetadata: unknown; registry: SupabaseClient; signingKey: KeyObject | null;
}) => Promise<Response>) {
  if (mutate && request.headers.get("origin") !== new URL(request.url).origin) return deviceResponse({ error: "คำขอไม่ถูกต้อง" }, 403);
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return deviceResponse({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    if (mutate) await enforceOwnerMutationRateLimit("ai-live-device-registration", data.user.id);
    return await handler({ ownerId: data.user.id, appMetadata: data.user.app_metadata, registry: createAdminClient(),
      signingKey: parseLocalLeaseSigningKey(process.env.AI_LIVE_LEASE_SIGNING_PRIVATE_KEY) });
  } catch (error) {
    if (error instanceof SyntaxError) return deviceResponse({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
    if (error instanceof RequestSecurityError) return deviceResponse({ error: error.status === 429 ? "กรุณารอสักครู่แล้วลองอีกครั้ง" : "คำขอไม่ถูกต้อง" }, error.status);
    return deviceResponse({ error: "ยังไม่สามารถจัดการส่วนเสริมได้ กรุณาลองอีกครั้ง" }, 503);
  }
}
