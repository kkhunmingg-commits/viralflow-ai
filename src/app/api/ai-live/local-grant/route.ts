import { localGrantRequestSchema } from "@/features/ai-live/local-license";
import { readLiveSigningConfiguration } from "@/features/ai-live/server-config";
import { issueLocalLease } from "@/features/ai-live/local-license-server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { readJsonBodyWithLimit, RequestSecurityError } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function failure(status: number, error: string) {
  return Response.json({ error }, { status, headers });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return failure(403, "คำขอไม่ถูกต้อง");
  }

  try {
    const client = await createClient();
    // getUser makes a network request to Auth; session metadata alone is not authority.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return failure(401, "กรุณาเข้าสู่ระบบ");

    await enforceOwnerMutationRateLimit("ai-live-local-grant", data.user.id);

    const raw = await readJsonBodyWithLimit(request, 4096);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return failure(400, "ข้อมูลไม่ถูกต้อง");
    }
    const parsed = localGrantRequestSchema.safeParse(body);
    if (!parsed.success) return failure(400, "ข้อมูลไม่ถูกต้อง");

    const signing = readLiveSigningConfiguration();
    if (!signing) return failure(503, "AI LIVE ยังไม่พร้อมใช้งาน");

    const grant = await issueLocalLease({
      client,
      registry: createAdminClient(),
      ownerId: data.user.id,
      appMetadata: data.user.app_metadata,
      request: parsed.data,
      signingKey: signing.signingKey,
      keyId: signing.keyId,
    });
    if (!grant) return failure(403, "AI LIVE ยังไม่พร้อมใช้งานสำหรับบัญชีนี้");
    return Response.json(grant, { headers });
  } catch (error) {
    if (error instanceof RequestSecurityError) {
      const message = error.status === 429 ? "กรุณารอสักครู่แล้วลองอีกครั้ง" : "คำขอไม่ถูกต้อง";
      return Response.json({ error: message }, {
        status: error.status,
        headers: { ...headers, ...(error.status === 429 ? { "Retry-After": "60" } : {}) },
      });
    }
    return failure(503, "AI LIVE ยังไม่พร้อมใช้งาน");
  }
}
