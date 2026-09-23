export type OpsSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type OpsErrorCategory = "AUTH" | "BUDGET" | "PROVIDER" | "PUBLISH" | "DATABASE" | "RECOVERY" | "WEBHOOK" | "UNKNOWN";

export interface OpsLogRecord {
  severity: OpsSeverity;
  component: string;
  operation: string;
  owner_id?: string | null;
  account_id?: string | null;
  run_id?: string | null;
  job_id?: string | null;
  publish_id?: string | null;
  provider_job_id?: string | null;
  correlation_id?: string | null;
  from_state?: string | null;
  to_state?: string | null;
  error_category?: OpsErrorCategory | null;
  error_code?: string | null;
}

const safeIdentifier = (value: string | null | undefined) => {
  if (!value) return null;
  if (/(sb_secret_|sk-|fal_|bearer|client_secret|access_token|refresh_token|api_key|cookie)/i.test(value)) return "[REDACTED]";
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(value) || /^[A-Za-z0-9_-]{64,}$/.test(value)) return "[REDACTED]";
  return /^[a-zA-Z0-9_:\/.\-]{1,200}$/.test(value) ? value : "[REDACTED]";
};

export function redactOpsText(value: unknown, secrets: readonly string[] = []) {
  let text = String(value ?? "").slice(0, 500);
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, "$1[REDACTED]")
    .replace(/eyJ[a-z0-9_-]+\.eyJ[a-z0-9_-]+\.[a-z0-9_-]+/gi, "[REDACTED]")
    .replace(/(sb_secret_|sk-|fal_)[a-z0-9_-]{8,}/gi, "[REDACTED]")
    .replace(/(authorization|cookie|client_secret|access_token|refresh_token|api_key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

export function makeOpsLog(record: OpsLogRecord) {
  return {
    timestamp: new Date().toISOString(),
    severity: record.severity,
    component: safeIdentifier(record.component),
    operation: safeIdentifier(record.operation),
    owner_id: safeIdentifier(record.owner_id),
    account_id: safeIdentifier(record.account_id),
    run_id: safeIdentifier(record.run_id),
    job_id: safeIdentifier(record.job_id),
    publish_id: safeIdentifier(record.publish_id),
    provider_job_id: safeIdentifier(record.provider_job_id),
    correlation_id: safeIdentifier(record.correlation_id),
    state_transition: record.from_state || record.to_state
      ? { from: safeIdentifier(record.from_state), to: safeIdentifier(record.to_state) } : null,
    error_category: record.error_category ?? null,
    error_code: safeIdentifier(record.error_code),
  };
}

export function logOps(record: OpsLogRecord) {
  const line = JSON.stringify(makeOpsLog(record));
  if (record.severity === "ERROR") console.error(line);
  else if (record.severity === "WARN") console.warn(line);
  else console.info(line);
}
