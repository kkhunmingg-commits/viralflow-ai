import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeFlowWorker } from "@/features/flow-farm/worker-auth";
import { claimSchema, clipRefSchema, completeSchema, exhaustedSchema, failSchema } from "@/features/flow-farm/contracts";
import { claimClip, clipUploadUrl, completeClip, failClip, finishWithoutCredits, markExhausted, workerAccounts } from "@/features/flow-farm/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const KNOWN = new Set(["FLOW_ACCOUNT_UNAVAILABLE", "PRODUCT_IMAGE_UNAVAILABLE", "CLIP_NOT_GENERATING", "UPLOADED_VIDEO_MISSING", "INVALID_MP4",
  "CHECKSUM_MISMATCH", "NOT_PORTRAIT_9_16", "DUPLICATE_VIDEO"]);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Endpoints for the owner's local Flow worker (workers/flow-browser/farm.mjs). Token-authenticated, one owner. */
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const auth = authorizeFlowWorker(request);
  if (!auth.ok) return reply({ error: "unauthorized" }, auth.status);
  if ((await context.params).action !== "accounts") return reply({ error: "not_found" }, 404);
  return reply({ accounts: await workerAccounts(createAdminClient(), auth.owner) });
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const auth = authorizeFlowWorker(request);
  if (!auth.ok) return reply({ error: "unauthorized" }, auth.status);
  const { action } = await context.params;
  let body: unknown = {};
  try { body = await request.json(); } catch { body = {}; }
  const admin = createAdminClient(), owner = auth.owner;
  try {
    switch (action) {
      case "claim": return reply({ clip: await claimClip(admin, owner, claimSchema.parse(body).flowAccountId) });
      case "upload-url": return reply(await clipUploadUrl(admin, owner, clipRefSchema.parse(body).clipId));
      case "complete": return reply(await completeClip(admin, owner, completeSchema.parse(body)));
      case "fail": await failClip(admin, owner, failSchema.parse(body)); return reply({ ok: true });
      case "exhausted": await markExhausted(admin, owner, exhaustedSchema.parse(body).flowAccountId); return reply({ ok: true });
      case "finish": return reply(await finishWithoutCredits(admin, owner));
      default: return reply({ error: "not_found" }, 404);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (KNOWN.has(code)) return reply({ error: code }, 409);
    if (error && typeof error === "object" && "issues" in error) return reply({ error: "invalid_request" }, 400);
    return reply({ error: "server_error" }, 500);
  }
}
