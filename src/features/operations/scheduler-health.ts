type Run = { state: string; started_at: string; completed_at: string | null; summary_json?: { incidents?: number; alerts?: number } | null } | null;

export function summarizeSchedulerHealth(latest: Run, lastSuccess: Run, lastFailure: Run, now = new Date()) {
  const successAt = lastSuccess?.completed_at ?? null;
  const ageMinutes = successAt ? Math.floor((now.getTime() - Date.parse(successAt)) / 60_000) : null;
  const failedAfterSuccess = Boolean(lastFailure && (!successAt || Date.parse(lastFailure.started_at) > Date.parse(successAt)));
  return {
    status: latest?.state ?? "NOT_STARTED",
    last_started_at: latest?.started_at ?? null,
    last_success_at: successAt,
    last_failure_at: lastFailure?.completed_at ?? lastFailure?.started_at ?? null,
    age_minutes: ageMinutes,
    healthy: ageMinutes !== null && ageMinutes <= 15 && !failedAfterSuccess,
    recovery_count: Number(lastSuccess?.summary_json?.incidents ?? 0),
    alert_count: Number(lastSuccess?.summary_json?.alerts ?? 0),
  };
}
