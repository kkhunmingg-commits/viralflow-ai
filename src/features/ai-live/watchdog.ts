export type WatchdogIssue = "SESSION_STALE" | "PRESENTER_STALE" | "AUDIO_STUCK" | "COMMENTS_STUCK" | "STREAM_DISCONNECTED";

export interface WatchdogProbe {
  nowMs: number;
  sessionHeartbeatAt: number;
  presenterHeartbeatAt: number;
  oldestAudioQueuedAt: number | null;
  oldestCommentQueuedAt: number | null;
  streamConnected: boolean;
}

export interface WatchdogLimits {
  heartbeatMs: number;
  queueMs: number;
  maxRecoveryAttempts: number;
}

export const DEFAULT_WATCHDOG_LIMITS: WatchdogLimits = {
  heartbeatMs: 15_000,
  queueMs: 10_000,
  maxRecoveryAttempts: 2,
};

export function inspectWatchdog(probe: WatchdogProbe, limits = DEFAULT_WATCHDOG_LIMITS): WatchdogIssue[] {
  const issues: WatchdogIssue[] = [];
  if (probe.nowMs - probe.sessionHeartbeatAt > limits.heartbeatMs) issues.push("SESSION_STALE");
  if (probe.nowMs - probe.presenterHeartbeatAt > limits.heartbeatMs) issues.push("PRESENTER_STALE");
  if (probe.oldestAudioQueuedAt !== null && probe.nowMs - probe.oldestAudioQueuedAt > limits.queueMs) issues.push("AUDIO_STUCK");
  if (probe.oldestCommentQueuedAt !== null && probe.nowMs - probe.oldestCommentQueuedAt > limits.queueMs) issues.push("COMMENTS_STUCK");
  if (!probe.streamConnected) issues.push("STREAM_DISCONNECTED");
  return issues;
}

export function recoveryDisposition(attempts: number, limits = DEFAULT_WATCHDOG_LIMITS): "RETRY_ALLOWED" | "STOP_REQUIRED" {
  return attempts < limits.maxRecoveryAttempts ? "RETRY_ALLOWED" : "STOP_REQUIRED";
}
