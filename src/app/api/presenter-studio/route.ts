import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { RequestSecurityError } from "@/lib/security/request";
import { actionSchema, ERRORS_TH, StudioError, workerOnline } from "@/features/presenter-studio/contract";
import { changeStudio, photoUploadUrl, studioView } from "@/features/presenter-studio/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function signedIn() {
  const { data } = await (await createClient()).auth.getUser();
  return data.user?.id ?? null;
}

/** The "สร้างพรีเซนเตอร์ใหม่" panel polls this: the owner's presenters and how far the PC got with each. */
export async function GET() {
  const owner = await signedIn();
  if (!owner) return reply({ error: "unauthorized" }, 401);
  const view = await studioView(createAdminClient(), owner);
  return reply({ ...view, online: workerOnline(view.report) });
}

/** Create / pick a face / rebuild / delete / choose the live presenter, or get a signed photo upload address. */
export async function POST(request: Request) {
  const owner = await signedIn();
  if (!owner) return reply({ error: "unauthorized" }, 401);
  // Same-site only: the page posts JSON, a form on another site cannot.
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return reply({ error: "json_only" }, 415);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "invalid_action", message: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ครบ" }, 400);
  const admin = createAdminClient();
  try {
    await enforceOwnerMutationRateLimit("presenter-studio", owner);
    if (parsed.data.action === "uploadUrl") return reply(await photoUploadUrl(admin, owner, parsed.data.type));
    const next = await changeStudio(admin, owner, parsed.data);
    return reply({ ok: true, active: next.active, count: next.presenters.length });
  } catch (error) {
    if (error instanceof StudioError) return reply({ error: error.message, message: ERRORS_TH[error.message] ?? error.message }, 409);
    if (error instanceof RequestSecurityError) return reply({ error: error.code, message: "กดถี่เกินไป รอสักครู่แล้วลองใหม่" }, error.status);
    return reply({ error: error instanceof Error ? error.message : "failed", message: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง" }, 500);
  }
}
