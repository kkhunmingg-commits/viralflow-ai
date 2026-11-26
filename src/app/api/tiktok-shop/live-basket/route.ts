import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { liveBasket } from "@/features/tiktok-shop/catalog";
import { PIN_EVERY_SECONDS } from "@/features/tiktok-shop/items";

/**
 * The ViralFlow Chrome extension asks here, from TikTok Shop's LIVE Manager tab in the owner's Chrome, which products
 * belong in the live basket (the owner's TikTok picks that are switched on) and how often to pin the next one.
 * The extension adds missing ones to the LIVE product list and pins them in turn; Praew presents what is pinned.
 * Same guard as /api/social-post/browser: only the extension (its own header) or ViralFlow's own pages.
 */
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("x-viralflow-extension") !== "1"
    || (origin && origin !== new URL(request.url).origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))) {
    return NextResponse.json({ ok: false }, { status: 403, headers: noStore });
  }
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return NextResponse.json({ ok: false, signedIn: false }, { status: 401, headers: noStore });
  try {
    const products = await liveBasket(client, data.user.id);
    return NextResponse.json({ ok: true, signedIn: true, pinEverySec: PIN_EVERY_SECONDS, products }, { headers: noStore });
  } catch (cause) {
    console.error("[tiktok-shop/live-basket] failed", cause);
    return NextResponse.json({ ok: false, signedIn: true, products: [] }, { status: 500, headers: noStore });
  }
}
