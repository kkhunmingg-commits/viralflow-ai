import { z } from "zod";

export const LIVE_GESTURES = [
  "neutral", "smile", "nod", "small_wave", "open_palm", "point_product", "hold_product",
  "light_hair_touch", "laugh_reaction", "listening_pose",
] as const;
export type LiveGesture = typeof LIVE_GESTURES[number];
export const AVATAR_RENDERERS = [
  "MuseTalkCPUFloat32", "MuseTalkGPU", "MuseTalkHybrid", "FasterLivePortrait", "DittoRenderer",
] as const;
export type AvatarRendererName = typeof AVATAR_RENDERERS[number];

const internalReference = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const customerImage = z.string().max(2_000).refine((value) => {
  if (value.startsWith("/api/ai-live/") && !value.startsWith("//")) return !value.includes("..");
  try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; }
  catch { return false; }
}, "A presenter image must use an authenticated local image route or HTTPS.");

/** Portable metadata only. Secrets, executable paths and model files never belong in a pack. */
export const presenterPackSchema = z.object({
  id: internalReference,
  ownerId: internalReference,
  name: z.string().trim().min(1).max(80),
  identity: z.object({
    referenceId: internalReference,
    imageUrl: customerImage.nullable(),
    consentConfirmed: z.boolean(),
    representsRealPerson: z.boolean(),
  }).strict(),
  neutral: z.object({ referenceId: internalReference, expression: z.literal("neutral") }).strict(),
  expressionProfile: z.object({
    intensity: z.number().min(0).max(1),
    allowed: z.array(z.enum(["neutral", "friendly", "listening", "smile", "surprise"])).min(1).max(5),
  }).strict(),
  gestureBank: z.array(z.enum(LIVE_GESTURES)).min(1).max(LIVE_GESTURES.length),
  voiceBinding: z.object({ voiceId: internalReference, displayName: z.string().trim().min(1).max(80) }).strict().nullable(),
  safetyFallback: z.object({ gesture: z.literal("neutral"), referenceId: internalReference }).strict(),
  rendererCompatibility: z.array(z.enum(AVATAR_RENDERERS)).min(1).max(AVATAR_RENDERERS.length),
  assignedAccountIds: z.array(internalReference).max(50),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (!value.gestureBank.includes("neutral")) context.addIssue({ code: "custom", path: ["gestureBank"], message: "Neutral recovery is required." });
  for (const field of ["gestureBank", "rendererCompatibility", "assignedAccountIds"] as const) {
    if (new Set(value[field]).size !== value[field].length) context.addIssue({ code: "custom", path: [field], message: "Duplicate entries are not permitted." });
  }
  if (value.updatedAtMs < value.createdAtMs) context.addIssue({ code: "custom", path: ["updatedAtMs"], message: "Invalid metadata timestamp." });
});

export type PresenterPack = z.infer<typeof presenterPackSchema>;

export function validatePresenterPack(value: unknown, ownerId: string): PresenterPack {
  const pack = presenterPackSchema.parse(value);
  if (pack.ownerId !== ownerId) throw new Error("presenter_owner_mismatch");
  return pack;
}

export interface PresenterPackReadiness {
  status: "READY" | "SETUP_REQUIRED";
  imageReady: boolean;
  voiceReady: boolean;
  identityReady: boolean;
}

/** Configuration readiness does not assert that the renderer or machine has been validated. */
export function presenterPackReadiness(pack: PresenterPack): PresenterPackReadiness {
  const imageReady = Boolean(pack.identity.referenceId && pack.identity.imageUrl);
  const voiceReady = Boolean(pack.voiceBinding);
  const identityReady = !pack.identity.representsRealPerson || pack.identity.consentConfirmed;
  return { imageReady, voiceReady, identityReady, status: imageReady && voiceReady && identityReady ? "READY" : "SETUP_REQUIRED" };
}

export interface CustomerPresenterPack {
  id: string;
  name: string;
  imageUrl: string | null;
  voiceName: string | null;
  assignedAccountIds: string[];
  status: PresenterPackReadiness["status"];
}

/** IDs are opaque action handles; customer views never render them or the internal pack. */
export function customerPresenterPack(pack: PresenterPack): CustomerPresenterPack {
  return { id: pack.id, name: pack.name, imageUrl: pack.identity.imageUrl, voiceName: pack.voiceBinding?.displayName ?? null,
    assignedAccountIds: [...pack.assignedAccountIds], status: presenterPackReadiness(pack).status };
}
