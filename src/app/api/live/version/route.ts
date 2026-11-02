import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { liveVersion } from "@/features/flow-farm/live-version";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fingerprint of the owner's clip data; open pages poll it and re-render only when it changes. */
export async function GET() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  let admin = null;
  try { admin = createAdminClient(); } catch { /* login states are optional in the fingerprint */ }
  try {
    return Response.json({ version: await liveVersion(client, admin, data.user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
