import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { signedAsset } from "@/features/live-overlay/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An overlay picture for the signed-in editor: a short redirect to a signed Storage address. */
export async function GET(request: Request) {
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return new Response("unauthorized", { status: 401 });
  const url = await signedAsset(createAdminClient(), data.user.id, new URL(request.url).searchParams.get("ref") ?? "");
  if (!url) return new Response("not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=3000" } });
}
