import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { RequestSecurityError } from "@/lib/security/request";
import { readLocalEntitlement } from "@/features/ai-live/local-license";
import { readLiveSigningConfiguration } from "@/features/ai-live/server-config";
import { ConfiguredLiveUpdateDistribution, createLiveUpdateManifest, readLiveUpdateRelease } from "@/features/ai-live/update-distribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function response(body: unknown, status: number) { return Response.json(body, { status, headers }); }

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin !== null && origin !== new URL(request.url).origin)
    || request.headers.get("sec-fetch-site") === "cross-site") return response({ error: "คำขอไม่ถูกต้อง" }, 403);
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return response({ error: "กรุณาเข้าสู่ระบบ" }, 401);
    const now = Math.floor(Date.now() / 1000);
    if (!readLocalEntitlement(data.user.app_metadata, now)) return response({ error: "บัญชีนี้ยังไม่สามารถใช้ AI LIVE" }, 403);
    await enforceOwnerMutationRateLimit("ai-live-update-manifest", data.user.id);
    const signing = readLiveSigningConfiguration();
    const release = readLiveUpdateRelease();
    if (!signing?.keyId || !release) return response({ error: "การอัปเดตส่วนเสริมยังอยู่ระหว่างการเตรียมพร้อม" }, 503);
    return response(createLiveUpdateManifest(new ConfiguredLiveUpdateDistribution(release), signing, now), 200);
  } catch (error) {
    if (error instanceof RequestSecurityError) return response({ error: error.status === 429
      ? "กรุณารอสักครู่แล้วลองอีกครั้ง" : "ยังไม่สามารถตรวจสอบการอัปเดตได้" }, error.status);
    return response({ error: "ยังไม่สามารถตรวจสอบการอัปเดตได้" }, 503);
  }
}
