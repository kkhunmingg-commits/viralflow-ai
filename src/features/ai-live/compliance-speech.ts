import { liveDeadline } from "./live-timeout";

/** Delegates every decision to the shared POST/LIVE ComplianceEngine. No local rules live here. */
export interface SpeechCompliancePort {
  authorize(text: string, signal?: AbortSignal): Promise<{ allowed: boolean; text: string }>;
}

export class SpeechComplianceError extends Error {
  readonly code = "LIVE_COMPLIANCE_REQUIRED";
  constructor(readonly kind: "UNAVAILABLE" | "REFUSED" = "UNAVAILABLE") { super("live_compliance_required"); }
}

/** Missing, late or malformed decisions cannot acquire a voice/audio lease. */
export async function authorizeSpeech(port: SpeechCompliancePort | undefined, text: string,
  signal?: AbortSignal, timeoutMs = 1_000, requireUnchanged = false): Promise<string> {
  if (!port || signal?.aborted) throw new SpeechComplianceError();
  const operation = new AbortController(), cancel = () => operation.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  let result: Awaited<ReturnType<SpeechCompliancePort["authorize"]>>;
  try { result = await liveDeadline(port.authorize(text, operation.signal), timeoutMs, operation.signal, "live_compliance_timeout"); }
  catch { operation.abort(); throw new SpeechComplianceError(); }
  finally { signal?.removeEventListener("abort", cancel); }
  if (signal?.aborted) throw new SpeechComplianceError();
  if (result?.allowed === false) throw new SpeechComplianceError("REFUSED");
  if (!result || result.allowed !== true || typeof result.text !== "string" || !result.text.trim()
    || result.text.length > 4_000 || (requireUnchanged && result.text !== text)) throw new SpeechComplianceError();
  return result.text;
}
