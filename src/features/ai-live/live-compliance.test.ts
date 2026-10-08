import { describe, expect, it, vi } from "vitest";
import { LiveSpeechScheduler } from "./speech-scheduler";
import { SafetyVoiceBuffer } from "./safety-voice-buffer";
import { ActionQueue, CommentEngine, ProductBrain, type LiveBrainProvider } from "./domain";
import { LivePipeline } from "./live-pipeline";
import { LiveSessionController } from "./session-controller";
import type { SpeechCompliancePort } from "./compliance-speech";

function speech(compliance?: SpeechCompliancePort) {
  const spoken: string[] = [], audio: number[] = [];
  const voice = { async *streamText(text: string) { spoken.push(text); yield new Uint8Array([1, 2]); yield new Uint8Array([3, 4]); },
    interrupt: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
  const scheduler = new LiveSpeechScheduler({ compliance, complianceTimeoutMs: 25, voice,
    presenterAudio: { pushAudioChunk: async (_session, chunk) => { audio.push(chunk[0]); } } });
  scheduler.enqueue({ id: "speech", text: "First. Second.", priority: 50, source: "SCRIPT", productId: "product", intent: "PRODUCT" });
  return { scheduler, voice, spoken, audio };
}

describe("LIVE shared ComplianceEngine execution boundary", () => {
  it("does not call TTS or enqueue PCM when the authority is missing, unavailable or refuses", async () => {
    for (const port of [undefined, { authorize: async () => { throw new Error("offline_without_pack"); } },
      { authorize: async (text: string) => ({ allowed: false, text }) }]) {
      const fixture = speech(port);
      await expect(fixture.scheduler.runNext("session")).rejects.toThrow("live_compliance_required");
      expect(fixture.spoken).toEqual([]); expect(fixture.audio).toEqual([]);
      expect(fixture.scheduler.size).toBe(0);
    }
  });

  it("checks the whole script before segmentation and speaks only a rescanned rewrite", async () => {
    const checked: string[] = [];
    const port: SpeechCompliancePort = { authorize: async (text) => {
      checked.push(text);
      return { allowed: true, text: text === "First. Second." ? "Verified information." : text };
    } };
    const fixture = speech(port);
    expect(await fixture.scheduler.runNext("session")).toMatchObject({ status: "COMPLETE" });
    expect(checked[0]).toBe("First. Second.");
    expect(fixture.spoken).toEqual(["Verified information."]);
    expect(checked.slice(1)).toEqual(["Verified information.", "Verified information.", "Verified information."]);
  });

  it("rechecks prepared audio against current policy before every PCM enqueue", async () => {
    let decisions = 0;
    const fixture = speech({ authorize: async (text) => ({ allowed: ++decisions < 4, text }) });
    await expect(fixture.scheduler.runNext("session")).rejects.toThrow("live_compliance_required");
    expect(fixture.audio).toEqual([1]);
    expect(fixture.scheduler.size).toBe(0); // denied script cannot retry forever
  });

  it("bounds a stalled authority and responds to interruption before any voice call", async () => {
    let signal: AbortSignal | undefined;
    const fixture = speech({ authorize: (_text, abort) => { signal = abort; return new Promise(() => {}); } });
    const started = Date.now();
    await expect(fixture.scheduler.runNext("session")).rejects.toThrow("live_compliance_required");
    expect(Date.now() - started).toBeLessThan(250);
    expect(fixture.spoken).toEqual([]); expect(fixture.audio).toEqual([]);
    expect(signal?.aborted).toBe(true);
  });

  it("cancels an in-flight cached-filler decision on pause before any PCM", async () => {
    let signal: AbortSignal | undefined;
    const buffer = new SafetyVoiceBuffer({ compliance: { authorize: (_text, abort) => {
      signal = abort; return new Promise(() => {});
    } } });
    buffer.prepare({ id: "filler", category: "FILLER", productId: null, provenance: "RECORDED",
      transcript: "Neutral filler", pcm16: new Uint8Array([1, 2]), sampleRate: 16_000, channels: 1 });
    const output = vi.fn(async () => {});
    const scheduler = new LiveSpeechScheduler({ buffer, voice: { async *streamText() {},
      interrupt: async () => {}, cancel: async () => {} }, presenterAudio: { pushAudioChunk: output } });
    const result = expect(scheduler.playSafety("session", null)).rejects.toThrow("live_compliance_required");
    await scheduler.pause(); await result;
    expect(signal?.aborted).toBe(true); expect(output).not.toHaveBeenCalled();
    expect(buffer.metrics().consumedSeconds).toBe(0);
  });

  it("never prewarms unsafe text and does not exempt cached filler from the shield", async () => {
    let permitted = false, voiceCalls = 0;
    const buffer = new SafetyVoiceBuffer({ compliance: { authorize: async (text) => ({ allowed: permitted, text }) } });
    const voice = { async *streamText() { voiceCalls += 1; yield new Uint8Array([1, 2]); }, interrupt: async () => {}, cancel: async () => {} };
    await expect(buffer.prepareFromVoice([{ id: "filler", category: "FILLER", productId: null, text: "Unchecked" }],
      voice, { signal: new AbortController().signal })).rejects.toThrow("live_compliance_required");
    expect(voiceCalls).toBe(0);
    permitted = true;
    await buffer.prepareFromVoice([{ id: "filler", category: "FILLER", productId: null, text: "Verified neutral text" }],
      voice, { signal: new AbortController().signal });
    permitted = false;
    await expect(buffer.take("FILLER", null)).rejects.toThrow("live_compliance_required");
    expect(buffer.metrics().consumedSeconds).toBe(0);
    const legacy = new SafetyVoiceBuffer();
    legacy.prepare({ id: "old", category: "FILLER", productId: null, pcm16: new Uint8Array([1, 2]),
      sampleRate: 16_000, channels: 1, provenance: "RECORDED" });
    await expect(legacy.take("FILLER", null)).rejects.toThrow("live_compliance_required");
  });

  it("routes refused brain replies through the same gate for a neutral answer before TTS", async () => {
    const unsafe = "unsupported treatment claim";
    const neutral = "ฉันยังไม่มีข้อมูลที่ยืนยันเรื่องนี้ จึงไม่ขอกล่าวอ้างเพิ่มเติม";
    const checked: string[] = [], spoken: string[] = [];
    const compliance: SpeechCompliancePort = { authorize: async (text) => {
      checked.push(text); return { allowed: text === neutral, text };
    } };
    const controller = new LiveSessionController({ kind: "mock", health: async () => "READY", start: async () => {},
      pause: async () => {}, resume: async () => {}, stop: async () => {} },
    { load: async () => null, save: async () => {} }, { allowMock: true });
    const brain: LiveBrainProvider = { decide: async () => ({ reply: unsafe, intent: "PRODUCT", priority: 50,
      suggestedActions: [{ type: "SPEAK", priority: 50 }] }) };
    const pipeline = new LivePipeline({ controller, brain, compliance, comments: new CommentEngine(),
      products: new ProductBrain([{ id: "product", title: "Product", status: "available" }]), actions: new ActionQueue(),
      voice: { async *streamText(text) { spoken.push(text); yield new Uint8Array([1, 2]); }, interrupt: async () => {}, cancel: async () => {} },
      presenterAudio: { pushAudioChunk: async () => {} } });
    await controller.start({ ownerId: "owner", tiktokAccountId: "account", productIds: ["product"], presenterReferenceId: "reference" });
    pipeline.ingestComment({ commentId: "comment", viewerId: "viewer", text: "คำถาม", createdAtMs: Date.now() });
    expect((await pipeline.handleNextComment()).type).toBe("COMMENT_HANDLED");
    await pipeline.handleNextAction();
    expect(checked).toContain(unsafe); expect(checked).toContain(neutral);
    expect(spoken).toEqual([neutral]); expect(controller.current()?.currentResponse).toBe(neutral);
    await controller.stop();
  });
});
