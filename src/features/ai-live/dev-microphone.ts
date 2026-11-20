import { BoundedAudioSender, DEV_AUDIO_CHUNK_SAMPLES, encodeMonoPcm16, MonoResampler } from "./dev-audio";

export class MicrophonePcmChunks {
  private pending = new Float32Array(0);
  private readonly resampler: MonoResampler;
  constructor(sampleRate: number, private readonly receive: (chunk: Uint8Array<ArrayBuffer>) => void) {
    this.resampler = new MonoResampler(sampleRate);
  }
  push(samples: Float32Array) {
    const mono = this.resampler.push(samples);
    const combined = new Float32Array(this.pending.length + mono.length);
    combined.set(this.pending); combined.set(mono, this.pending.length);
    let offset = 0;
    while (combined.length - offset >= DEV_AUDIO_CHUNK_SAMPLES) {
      this.receive(encodeMonoPcm16(combined.subarray(offset, offset + DEV_AUDIO_CHUNK_SAMPLES)));
      offset += DEV_AUDIO_CHUNK_SAMPLES;
    }
    this.pending = combined.slice(offset);
  }
  flush() {
    if (this.pending.length) this.receive(encodeMonoPcm16(this.pending));
    this.pending = new Float32Array(0);
  }
}

export async function openDevMicrophone(sender: BoundedAudioSender): Promise<{ close: () => Promise<void> }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone unavailable: use a secure localhost browser context");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false }, video: false });
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let mute: GainNode | null = null;
  let workletUrl: string | null = null;
  try {
    context = new AudioContext();
    workletUrl = URL.createObjectURL(new Blob([`
    class MonoCapture extends AudioWorkletProcessor {
      process(inputs) {
        const channels = inputs[0];
        if (channels && channels.length && channels[0].length) {
          const mono = new Float32Array(channels[0].length);
          for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
          this.port.postMessage(mono, [mono.buffer]);
        }
        return true;
      }
    }
    registerProcessor('viralflow-dev-mono', MonoCapture);
  `], { type: "text/javascript" }));
    await context.audioWorklet.addModule(workletUrl);
    const chunks = new MicrophonePcmChunks(context.sampleRate, (chunk) => { sender.enqueue(chunk); });
    node = new AudioWorkletNode(context, "viralflow-dev-mono");
    node.port.onmessage = (event: MessageEvent<Float32Array>) => chunks.push(event.data);
    source = context.createMediaStreamSource(stream);
    mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node); node.connect(mute); mute.connect(context.destination);
    await context.resume();
    const captureContext = context;
    let closing: Promise<void> | null = null;
    return { close: () => {
      if (closing) return closing;
      closing = (async () => {
        if (node) node.port.onmessage = null;
        try {
          source?.disconnect(); node?.disconnect(); mute?.disconnect();
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          // Stop/discard trailing samples; no speech survives a session stop/restart.
          sender.stop();
          if (captureContext.state !== "closed") await captureContext.close();
        }
      })();
      return closing;
    } };
  } catch (error) {
    try { source?.disconnect(); node?.disconnect(); mute?.disconnect(); }
    finally {
      stream.getTracks().forEach((track) => track.stop());
      sender.stop();
      if (context && context.state !== "closed") await context.close();
    }
    throw error;
  } finally { if (workletUrl) URL.revokeObjectURL(workletUrl); }
}
