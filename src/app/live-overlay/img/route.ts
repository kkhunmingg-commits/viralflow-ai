import { createAdminClient } from "@/lib/supabase/admin";
import { overlayByToken, signedAsset } from "@/features/live-overlay/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An overlay picture for OBS (no sign-in; the link's secret is checked). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const admin = createAdminClient();
  const found = await overlayByToken(admin, params.get("k"));
  if (!found) return new Response("not found", { status: 404 });
  const url = await signedAsset(admin, found.owner, params.get("ref") ?? "");
  if (!url) return new Response("not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=3000", "Referrer-Policy": "no-referrer" } });
}
