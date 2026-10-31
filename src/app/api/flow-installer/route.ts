import { buildInstaller, installerSources, zipOne } from "@/features/flow-farm/installer";
import { issueWorkerToken } from "@/features/flow-farm/worker-auth";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The /post page's download button: a zipped one-file Windows installer that runs the Flow worker for the signed-in
 * account. Each download issues a new computer token, so the previous install of this account stops working.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return Response.json({}, { status: 403 });
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) return Response.redirect(`${origin}/login?next=/post`, 303);
  await enforceOwnerMutationRateLimit("flow-installer", data.user.id);
  const [sources, token] = await Promise.all([installerSources(), issueWorkerToken(createAdminClient(), data.user.id)]);
  const body = zipOne("ViralFlow-Setup.cmd", buildInstaller({ portal: origin, token, ...sources }));
  return new Response(new Uint8Array(body), { headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="ViralFlow-Setup.zip"',
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
