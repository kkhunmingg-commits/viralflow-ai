import "server-only";
import { logOps } from "@/lib/ops/logger";
import { serverEnv } from "@/lib/server-env";

export async function deliverRecoveryAlert(input: { windowKey: string; incidents: number; alerts: number }, fetcher: typeof fetch = fetch) {
  if (!serverEnv.opsAlertWebhookUrl || input.alerts === 0) return "SKIPPED" as const;
  try {
    const response = await fetcher(serverEnv.opsAlertWebhookUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        ...(serverEnv.opsAlertWebhookToken ? { Authorization: `Bearer ${serverEnv.opsAlertWebhookToken}` } : {}),
      },
      body: JSON.stringify({ event: "viralflow.recovery.alerts", windowKey: input.windowKey, incidents: input.incidents, alerts: input.alerts }),
    });
    if (!response.ok) throw new Error("alert_delivery_rejected");
    return "DELIVERED" as const;
  } catch {
    logOps({ severity: "WARN", component: "operations", operation: "alert_delivery", correlation_id: input.windowKey, error_category: "RECOVERY", error_code: "ALERT_DELIVERY_FAILED" });
    return "FAILED" as const;
  }
}
