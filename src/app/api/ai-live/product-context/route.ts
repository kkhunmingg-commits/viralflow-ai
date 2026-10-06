import { issueLiveProductContext, productContextRequestSchema } from "@/features/ai-live/product-context-server";
import { readLiveSigningConfiguration } from "@/features/ai-live/server-config";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { readJsonBodyWithLimit, RequestSecurityError } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const failure = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return failure(403, "คำขอไม่ถูกต้อง");
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return failure(401, "กรุณาเข้าสู่ระบบ");
    await enforceOwnerMutationRateLimit("ai-live-product-context", data.user.id);
    const parsed = productContextRequestSchema.safeParse(JSON.parse(await readJsonBodyWithLimit(request, 4096)));
    if (!parsed.success) return failure(400, "ข้อมูลไม่ถูกต้อง");
    const signing = readLiveSigningConfiguration();
    if (!signing) return failure(503, "AI LIVE ยังไม่พร้อมใช้งาน");
    const context = await issueLiveProductContext({ client, registry: createAdminClient(), ownerId: data.user.id,
      appMetadata: data.user.app_metadata, request: parsed.data, signing });
    if (!context) return failure(403, "ยังไม่สามารถเตรียมสินค้าสำหรับบัญชีนี้ได้");
    return Response.json(context, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return failure(400, "ข้อมูลไม่ถูกต้อง");
    if (error instanceof RequestSecurityError) return failure(error.status, "คำขอไม่ถูกต้อง");
    return failure(503, "ยังไม่สามารถเตรียมข้อมูลสินค้าได้ กรุณาลองอีกครั้ง");
  }
}
