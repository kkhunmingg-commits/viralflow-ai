import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { configSchema, overlayToken } from "@/features/live-overlay/model";
import { overlayProducts, overlayUploadUrl, ownOverlay, saveOverlay } from "@/features/live-overlay/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function signedIn() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  return data.user ? { client, owner: data.user.id } : null;
}
const obsUrl = (request: Request, owner: string, secret: string) =>
  `${new URL(request.url).origin}/live-overlay?k=${overlayToken(owner, secret)}`;

/** The AI LIVE page's overlay editor: the saved layout, the OBS link and the live products. */
export async function GET(request: Request) {
  const who = await signedIn();
  if (!who) return reply({ error: "unauthorized" }, 401);
  const [stored, products] = await Promise.all([
    ownOverlay(createAdminClient(), who.owner),
    overlayProducts(who.client, who.owner).catch(() => []),
  ]);
  const { secret, updatedAt, ...config } = stored;
  return reply({ config, updatedAt, obsUrl: obsUrl(request, who.owner, secret), products });
}

const saveBody = z.object({ config: configSchema, rotate: z.boolean().optional() });
export async function PUT(request: Request) {
  const who = await signedIn();
  if (!who) return reply({ error: "unauthorized" }, 401);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return reply({ error: "json_only" }, 415);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const parsed = saveBody.safeParse(body);
  if (!parsed.success) return reply({ error: "invalid_config", issues: parsed.error.issues.slice(0, 3) }, 400);
  try {
    const saved = await saveOverlay(createAdminClient(), who.owner, parsed.data.config, parsed.data.rotate);
    return reply({ ok: true, updatedAt: saved.updatedAt, obsUrl: obsUrl(request, who.owner, saved.secret) });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "failed" }, 500);
  }
}

/** A signed upload address for one picture. */
export async function POST(request: Request) {
  const who = await signedIn();
  if (!who) return reply({ error: "unauthorized" }, 401);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return reply({ error: "json_only" }, 415);
  const parsed = z.object({ type: z.enum(["image/png", "image/jpeg"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "invalid_type" }, 400);
  try {
    return reply(await overlayUploadUrl(createAdminClient(), who.owner, parsed.data.type));
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "failed" }, 500);
  }
}
