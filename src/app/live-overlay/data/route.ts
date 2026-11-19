import { createAdminClient } from "@/lib/supabase/admin";
import { cachedOverlayProducts, overlayByToken } from "@/features/live-overlay/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

/** What the OBS overlay page polls: the saved layout and the live products. No sign-in; the link's secret is checked. */
export async function GET(request: Request) {
  const admin = createAdminClient();
  const found = await overlayByToken(admin, new URL(request.url).searchParams.get("k"));
  if (!found) return Response.json({ error: "not_found" }, { status: 404, headers });
  const { secret: _secret, updatedAt, ...config } = found.overlay;
  void _secret;
  const products = await cachedOverlayProducts(admin, found.owner);
  return Response.json({ config, updatedAt, products }, { headers });
}
