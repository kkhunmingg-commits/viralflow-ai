import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeFlowWorker } from "@/features/flow-farm/worker-auth";
import { claimSchema, clipRefSchema, completeSchema, exhaustedSchema, failSchema, loginStateSchema, progressSchema } from "@/features/flow-farm/contracts";
import { claimClip, clipUploadUrl, completeClip, failClip, finishWithoutCredits, markExhausted, reopenMissedClip, reportProgress, setLoginState, workerAccounts } from "@/features/flow-farm/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Drama Studio cuts episodes (ffmpeg) in the background of the worker's poll.
export const maxDuration = 300;

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const KNOWN = new Set(["FLOW_ACCOUNT_UNAVAILABLE", "PRODUCT_IMAGE_UNAVAILABLE", "CLIP_NOT_GENERATING", "UPLOADED_VIDEO_MISSING", "INVALID_MP4",
  "CHECKSUM_MISMATCH", "NOT_PORTRAIT_9_16", "DUPLICATE_VIDEO", "CLIP_NOT_RECOVERABLE", "PRODUCT_CLIP_NOT_FOUND"]);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Endpoints for each owner's local Flow worker (workers/flow-browser/farm.mjs). The token decides whose queue it serves. */
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const auth = await authorizeFlowWorker(request);
  if (!auth.ok) return reply({ error: "unauthorized" }, auth.status);
  const action = (await context.params).action;
  if (action === "worker-files") {
    const { workerBundle } = await import("@/features/flow-farm/installer");
    return reply(await workerBundle());
  }
  if (action === "product-lookups") {
    // Product pages Shopee/Lazada would not show the server: the worker opens them in its own Chrome.
    const { claimProductLookups } = await import("@/features/product-links/service");
    return reply({ lookups: await claimProductLookups(createAdminClient(), auth.owner) });
  }
  if (action === "presenters") {
    // The owner's computer turns a ready AI LIVE presenter into a lip-sync bundle: ?id= gives its takes' links.
    const service = await import("@/features/ai-live/presenter-service");
    const id = new URL(request.url).searchParams.get("id");
    const admin = createAdminClient();
    if (!id) return reply({ presenters: await service.readyPresenters(admin, auth.owner) });
    if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: "not_found" }, 404);
    try { return reply({ presenter: await service.presenterDownloads(admin, auth.owner, id) }); }
    catch (error) { return reply({ error: error instanceof Error ? error.message : "failed" }, 404); }
  }
  if (action !== "accounts") return reply({ error: "not_found" }, 404);
  const admin = createAdminClient();
  // The worker polls every minute, which makes it a free clock for pulling clip stats from TikTok (hourly per account).
  after(() => import("@/features/flow-farm/learning-store").then(m => m.syncStaleAccounts(admin, auth.owner)).catch(() => {}));
  // The same poll drives Drama Studio: queue each series' next shot, take finished shots' last frames, cut episodes.
  after(() => import("@/features/drama/service").then(m => m.tickOwner(admin, auth.owner)).catch(() => {}));
  // And product clips from pasted Shopee/Lazada links: requeue failed takes, cut finished ones, advance posting.
  after(() => import("@/features/product-links/service").then(m => m.tickProductClips(admin, auth.owner)).catch(() => {}));
  // And AI LIVE presenters: face take, then the talking and idle takes that start from it.
  after(() => import("@/features/ai-live/presenter-service").then(m => m.tickPresenters(admin, auth.owner)).catch(() => {}));
  return reply({ accounts: await workerAccounts(admin, auth.owner) });
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const auth = await authorizeFlowWorker(request);
  if (!auth.ok) return reply({ error: "unauthorized" }, auth.status);
  const { action } = await context.params;
  let body: unknown = {};
  try { body = await request.json(); } catch { body = {}; }
  const admin = createAdminClient(), owner = auth.owner;
  try {
    switch (action) {
      // A worker without self-update (the 31 Oct copy kept coming back after reboots) cannot see finished clips and
      // spends 10 credits per clip for nothing: it gets no new clips, only the self-updating worker does.
      case "claim": if (!request.headers.get("x-flow-worker")) {
          // Tell the clip page, so a stuck queue says why instead of looking idle.
          await reportProgress(admin, owner, { stage: "IDLE", detail: "WORKER_OUTDATED" }).catch(() => {});
          return reply({ error: "WORKER_OUTDATED" }, 409);
        }
        return reply({ clip: await claimClip(admin, owner, claimSchema.parse(body).flowAccountId) });
      case "upload-url": return reply(await clipUploadUrl(admin, owner, clipRefSchema.parse(body).clipId));
      case "complete": {
        const done = await completeClip(admin, owner, completeSchema.parse(body));
        // A finished drama shot lets the series queue its next shot straight away.
        after(() => import("@/features/drama/service").then(m => m.tickOwner(admin, owner)).catch(() => {}));
        after(() => import("@/features/product-links/service").then(m => m.tickProductClips(admin, owner)).catch(() => {}));
        after(() => import("@/features/ai-live/presenter-service").then(m => m.tickPresenters(admin, owner)).catch(() => {}));
        return reply(done);
      }
      case "fail": {
        const input = failSchema.parse(body);
        await failClip(admin, owner, input);
        // A drama shot the repair account cannot make goes back to the series' main account.
        if (input.notStarted) await import("@/features/drama/service").then(m => m.fallBackToMainAccount(admin, owner, input.clipId, input.reason)).catch(() => {});
        return reply({ ok: true });
      }
      case "exhausted": await markExhausted(admin, owner, exhaustedSchema.parse(body).flowAccountId); return reply({ ok: true });
      case "login": await setLoginState(admin, owner, loginStateSchema.parse(body)); return reply({ ok: true });
      case "reopen": await reopenMissedClip(admin, owner, clipRefSchema.parse(body).clipId); return reply({ ok: true });
      case "progress": await reportProgress(admin, owner, progressSchema.parse(body)); return reply({ ok: true });
      case "finish": return reply(await finishWithoutCredits(admin, owner));
      case "product-lookup": {
        const { lookupResultSchema } = await import("@/features/product-links/browser-lookup");
        const { finishProductLookup } = await import("@/features/product-links/service");
        return reply(await finishProductLookup(admin, owner, lookupResultSchema.parse(body)));
      }
      default: return reply({ error: "not_found" }, 404);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (KNOWN.has(code)) return reply({ error: code }, 409);
    if (error && typeof error === "object" && "issues" in error) return reply({ error: "invalid_request" }, 400);
    return reply({ error: "server_error" }, 500);
  }
}
