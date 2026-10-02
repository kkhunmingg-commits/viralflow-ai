import { describe, expect, it } from "vitest";
import { BoundedAudioSender, encodeMonoPcm16, inspectDevPcmWave, MonoResampler } from "./dev-audio";
import { MicrophonePcmChunks } from "./dev-microphone";

describe("DEV browser real audio transport", () => {
  function waveFixture() {
    const bytes = new ArrayBuffer(44 + 32000);
    const view = new DataView(bytes);
    const tag = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    tag(0, 'RIFF'); tag(8, 'WAVE'); tag(12, 'fmt '); tag(36, 'data');
    view.setUint32(4, bytes.byteLength - 8, true); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    view.setUint32(40, 32000, true);
    return bytes;
  }
  it('accepts bounded real PCM WAV and validates duration before decoding', () => {
    expect(inspectDevPcmWave(waveFixture()).duration).toBe(1);
  });
  it('rejects compressed formats, forged sample size and truncated data before decoding', () => {
    for (const mutate of [(view: DataView) => view.setUint16(20, 3, true),
      (view: DataView) => view.setUint32(28, 1, true), (view: DataView) => view.setUint32(40, 32002, true)]) {
      const bytes = waveFixture(); mutate(new DataView(bytes));
      expect(() => inspectDevPcmWave(bytes)).toThrow('WAV PCM16');
    }
    expect(() => inspectDevPcmWave(new ArrayBuffer(12))).toThrow('WAV PCM16');
  });
  it("clips and encodes little endian mono PCM16", () => {
    const bytes = encodeMonoPcm16(Float32Array.from([-2, -1, 0, 1, 2]));
    const pcm = new DataView(bytes.buffer);
    expect(Array.from({ length: 5 }, (_, index) => pcm.getInt16(index * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
  });
  it("keeps resampling stable across arbitrary microphone callback boundaries", () => {
    const samples = Float32Array.from({ length: 96_000 }, (_, index) => Math.sin(index / 40));
    const full = new MonoResampler(48_000).push(samples);
    const stream = new MonoResampler(48_000);
    const result: number[] = [];
    for (let offset = 0; offset < samples.length; offset += 128) result.push(...stream.push(samples.subarray(offset, offset + 128)));
    expect(result.length).toBe(full.length);
    for (let index = 0; index < result.length; index += 31) expect(result[index]).toBeCloseTo(full[index], 6);
  });
  it("converts synthetic capture callbacks into bounded microphone PCM chunks without claiming physical capture", () => {
    const sent: Uint8Array<ArrayBuffer>[] = [];
    const capture = new MicrophonePcmChunks(48_000, (chunk) => sent.push(chunk));
    for (let index = 0; index < 750; index += 1) capture.push(new Float32Array(128).fill(0.25));
    capture.flush();
    expect(sent.length).toBe(4);
    expect(sent.every((chunk) => chunk.length <= 16_000 && chunk.length % 2 === 0)).toBe(true);
    expect(sent.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(64_000);
    expect(new DataView(sent[0].buffer).getInt16(0, true)).toBe(8192);
  });
  it("bounds microphone backlog, reports drops, and discards unsent speech on release", async () => {
    let release!: () => void;
    const uploaded: number[] = [];
    const sender = new BoundedAudioSender(async (chunk) => {
      uploaded.push(chunk[0]);
      await new Promise<void>((resolve) => { release = resolve; });
    }, 2);
    expect(sender.enqueue(Uint8Array.of(1))).toBe(true);
    expect(sender.enqueue(Uint8Array.of(2))).toBe(true);
    expect(sender.enqueue(Uint8Array.of(3))).toBe(false);
    expect(sender.droppedChunks).toBe(1);
    expect(sender.depth).toBe(2);
    sender.stop(); release();
    await Promise.resolve(); await Promise.resolve();
    expect(uploaded).toEqual([1]);
    expect(sender.depth).toBe(0);
    expect(sender.enqueue(Uint8Array.of(4))).toBe(false);
  });
  it("surfaces upload failure and clears pending speech instead of retrying silently", async () => {
    const sender = new BoundedAudioSender(async () => { throw new Error("real worker disconnected"); });
    sender.enqueue(Uint8Array.of(1)); sender.enqueue(Uint8Array.of(2));
    await Promise.resolve(); await Promise.resolve();
    expect(sender.error?.message).toBe("real worker disconnected");
    expect(sender.depth).toBe(0);
    expect(sender.enqueue(Uint8Array.of(3))).toBe(false);
  });
});
