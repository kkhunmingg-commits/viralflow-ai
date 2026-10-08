import { z } from "zod";
import type { ComplianceContent } from "./contracts";

const uncertainties = z.enum(["SAMPLED_FRAMES_ONLY", "VISUAL_SEMANTICS_UNVERIFIED", "PIXEL_INSPECTION_UNAVAILABLE",
  "OCR_LOW_CONFIDENCE", "FRAME_LOW_QUALITY", "COMPARISON_CONTEXT_UNVERIFIED", "ASR_UNVERIFIED", "AUDIO_UNVERIFIED"]);
export const localMediaObservationSchema = z.object({
  schemaVersion: z.literal(1), assetHash: z.string().regex(/^[a-f0-9]{64}$/),
  durationSeconds: z.number().positive().max(30), coverageComplete: z.literal(false), evidenceVerified: z.literal(false),
  frames: z.array(z.object({ timeSeconds: z.number().nonnegative().max(30), text: z.string().max(4000),
    confidence: z.number().min(0).max(100), comparisonCandidate: z.boolean(),
    contrast: z.number().nonnegative().nullable(), sharpness: z.number().nonnegative().nullable(),
  }).strict()).min(1).max(60), transcript: z.string().max(4000).optional(),
  audioStatus: z.enum(["OBSERVED", "UNAVAILABLE"]), uncertainties: z.array(uncertainties).min(1).max(8),
}).strict().superRefine((value, context) => {
  if (value.frames.some((frame, index) => frame.timeSeconds >= value.durationSeconds
    || index > 0 && frame.timeSeconds <= value.frames[index - 1].timeSeconds)
    || value.audioStatus === "OBSERVED" && !value.transcript?.trim()) {
    context.addIssue({ code: "custom", message: "MEDIA_OBSERVATION_INVALID" });
  }
});
export type LocalMediaObservation = z.infer<typeof localMediaObservationSchema>;
export type MediaInspection = { state: "DISABLED" | "FAILED" } | { state: "OBSERVED"; observation: LocalMediaObservation };

/** OCR often inserts spaces between Thai glyphs. Keep the raw text and also inspect
 * a compact reading; do not correct lost tone marks or invent missing characters. */
export function compactThaiOcr(text: string): string {
  return text.normalize("NFC").replace(/([\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])/gu, "$1");
}

/** These are additional observations, never verified PDP facts or a human media attestation. */
export function appendMediaObservations(content: ComplianceContent, observation: LocalMediaObservation,
  expectedAssetHash: string): ComplianceContent {
  const checked = localMediaObservationSchema.parse(observation);
  if (checked.assetHash !== expectedAssetHash) throw new Error("MEDIA_OBSERVATION_ASSET_MISMATCH");
  return { ...content,
    transcript: [content.transcript, checked.transcript].filter(Boolean).join("\n") || undefined,
    onScreenText: [...new Set([...(content.onScreenText ?? []), ...checked.frames.flatMap(frame =>
      [frame.text, compactThaiOcr(frame.text)]).filter(Boolean)])],
  };
}
