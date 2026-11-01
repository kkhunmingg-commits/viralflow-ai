import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { liveClipProgress } from "@/features/flow-farm/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today's clips for one TikTok account plus what the owner's computer is doing now; the /post page polls it. */
export async function GET(request: Request) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const account = new URL(request.url).searchParams.get("account");
  if (!z.uuid().safeParse(account).success) return Response.json({ error: "invalid_account" }, { status: 400 });
  try {
    return Response.json(await liveClipProgress(client, data.user.id, account!), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
