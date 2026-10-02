export const DEV_AUDIO_RATE = 16_000;
export const DEV_AUDIO_CHUNK_SAMPLES = 8_000;

/** Validate uncompressed WAV before the browser allocates a decoded AudioBuffer. */
export function inspectDevPcmWave(bytes: ArrayBuffer): { duration: number } {
  const invalid = () => new Error('DEV รองรับ WAV PCM16 mono/stereo 16–48 kHz ไม่เกิน 64 MB และ 10 นาที');
  if (bytes.byteLength < 44 || bytes.byteLength > 64 * 1024 * 1024) throw invalid();
  const view = new DataView(bytes);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.byteLength) throw invalid();
  let format: { rate: number; alignment: number } | undefined;
  let dataBytes: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const name = tag(offset);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.byteLength) throw invalid();
    if (name === 'fmt ') {
      if (format || length !== 16 || view.getUint16(start, true) !== 1) throw invalid();
      const channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true);
      const alignment = view.getUint16(start + 12, true);
      if (![1, 2].includes(channels) || rate < DEV_AUDIO_RATE || rate > 48_000 || alignment !== channels * 2
        || view.getUint16(start + 14, true) !== 16 || view.getUint32(start + 8, true) !== rate * alignment) throw invalid();
      format = { rate, alignment };
    } else if (name === 'data') {
      if (dataBytes !== undefined || length === 0) throw invalid();
      dataBytes = length;
    }
    offset = start + length + (length % 2);
  }
  if (!format || !dataBytes || dataBytes % format.alignment) throw invalid();
  const duration = dataBytes / (format.rate * format.alignment);
  if (duration > 600) throw invalid();
  return { duration };
}

// PCM16 little endian, clipping before quantization to avoid wrapping.
export function encodeMonoPcm16(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(samples.length * 2);
  const view = new DataView(result.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return result;
}

// Keep resampling position across microphone callbacks; do not accumulate time drift.
export class MonoResampler {
  private pending = new Float32Array(0);
  private position = 0;
  constructor(private readonly inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < DEV_AUDIO_RATE) throw new Error("Unsupported audio sample rate");
  }
  push(input: Float32Array): Float32Array {
    const combined = new Float32Array(this.pending.length + input.length);
    combined.set(this.pending); combined.set(input, this.pending.length);
    const step = this.inputRate / DEV_AUDIO_RATE;
    const result: number[] = [];
    while (this.position + 1 < combined.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      result.push(combined[left] * (1 - fraction) + combined[left + 1] * fraction);
      this.position += step;
    }
    const consumed = Math.min(Math.floor(this.position), combined.length);
    this.pending = combined.slice(consumed);
    this.position -= consumed;
    return Float32Array.from(result);
  }
}

export class BoundedAudioSender {
  private queue: Uint8Array<ArrayBuffer>[] = [];
  private running = false;
  private stopped = false;
  private failure: Error | null = null;
  droppedChunks = 0;
  constructor(private readonly send: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>, private readonly capacity = 4) {}
  get depth() { return this.queue.length + Number(this.running); }
  get error() { return this.failure; }
  enqueue(chunk: Uint8Array<ArrayBuffer>): boolean {
    if (this.stopped || this.failure) return false;
    if (this.depth >= this.capacity) { this.droppedChunks += 1; return false; }
    this.queue.push(chunk);
    void this.drain();
    return true;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped && this.queue.length) await this.send(this.queue.shift()!);
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error("Audio upload failed");
      this.queue = [];
    } finally { this.running = false; }
  }
  stop() { this.stopped = true; this.queue = []; }
}
