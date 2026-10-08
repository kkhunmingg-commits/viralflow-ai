import type { LiveIntent } from "./domain";
import type { PresenterAudioPort, VoiceProvider } from "./live-pipeline";
import { SafetyVoiceBuffer, type SafetyVoiceCategory } from "./safety-voice-buffer";
import { liveDeadline, liveWaitTick } from "./live-timeout";
import { authorizeSpeech, SpeechComplianceError, type SpeechCompliancePort } from "./compliance-speech";

export const LIVE_SPEECH_PRIORITY = { SAFETY: 100, PRODUCT_QUESTION: 80, PURCHASE: 70, GREETING: 50, GENERAL: 30, FILLER: 10 } as const;
export type LiveSpeechSource = "COMMENT" | "SCRIPT" | "MANUAL";
export interface LiveSpeechRequest {
  id: string;
  text: string;
  priority: number;
  source: LiveSpeechSource;
  productId: string | null;
  intent: LiveIntent | "SAFETY" | "FILLER";
}
export interface SpeechGesturePort {
  onIntent(input: { intent: LiveSpeechRequest["intent"]; source: LiveSpeechSource; emphasis: boolean }): Promise<void>;
  neutral(): Promise<void>;
}
export interface SpeechRunResult {
  status: "IDLE" | "COMPLETE" | "INTERRUPTED" | "BUFFERED";
  audioChunks: number;
  requestId?: string;
}
interface PendingSpeech extends LiveSpeechRequest {
  segments: string[];
  segment: number;
  sequence: number;
  prepared: { chunks: Uint8Array[]; cursor: number } | null;
}

function sentenceSegments(text: string): string[] {
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]*|[.!?。！？\n]+/gu)?.map((value) => value.trim()).filter(Boolean) ?? [text];
  return sentences.flatMap((sentence) => sentence.match(/.{1,240}/gu) ?? []);
}

/** One audio lease per room. Script audio uses bounded sentence prefetch and resumes at its exact PCM chunk cursor. */
export class LiveSpeechScheduler {
  private queue: PendingSpeech[] = [];
  private seen = new Map<string, number>();
  private sequence = 0;
  private active: { request: PendingSpeech; abort: AbortController; utteranceId: string } | null = null;
  private paused = false;
  private interruptions = 0;
  private interruption: Promise<void> | null = null;
  private safetyPlaying = false;
  private safetyAbort: AbortController | null = null;
  private audioBoundaryFailed = false;
  private outputSettled: Promise<void> | null = null;
  private outputGeneration = 0;

  constructor(private readonly deps: {
    voice: VoiceProvider;
    presenterAudio: PresenterAudioPort;
    buffer?: SafetyVoiceBuffer;
    gestures?: SpeechGesturePort;
    maxQueue?: number;
    timeoutMs?: number;
    now?: () => number;
    compliance?: SpeechCompliancePort;
    complianceTimeoutMs?: number;
  }) {}

  get busy(): boolean { return this.active !== null || this.safetyPlaying; }
  get size(): number { return this.queue.length; }
  get priority(): number | null { return this.active?.request.priority ?? null; }
  metrics() { return { queued: this.queue.length, active: this.busy, paused: this.paused, interruptions: this.interruptions }; }

  enqueue(request: LiveSpeechRequest): boolean {
    const now = (this.deps.now ?? Date.now)();
    for (const [id, at] of this.seen) if (now - at > 3_600_000) this.seen.delete(id);
    if (!request.id || request.id.length > 256 || !request.text.trim() || request.text.length > 4_000
      || !Number.isFinite(request.priority) || request.priority < 0 || request.priority > 100
      || this.seen.has(request.id) || this.queue.length >= (this.deps.maxQueue ?? 64)) return false;
    this.queue.push({ ...request, segments: request.source === "SCRIPT" ? sentenceSegments(request.text) : [request.text], segment: 0, sequence: this.sequence++, prepared: null });
    this.seen.set(request.id, now);
    while (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }

  async preempt(priority: number): Promise<boolean> {
    if (!this.active || priority <= this.active.request.priority) return false;
    await this.interrupt();
    return true;
  }

  async pause(): Promise<void> { this.paused = true; await this.interrupt(); }
  resume(): void { this.paused = false; }
  async stop(): Promise<void> { this.paused = true; this.queue = []; await this.interrupt(false); this.queue = []; }

  /** Only the owner controller calls this after the runtime acknowledged idempotent resource release. */
  confirmStopped(): void {
    this.active?.abort.abort();
    this.safetyAbort?.abort();
    this.active = null;
    this.queue = [];
    this.audioBoundaryFailed = false;
    this.outputGeneration += 1;
  }

  async interrupt(resumeScript = true): Promise<void> {
    if (this.interruption) return this.interruption;
    this.safetyAbort?.abort();
    const active = this.active;
    if (!active) { if (this.outputSettled) await this.outputSettled; return; }
    active.abort.abort();
    this.interruptions += 1;
    if (!resumeScript) active.request.source = "COMMENT";
    this.interruption = (async () => {
      // A cancellation acknowledgement is required before acquiring the next voice lease.
      await liveDeadline(this.deps.voice.interrupt(), this.deps.timeoutMs ?? 10_000);
      await liveDeadline(this.deps.voice.cancel(active.utteranceId), this.deps.timeoutMs ?? 10_000);
      if (this.outputSettled) await this.outputSettled;
      if (this.deps.gestures) await liveDeadline(this.deps.gestures.neutral(), this.deps.timeoutMs ?? 10_000);
    })();
    try { await this.interruption; } finally { this.interruption = null; }
  }

  async playSafety(sessionId: string, productId: string | null, category: SafetyVoiceCategory = "FILLER", continuation = false): Promise<SpeechRunResult> {
    if (this.audioBoundaryFailed) throw new Error("presenter_audio_recovery_required");
    if (this.busy || this.paused || !this.deps.buffer) return { status: "IDLE", audioChunks: 0 };
    this.safetyPlaying = true;
    const abort = new AbortController();
    this.safetyAbort = abort;
    try {
      const chunk = await this.deps.buffer.take(category, productId, 0.5, abort.signal);
      if (!chunk) { this.deps.buffer.markWaiting(); return { status: "IDLE", audioChunks: 0 }; }
      if (!continuation) this.deps.buffer.activate();
      await this.pushAudio(sessionId, chunk, undefined, abort.signal);
      this.deps.buffer.markAudio();
      return { status: "BUFFERED", audioChunks: 1 };
    } finally { this.safetyPlaying = false; if (this.safetyAbort === abort) this.safetyAbort = null; }
  }

  async runNext(sessionId: string): Promise<SpeechRunResult> {
    if (this.audioBoundaryFailed) throw new Error("presenter_audio_recovery_required");
    if (this.busy || this.paused || !this.queue.length) return { status: "IDLE", audioChunks: 0 };
    await this.interruption;
    // The running lease may have changed while waiting for a cancellation acknowledgement.
    if (this.busy || this.paused) return { status: "IDLE", audioChunks: 0 };
    this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    const request = this.queue.shift()!;
    const abort = new AbortController();
    const active = { request, abort, utteranceId: `${request.id}:segment:${request.segment}` };
    this.active = active;
    let audioChunks = 0;
    let buffered = false;
    this.deps.buffer?.markWaiting();
    try {
      // Check the complete utterance before splitting it; a sentence fragment must
      // never lose the unsafe claim's condition/context. Recheck resumed scripts.
      const authorized = await authorizeSpeech(this.deps.compliance, request.text, abort.signal,
        this.deps.complianceTimeoutMs ?? 1_000);
      if (authorized !== request.text) {
        if (request.segment > 0 || request.prepared) throw new SpeechComplianceError();
        request.text = authorized;
        request.segments = request.source === "SCRIPT" ? sentenceSegments(authorized) : [authorized];
      }
      if (this.deps.gestures) await liveDeadline(this.deps.gestures.onIntent({ intent: request.intent, source: request.source, emphasis: /[!！]/u.test(request.text) }), this.deps.timeoutMs ?? 10_000, abort.signal);
      while (request.segment < request.segments.length && !abort.signal.aborted) {
        active.utteranceId = `${request.id}:segment:${request.segment}`;
        let complete = false;
        if (request.source === "SCRIPT") {
          if (!request.prepared) {
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            await authorizeSpeech(this.deps.compliance, request.text, abort.signal,
              this.deps.complianceTimeoutMs ?? 1_000, true);
            const iterator = this.deps.voice.streamText(request.segments[request.segment], active.utteranceId, abort.signal)[Symbol.asyncIterator]();
            try {
              while (!abort.signal.aborted) {
                const read = await this.nextVoiceChunk(iterator, abort.signal, sessionId, request.productId);
                const next = read.result;
                audioChunks += read.backupChunks;
                if (next.done) break;
                bytes += next.value.length;
                if (bytes > 640_000) throw new Error("speech_sentence_capacity_exceeded");
                chunks.push(next.value.slice());
              }
              if (!abort.signal.aborted) request.prepared = { chunks, cursor: 0 };
            } finally {
              if (iterator.return) await liveDeadline(iterator.return(), this.deps.timeoutMs ?? 10_000).catch(() => undefined);
            }
          }
          const prepared = request.prepared;
          if (prepared) {
            while (prepared.cursor < prepared.chunks.length && !abort.signal.aborted) {
              const chunk = prepared.chunks[prepared.cursor++];
              await this.pushAudio(sessionId, chunk, request.text, abort.signal);
              this.deps.buffer?.markAudio();
              audioChunks += 1;
            }
            if (prepared.cursor === prepared.chunks.length) { request.prepared = null; complete = true; }
          }
        } else {
          await authorizeSpeech(this.deps.compliance, request.text, abort.signal,
            this.deps.complianceTimeoutMs ?? 1_000, true);
          const iterator = this.deps.voice.streamText(request.segments[request.segment], active.utteranceId, abort.signal)[Symbol.asyncIterator]();
          try {
            while (!abort.signal.aborted) {
              const read = await this.nextVoiceChunk(iterator, abort.signal, sessionId, request.productId);
              const next = read.result;
              audioChunks += read.backupChunks;
              if (next.done) { complete = true; break; }
              if (abort.signal.aborted) break;
              await this.pushAudio(sessionId, next.value, request.text, abort.signal);
              this.deps.buffer?.markAudio();
              audioChunks += 1;
            }
          } finally {
            if (iterator.return) await liveDeadline(iterator.return(), this.deps.timeoutMs ?? 10_000).catch(() => undefined);
          }
        }
        if (complete) request.segment += 1;
      }
    } catch (cause) {
      // A compliance refusal/unavailable authority is never replaced with an
      // unchecked filler clip. The same shield also guards prepared buffer PCM.
      if (cause instanceof SpeechComplianceError) {
        abort.abort();
        request.source = "COMMENT"; // do not endlessly resume a refused script
        await this.interrupt(false);
        throw cause;
      }
      if (!abort.signal.aborted) {
        if (this.audioBoundaryFailed) throw cause;
        // Never mix delayed TTS output with backup voice. Cancel it before forwarding the buffer.
        await this.interrupt();
        const fallback = await this.deps.buffer?.take("FILLER", request.productId);
        if (!fallback) throw cause;
        this.deps.buffer!.activate();
        await this.pushAudio(sessionId, fallback);
        this.deps.buffer!.markAudio();
        audioChunks += 1;
        buffered = true;
      }
    } finally {
      await this.interruption;
      if (abort.signal.aborted && request.source === "SCRIPT" && !buffered && request.segment < request.segments.length
        && this.queue.length < (this.deps.maxQueue ?? 64)) this.queue.push(request);
      if (this.active === active) this.active = null;
    }
    return { status: buffered ? "BUFFERED" : abort.signal.aborted ? "INTERRUPTED" : "COMPLETE", audioChunks, requestId: request.id };
  }

  private async pushAudio(sessionId: string, chunk: Uint8Array, text?: string, signal?: AbortSignal): Promise<void> {
    const generation = this.outputGeneration;
    if (text !== undefined) await authorizeSpeech(this.deps.compliance, text, signal,
      this.deps.complianceTimeoutMs ?? 1_000, true);
    if (signal?.aborted || this.paused || generation !== this.outputGeneration) throw new Error("speech_interrupted");
    const operation = liveDeadline(this.deps.presenterAudio.pushAudioChunk(sessionId, chunk), this.deps.timeoutMs ?? 10_000, undefined, "presenter_audio_timeout");
    this.outputSettled = operation;
    try {
      // A chunk acknowledgement must settle before another utterance can send. Unknown delivery fails closed.
      await operation;
    } catch (error) { if (generation === this.outputGeneration) this.audioBoundaryFailed = true; throw error; }
    finally { if (this.outputSettled === operation) this.outputSettled = null; }
  }

  private async nextVoiceChunk(iterator: AsyncIterator<Uint8Array>, signal: AbortSignal, sessionId: string, productId: string | null) {
    const next = liveDeadline(iterator.next(), this.deps.timeoutMs ?? 10_000, signal, "speech_service_timeout");
    if (!this.deps.buffer) return { result: await next, backupChunks: 0 };
    let backupChunks = 0;
    let activated = false;
    while (true) {
      const tick = await liveWaitTick(next, 500);
      if (tick.ready) return { result: tick.value, backupChunks };
      if (signal.aborted) throw new Error("speech_interrupted");
      const chunk = await this.deps.buffer.take("FILLER", productId, 0.5, signal);
      if (!chunk) continue; // The outer deadline still bounds an exhausted buffer; no silent loop/replay.
      if (!activated) { this.deps.buffer.activate(); activated = true; }
      await this.pushAudio(sessionId, chunk, undefined, signal);
      this.deps.buffer.markAudio();
      backupChunks += 1;
    }
  }
}
