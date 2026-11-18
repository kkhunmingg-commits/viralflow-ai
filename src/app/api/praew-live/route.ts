import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { commandSchema, isOnline } from "@/features/praew-live/contract";
import { pushCommand, readDesired, readReport, readSnapshot } from "@/features/praew-live/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function signedIn() {
  const { data } = await (await createClient()).auth.getUser();
  return data.user?.id ?? null;
}

/** The AI LIVE page polls this for what Praew's show on the owner's PC is doing. */
export async function GET(request: Request) {
  const owner = await signedIn();
  if (!owner) return reply({ error: "unauthorized" }, 401);
  const admin = createAdminClient();
  const wantPicture = new URL(request.url).searchParams.get("picture") !== "0";
  const [report, desired, snapshot] = await Promise.all([
    readReport(admin, owner), readDesired(admin, owner), wantPicture ? readSnapshot(admin, owner) : Promise.resolve(null),
  ]);
  const pending = desired.commands.filter(c => c.id > (report?.lastCommandId ?? 0)).length;
  return reply({ online: isOnline(report), report, settings: desired.settings, pending, snapshot });
}

/** A button on the page: stored for the PC bridge to pick up on its next poll. */
export async function POST(request: Request) {
  const owner = await signedIn();
  if (!owner) return reply({ error: "unauthorized" }, 401);
  // Same-site only: the page posts JSON, a form on another site cannot.
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return reply({ error: "json_only" }, 415);
  let body: unknown;
  try { body = await request.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) return reply({ error: "invalid_command" }, 400);
  try {
    const desired = await pushCommand(createAdminClient(), owner, parsed.data);
    return reply({ ok: true, id: desired.seq, settings: desired.settings });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "failed" }, 500);
  }
}
