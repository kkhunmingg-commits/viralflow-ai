// Microphone audio is resampled in small chunks; no completed video is generated here.
class ViralFlowPcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.input = [];
    this.phase = 0;
    this.chunks = [];
  }

  process(inputs, outputs) {
    const channel = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!channel) return true;

    const ratio = sampleRate / 16000;
    for (let index = 0; index < channel.length; index += 1) this.input.push(channel[index]);
    while (this.phase + 1 < this.input.length) {
      const index = Math.floor(this.phase);
      const fraction = this.phase - index;
      const sample = this.input[index] * (1 - fraction) + this.input[index + 1] * fraction;
      this.chunks.push(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))));
      this.phase += ratio;
      if (this.chunks.length >= 4000) {
        const packet = new Int16Array(this.chunks.splice(0, 4000));
        this.port.postMessage(packet.buffer, [packet.buffer]);
      }
    }
    const consumed = Math.floor(this.phase);
    if (consumed > 0) {
      this.input.splice(0, consumed);
      this.phase -= consumed;
    }
    return true;
  }
}

registerProcessor("viralflow-pcm-worklet", ViralFlowPcmWorklet);
