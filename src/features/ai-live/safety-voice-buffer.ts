import type { VoiceProvider } from "./live-pipeline";
import { liveDeadline } from "./live-timeout";
import { authorizeSpeech, SpeechComplianceError, type SpeechCompliancePort } from "./compliance-speech";

export const SAFETY_VOICE_CATEGORIES = [
  "PRODUCT_INTRO", "FEATURES", "CTA", "FAQ", "FILLER", "ENGAGEMENT", "TRANSITION",
] as const;
export type SafetyVoiceCategory = typeof SAFETY_VOICE_CATEGORIES[number];

export interface PreparedSafetyVoice {
  id: string;
  category: SafetyVoiceCategory;
  productId: string | null;
  /** Audio has already been recorded or synthesized by a real voice adapter. */
  provenance: "RECORDED" | "SYNTHESIZED";
  pcm16: Uint8Array;
  sampleRate: 16_000;
  channels: 1;
  /** Validated transcript of these exact recorded/synthesized samples. Missing means no playback. */
  transcript?: string;
}

export interface SafetyVoiceBufferMetrics {
  remainingSeconds: number;
  fallbackActivations: number;
  consumedSeconds: number;
  deadAirMs: number;
  preparedClips: number;
}

/** Per-room, bounded real PCM storage. This class never synthesizes audio or loops filler indefinitely. */
export class SafetyVoiceBuffer {
  private clips: Array<PreparedSafetyVoice & { offset: number }> = [];
  private activations = 0;
  private consumedBytes = 0;
  private deadAirStartedAt: number | null = null;
  private deadAirTotalMs = 0;
  private readonly maxBytes: number;

  constructor(private readonly options: { maxSeconds?: number; now?: () => number;
    compliance?: SpeechCompliancePort; complianceTimeoutMs?: number } = {}) {
    const maxSeconds = options.maxSeconds ?? 120;
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 600) throw new Error("invalid_safety_voice_capacity");
    this.maxBytes = Math.floor(maxSeconds * 32_000);
  }

  prepare(clip: PreparedSafetyVoice): void {
    if (!clip.id || clip.id.length > 160 || !SAFETY_VOICE_CATEGORIES.includes(clip.category)
      || !["RECORDED", "SYNTHESIZED"].includes(clip.provenance)
      || clip.sampleRate !== 16_000 || clip.channels !== 1
      || !(clip.pcm16 instanceof Uint8Array) || clip.pcm16.byteLength < 2 || clip.pcm16.byteLength % 2
      || !clip.pcm16.some((byte) => byte !== 0)) throw new Error("invalid_safety_voice_pcm");
    if (this.clips.some((item) => item.id === clip.id)) throw new Error("duplicate_safety_voice_clip");
    if (this.clips.reduce((sum, item) => sum + item.pcm16.length, 0) + clip.pcm16.length > this.maxBytes) {
      throw new Error("safety_voice_capacity_exceeded");
    }
    this.clips.push({ ...clip, pcm16: clip.pcm16.slice(), offset: 0 });
  }

  /** Prewarm from the same real streaming voice adapter used for interactive speech. */
  async prepareFromVoice(inputs: Array<{ id: string; text: string; category: SafetyVoiceCategory; productId: string | null }>,
    voice: VoiceProvider, options: { signal: AbortSignal; timeoutMs?: number; maxClipSeconds?: number }): Promise<number> {
    if (inputs.length > SAFETY_VOICE_CATEGORIES.length || new Set(inputs.map((input) => input.category)).size !== inputs.length) throw new Error("invalid_safety_voice_preparation");
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxClipBytes = Math.min(this.maxBytes, Math.floor((options.maxClipSeconds ?? 20) * 32_000));
    let prepared = 0;
    for (const input of inputs) {
      if (!input.text.trim() || input.text.length > 1_000 || options.signal.aborted) throw new Error("invalid_safety_voice_preparation");
      const safeText = await authorizeSpeech(this.options.compliance, input.text, options.signal,
        this.options.complianceTimeoutMs ?? 1_000);
      const iterator = voice.streamText(safeText, input.id, options.signal)[Symbol.asyncIterator]();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const result = await liveDeadline(iterator.next(), timeoutMs, options.signal);
          if (result.done) break;
          if (!(result.value instanceof Uint8Array) || result.value.length % 2) throw new Error("invalid_safety_voice_pcm");
          bytes += result.value.length;
          if (bytes > maxClipBytes) throw new Error("safety_voice_capacity_exceeded");
          chunks.push(result.value.slice());
        }
        const pcm16 = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { pcm16.set(chunk, offset); offset += chunk.length; }
        this.prepare({ ...input, transcript: safeText, pcm16, sampleRate: 16_000, channels: 1, provenance: "SYNTHESIZED" });
        prepared += 1;
      } catch (error) {
        await liveDeadline(voice.cancel(input.id), timeoutMs);
        throw error;
      } finally {
        if (iterator.return) await liveDeadline(iterator.return(), timeoutMs).catch(() => undefined);
      }
    }
    return prepared;
  }

  activate(): void { this.activations += 1; }

  async take(category: SafetyVoiceCategory, productId: string | null, maxSeconds = 0.5,
    signal?: AbortSignal): Promise<Uint8Array | null> {
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 5) throw new Error("invalid_safety_voice_chunk_duration");
    // Never speak a prepared claim for a different product. Generic recordings have no product ID.
    const clip = this.clips.find((item) => item.category === category && (item.productId === null || item.productId === productId))
      ?? this.clips.find((item) => item.category === "FILLER" && item.productId === null);
    if (!clip) return null;
    // Old PCM-only clips are deliberately unusable. A policy change or missing
    // authority cannot disable the shield just because audio was cached earlier.
    if (!clip.transcript) throw new SpeechComplianceError();
    await authorizeSpeech(this.options.compliance, clip.transcript, signal,
      this.options.complianceTimeoutMs ?? 1_000, true);
    if (!this.clips.includes(clip)) return null; // cleared while the authority was checking
    const bytes = Math.max(2, Math.floor(maxSeconds * 16_000) * 2);
    const end = Math.min(clip.offset + bytes, clip.pcm16.length);
    const result = clip.pcm16.slice(clip.offset, end);
    clip.offset = end;
    this.consumedBytes += result.length;
    if (end === clip.pcm16.length) this.clips.splice(this.clips.indexOf(clip), 1);
    return result;
  }

  markWaiting(): void {
    this.deadAirStartedAt ??= (this.options.now ?? Date.now)();
  }

  markAudio(): void {
    if (this.deadAirStartedAt === null) return;
    this.deadAirTotalMs += Math.max(0, (this.options.now ?? Date.now)() - this.deadAirStartedAt);
    this.deadAirStartedAt = null;
  }

  metrics(): SafetyVoiceBufferMetrics {
    return {
      remainingSeconds: this.clips.reduce((sum, clip) => sum + clip.pcm16.length - clip.offset, 0) / 32_000,
      consumedSeconds: this.consumedBytes / 32_000,
      fallbackActivations: this.activations,
      deadAirMs: this.deadAirTotalMs + (this.deadAirStartedAt === null ? 0 : Math.max(0, (this.options.now ?? Date.now)() - this.deadAirStartedAt)),
      preparedClips: this.clips.length,
    };
  }

  clear(): void {
    for (const clip of this.clips) clip.pcm16.fill(0);
    this.clips = [];
    this.markAudio();
  }
}
