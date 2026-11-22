import { createAdminClient } from "@/lib/supabase/admin";
import { cachedOverlayProducts, overlayByToken, saveOverlay } from "@/features/live-overlay/service";
import { autoPromoSet, needsFirstSet, wantsNewLook } from "@/features/live-overlay/themes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

/** What the OBS overlay page polls: the saved layout and the live products. No sign-in; the link's secret is checked. */
export async function GET(request: Request) {
  const admin = createAdminClient();
  const url = new URL(request.url);
  const found = await overlayByToken(admin, url.searchParams.get("k"));
  if (!found) return Response.json({ error: "not_found" }, { status: 404, headers });
  const { secret: _secret, updatedAt, ...config } = found.overlay;
  void _secret;
  const products = await cachedOverlayProducts(admin, found.owner);
  // OBS just opened for a new live (a new look each live is on by default) or nothing was ever arranged: make one
  // (never the last one) and keep it.
  const now = new Date();
  if ((url.searchParams.get("start") === "1" && wantsNewLook(config, now)) || needsFirstSet(config)) {
    try {
      const saved = await saveOverlay(admin, found.owner, autoPromoSet(config, products, Math.random, {}, now));
      const { secret: _s, updatedAt: at, ...fresh } = saved;
      void _s;
      return Response.json({ config: fresh, updatedAt: at, products }, { headers });
    } catch { /* keep the saved look if the new one cannot be stored */ }
  }
  return Response.json({ config, updatedAt, products }, { headers });
}
