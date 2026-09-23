import { NextResponse } from "next/server";
import { authorizedSchedulerToken } from "@/features/operations/scheduler";
import { runPendingAutoExecution } from "@/features/auto/execution-service";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

async function invoke(request: Request, expectedSecret: string | undefined) {
  if (!serverEnv.recoveryEnabled) return NextResponse.json({ error: "scheduler_disabled" }, { status: 503 });
  if (!authorizedSchedulerToken(request.headers.get("authorization"), expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runPendingAutoExecution(createAdminClient());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "auto_execution_unavailable" }, { status: 503 });
  }
}

export async function GET(request: Request) { return invoke(request, serverEnv.cronSecret); }
export async function POST(request: Request) { return invoke(request, serverEnv.opsRecoveryToken); }
