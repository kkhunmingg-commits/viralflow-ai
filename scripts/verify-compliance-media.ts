/** Offline readiness proof. This extracts actual media; it never asserts OCR, ASR or visual compliance. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ComplianceEngine } from "../src/features/compliance-brain/engine";
import { holdoutInput } from "../src/features/compliance-brain/holdout-corpus";
import { createSignedPolicyTestFixture } from "../src/features/compliance-brain/policy-test-fixtures";
import { extractVideoFrameEvidence, verifyVideoFrames } from "../src/features/video/frame-verification";
import { FFmpegVideoRenderer } from "../src/features/video/renderer";

function localRun(binary: string, args: string[], limitBytes = 4_000_000): Promise<Buffer> {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let length = 0; let failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error("LOCAL_MEDIA_TIMEOUT"); child.kill(); }, 45_000);
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > limitBytes) { failure = new Error("LOCAL_MEDIA_OUTPUT_LIMIT"); child.kill(); }
      else chunks.push(chunk);
    });
    // Diagnostic details may contain local paths. Only a fixed code is returned, not raw process output.
    child.stderr.resume();
    child.on("error", () => { failure = new Error("LOCAL_MEDIA_PROCESS_UNAVAILABLE"); });
    child.on("close", code => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure ?? new Error("LOCAL_MEDIA_PROCESS_FAILED"));
      else accept(Buffer.concat(chunks));
    });
  });
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function main() {
  const root = process.cwd(), directory = resolve(root, ".video-cache", "compliance-readiness");
  const reference = resolve(root, "benchmark-assets", "beauty.jpg");
  if (!existsSync(reference)) throw new Error("LOCAL_PRODUCT_FIXTURE_MISSING");
  const installed = join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const binary = existsSync(installed) ? installed : ffmpegPath;
  if (!binary) throw new Error("LOCAL_MEDIA_PROCESS_UNAVAILABLE");
  await mkdir(directory, { recursive: true });
  const videoPath = join(directory, "unverified-claim-fixture.mp4");
  // Fictional product image, actual local tone audio and a deliberately unverified burned-in claim.
  // This is a fixture, not a usable ad, lip-sync proof or a synthetic visual approval.
  await localRun(binary, ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "15",
    "-i", reference, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=8",
    "-vf", "scale=360:640:force_original_aspect_ratio=increase,crop=360:640,drawtext=text='UNVERIFIED SKIN CLAIM':fontcolor=white:fontsize=18:box=1:boxcolor=black:x=(w-text_w)/2:y=40,format=yuv420p",
    "-t", "8", "-r", "15", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", videoPath]);
  const rendered = await new FFmpegVideoRenderer().probe(videoPath);
  const bytes = await readFile(videoPath), before = sha256(bytes);
  // Decode the entire video/audio without re-encoding; corrupt streams fail this proof.
  await localRun(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-i", videoPath, "-f", "null", "-"]);
  const evidence = await extractVideoFrameEvidence(videoPath, reference, rendered.duration);
  const framePaths: string[] = [];
  for (const [index, frame] of evidence.frames.entries()) {
    const path = join(directory, `frame-${index + 1}.jpg`); await writeFile(path, frame.jpeg); framePaths.push(path);
  }
  const pcm = await localRun(binary, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", videoPath,
    "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", "-f", "s16le", "pipe:1"]);
  let squares = 0, peak = 0;
  for (let at = 0; at + 1 < pcm.length; at += 2) {
    const value = pcm.readInt16LE(at) / 32768; squares += value * value; peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(squares / (pcm.length / 2)), audioPath = join(directory, "extracted-audio.wav");
  if (pcm.length < 16000 || !Number.isFinite(rms) || rms <= .001) throw new Error("ACTUAL_AUDIO_NOT_DECODED");
  await writeFile(audioPath, wav(pcm));
  const visual = await verifyVideoFrames({ ...evidence, productTitle: "Fictional skincare fixture", expectedText: [] }, null);
  const { payload } = createSignedPolicyTestFixture();
  const input = holdoutInput("น้ำหนักสุทธิ 42 กรัมตามฉลาก", "skincare", "POST", "น้ำหนักสุทธิ 42 กรัมตามฉลาก");
  // Intentionally supply no invented transcript, OCR, cover observation or MEDIA_REVIEW evidence.
  const decision = await new ComplianceEngine({ policy: async () => payload }).evaluate({ ...input, stage: "FINAL_PUBLISH",
    media: { assetHash: before, coverageComplete: false, evidenceRefs: [] } });
  const after = sha256(await readFile(videoPath));
  if (before !== after || visual.status !== "REVIEW" || decision.status !== "REVIEW_REQUIRED") throw new Error("MEDIA_FAIL_CLOSED_PROOF_FAILED");
  const asrPath = join(directory, "asr-report.json");
  let asrObservation: { actualTranscript: string; status: string; reasons: string[]; actualEncodedAudio: boolean } | null = null;
  if (existsSync(asrPath)) {
    const asr = JSON.parse(await readFile(asrPath, "utf8")) as { actualTranscript?: unknown; audioSha256?: unknown;
      videoSha256?: unknown; audioExtractedFromEncodedVideo?: unknown };
    // Fixed artifact paths, not user-supplied report paths. Hashes bind the observation to actual bytes.
    const wavBytes = await readFile(join(directory, "spoken-claim-16k.wav"));
    const spokenVideoBytes = await readFile(join(directory, "spoken-claim-fixture.mp4"));
    if (typeof asr.actualTranscript !== "string" || !asr.actualTranscript.trim() || asr.actualTranscript.length > 3000
      || asr.audioSha256 !== sha256(wavBytes) || asr.videoSha256 !== sha256(spokenVideoBytes)
      || asr.audioExtractedFromEncodedVideo !== true) throw new Error("LOCAL_ASR_OBSERVATION_INVALID");
    const asrInput = holdoutInput(asr.actualTranscript, "skincare", "POST");
    const asrDecision = await new ComplianceEngine({ policy: async () => payload }).evaluate({ ...asrInput,
      stage: "FINAL_PUBLISH", content: { script: asr.actualTranscript, transcript: asr.actualTranscript },
      media: { assetHash: sha256(spokenVideoBytes), coverageComplete: false, evidenceRefs: [] } });
    if (["PASS", "PASS_WITH_WARNING"].includes(asrDecision.status)) throw new Error("ASR_MEDIA_FAIL_CLOSED_PROOF_FAILED");
    asrObservation = { actualTranscript: asr.actualTranscript, status: asrDecision.status,
      reasons: asrDecision.reasons.map(row => row.code), actualEncodedAudio: true };
  }
  const report = { schemaVersion: 1, performedAt: new Date().toISOString(), kind: "OFFLINE_ACTUAL_MEDIA_READINESS",
    fixtureOnly: true, providerCalls: 0, paidCalls: 0, tikTokPostingCalls: 0, sourceUnchanged: before === after,
    assetSha256: before, sourcePath: videoPath, referencePath: reference, technicalDecode: "PASS", video: {
      duration: rendered.duration, width: rendered.width, height: rendered.height, fps: rendered.fps,
      codec: rendered.videoCodec, audioCodec: rendered.audioCodec, sizeBytes: rendered.sizeBytes },
    decodedAudio: { sampleRate: 16000, channels: 1, pcmSamples: pcm.length / 2, durationSeconds: pcm.length / 32000,
      rms, peak, wavPath: audioPath, semanticSpeechAssessment: "NOT_PERFORMED", fixtureContent: "LOCAL_SINE_TONE" },
    actualFrames: evidence.frames.map((frame, index) => ({ atSeconds: frame.atSeconds, sha256: sha256(frame.jpeg), bytes: frame.jpeg.length, path: framePaths[index] })),
    textExtraction: "OCR_NOT_PROVISIONED", transcription: "TONE_FIXTURE_NOT_TRANSCRIBED", visualScanner: visual,
    experimentalSeparateSpeechFixture: asrObservation,
    finalCompliance: { status: decision.status, reasons: decision.reasons.map(row => row.code) },
    limitations: ["Sampled frames do not establish complete visual coverage", "Decoded audio energy is not speech transcription",
      "No visual or speech semantic PASS is emitted", "Policy and claim authority here are isolated test fixtures only"] };
  const reportPath = join(directory, "report.json"); await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reportPath, technicalDecode: report.technicalDecode, actualFrameCount: evidence.frames.length,
    audioDecoded: true, visualStatus: visual.status, finalCompliance: decision.status, paidCalls: 0, tikTokPostingCalls: 0 }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "LOCAL_MEDIA_PROOF_FAILED"); process.exitCode = 1; });
