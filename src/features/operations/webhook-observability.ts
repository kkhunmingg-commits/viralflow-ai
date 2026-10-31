import "server-only";
import { logOps } from "@/lib/ops/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export async function recordWebhookFailure(code: "INVALID_SIGNATURE" | "INVALID_BODY" | "PROCESSING_FAILED" | "RATE_LIMITED") {
  logOps({ severity: "WARN", component: "tiktok_webhook", operation: "receive", error_category: "WEBHOOK", error_code: code });
  try {
    const { error } = await createAdminClient().rpc("record_operations_webhook_failure", { p_reason_code: code });
    if (error) throw error;
  } catch {
    logOps({ severity: "ERROR", component: "tiktok_webhook", operation: "record_failure", error_category: "DATABASE", error_code: "WEBHOOK_METRIC_UNAVAILABLE" });
  }
}
