import { readLocalEntitlement } from "@/features/ai-live/local-license";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { RequestSecurityError } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET() {
  try {
    const client = await createClient();
    // The Auth server supplies current trusted membership, never editable profile data.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401, headers });
    await enforceOwnerMutationRateLimit("ai-live-entitlement-read", data.user.id);
    return Response.json({ supported: readLocalEntitlement(data.user.app_metadata, Math.floor(Date.now() / 1000)) !== null }, { headers });
  } catch (error) {
    if (error instanceof RequestSecurityError) return Response.json({ error: "กรุณารอสักครู่แล้วลองอีกครั้ง" }, {
      status: error.status, headers: { ...headers, ...(error.status === 429 ? { "Retry-After": "60" } : {}) },
    });
    return Response.json({ error: "ยังไม่สามารถตรวจสอบสิทธิ์ได้ กรุณาลองอีกครั้ง" }, { status: 503, headers });
  }
}
