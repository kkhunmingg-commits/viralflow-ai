import { NextResponse } from "next/server";
import { runRecoveryCycle } from "@/features/operations/recovery";
import { deliverRecoveryAlert } from "@/features/operations/alert-delivery";
import { authorizedSchedulerToken, executeSchedulerInvocation } from "@/features/operations/scheduler";
import { logOps } from "@/lib/ops/logger";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export const authorizedRecoveryToken = authorizedSchedulerToken;

async function invoke(request: Request, expectedSecret: string | undefined) {
  const result = await executeSchedulerInvocation({
    authorization: request.headers.get("authorization"), expectedSecret,
    enabled: serverEnv.recoveryEnabled,
    run: () => runRecoveryCycle(createAdminClient()),
    notify: deliverRecoveryAlert,
  });
  if (result.status === 503 && "error" in result.body && result.body.error === "recovery_unavailable") {
    logOps({ severity: "ERROR", component: "operations", operation: "recovery_route", error_category: "RECOVERY", error_code: "RECOVERY_ROUTE_FAILED" });
  }
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return invoke(request, serverEnv.cronSecret);
}

export async function POST(request: Request) {
  return invoke(request, serverEnv.opsRecoveryToken);
}
