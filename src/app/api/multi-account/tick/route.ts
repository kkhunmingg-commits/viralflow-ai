import { NextResponse } from "next/server";
import { authorizedSchedulerToken } from "@/features/operations/scheduler";
import { tickMultiAccount } from "@/features/multi-account/service";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
/** Called by an independent pooled worker host, never by Dashboard polling. No Cron configuration change. */
export async function POST(request: Request) {
  if (process.env.MULTI_ACCOUNT_WORKER_ENABLED !== "true") return NextResponse.json({ disabled: true }, { status: 503 });
  if (!authorizedSchedulerToken(request.headers.get("authorization"), process.env.MULTI_ACCOUNT_WORKER_TOKEN)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json(await tickMultiAccount(createAdminClient()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "worker_unavailable" }, { status: 503 }); }
}
