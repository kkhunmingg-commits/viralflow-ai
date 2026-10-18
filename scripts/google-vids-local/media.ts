import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assertMp4 } from "../../src/features/manual-post/package";
import { FFmpegVideoRenderer } from "../../src/features/video/renderer";
import { DeterministicVideoQualityEvaluator } from "../../src/features/video/quality";

/** Same media probe/quality boundary as Video Factory, without any database or provider runtime. */
export async function inspectLocalImport(path: string) {
  const bytes = new Uint8Array(await readFile(path));
  assertMp4(bytes, "video/mp4");
  const { path: _privatePath, ...media } = await new FFmpegVideoRenderer().probe(path);
  void _privatePath;
  const checks = {
    duration8To10: Number.isFinite(media.duration) && media.duration >= 7.88 && media.duration <= 10.12,
    portrait: media.width > 0 && media.height > 0 && Math.abs(media.width / media.height - 9 / 16) < .01,
    videoH264: media.videoCodec === "h264",
    audioPresent: media.hasAudio,
    audioAac: media.audioCodec === "aac",
    usableResolution: media.width >= 540 && media.height >= 960,
  };
  const quality = new DeterministicVideoQualityEvaluator().evaluate({ ...media, path: "LOCAL_ONLY",
    overlay: [], scenes: [], productVisible: false, ctaVisible: false, malformedAssets: false, inheritedRisk: "REVIEW" });
  // A probe is not product/visual/audio-language or policy approval. Do not invent a scene plan.
  return { sha256: createHash("sha256").update(bytes).digest("hex"), media, checks,
    localMediaImport: "PASS" as const, databaseJobImport: "NOT_TESTED" as const,
    technicalFormat: Object.values(checks).every(Boolean) ? "PASS" : "REVIEW_REQUIRED",
    qualityStatus: quality.status, qualityChecks: quality.explanation,
    releaseDecision: "REVIEW_REQUIRED" as const, thaiNarration: "NOT_VERIFIED" as const,
    visualSafety: "NOT_VERIFIED" as const, automaticOmniGeneration: "NOT_VERIFIED" as const };
}
