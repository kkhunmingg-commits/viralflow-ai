import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runRecoveryCycle } from "@/features/operations/recovery";
import { logOps } from "@/lib/ops/logger";
import { serverEnv } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export function authorizedRecoveryToken(header: string | null, expected: string | undefined) {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const secret = Buffer.from(expected);
  return provided.length === secret.length && timingSafeEqual(provided, secret);
}

export async function POST(request: Request) {
  if (!authorizedRecoveryToken(request.headers.get("authorization"), serverEnv.opsRecoveryToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runRecoveryCycle(createAdminClient());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    logOps({ severity: "ERROR", component: "operations", operation: "recovery_route", error_category: "RECOVERY", error_code: "RECOVERY_ROUTE_FAILED" });
    return NextResponse.json({ error: "recovery_unavailable" }, { status: 503 });
  }
}
