import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeFlowWorker } from "@/features/flow-farm/worker-auth";
import { commandsAfter, reportSchema, snapshotSchema } from "@/features/praew-live/contract";
import { overlayToken } from "@/features/live-overlay/model";
import { ownOverlay } from "@/features/live-overlay/service";
import { productFeed, readDesired, saveReport, saveSnapshot } from "@/features/praew-live/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

/**
 * The live bridge on the owner's PC (same computer token as the Flow worker).
 * GET poll?after=N → settings + commands with id > N + the products Praew presents (empty while "พูดถึงสินค้า" is off).
 * GET overlay → the OBS Browser Source link of the live overlay.
 * POST report / snapshot → what the show is doing.
 */
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const auth = await authorizeFlowWorker(request);
  if (!auth.ok) return reply({ error: "unauthorized" }, auth.status);
  const action = (await context.params).action;
  // The OBS setup script on the PC asks for the overlay's Browser Source link (it holds the overlay secret).
  if (action === "overlay") {
    const overlay = await ownOverlay(createAdminClient(), auth.owner);
    return reply({ url: `${new URL(request.url).origin}/live-overlay?k=${overlayToken(auth.owner, overlay.secret)}`, width: 720, height: 1280 });
  }
  if (action !== "poll") return reply({ error: "not_found" }, 404);
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const admin = createAdminClient();
  const desired = await readDesired(admin, auth.owner);
  const products = desired.settings.products ? await productFeed(admin, auth.owner) : [];
  return reply({ seq: desired.seq, settings: desired.settings, commands: commandsAfter(desired, Number.isFinite(after) ? after : 0), products });
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const auth = await authorizeFlowWorker(request);
  if (!auth.ok) return reply({ error: "unauthorized" }, auth.status);
  const { action } = await context.params;
  let body: unknown = {};
  try { body = await request.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const admin = createAdminClient();
  try {
    if (action === "report") {
      const parsed = reportSchema.safeParse(body);
      if (!parsed.success) return reply({ error: "invalid_report", issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join(".")}: ${i.message}`) }, 400);
      await saveReport(admin, auth.owner, { ...parsed.data, receivedAt: new Date().toISOString() });
      return reply({ ok: true });
    }
    if (action === "snapshot") {
      const parsed = snapshotSchema.safeParse(body);
      if (!parsed.success) return reply({ error: "invalid_snapshot" }, 400);
      await saveSnapshot(admin, auth.owner, parsed.data.jpeg);
      return reply({ ok: true });
    }
    return reply({ error: "not_found" }, 404);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "failed" }, 500);
  }
}
