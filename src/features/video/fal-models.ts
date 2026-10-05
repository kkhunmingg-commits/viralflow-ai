export const FAL_MODEL_ENDPOINTS = {
  LTX_098_DISTILLED: "fal-ai/ltxv-13b-098-distilled/image-to-video",
  WAN_26_FLASH: "wan/v2.6/image-to-video/flash",
  KLING_25_STANDARD: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video",
  LTX_23_FAST: "fal-ai/ltx-2.3/image-to-video/fast",
  WAN_22_TURBO: "fal-ai/wan/v2.2-a14b/image-to-video/turbo",
} as const;

export type FalModelId = typeof FAL_MODEL_ENDPOINTS[keyof typeof FAL_MODEL_ENDPOINTS];
export type FalVideoResolution = "480p" | "580p" | "720p" | "1080p";
export type FalAspectRatio = "auto" | "16:9" | "9:16" | "1:1";
export interface FalModelSettings {
  model: FalModelId;
  durationSeconds: number | null;
  resolution: FalVideoResolution;
  aspectRatio: FalAspectRatio;
  numFrames?: number;
  framesPerSecond?: number;
  generateAudio: false;
}
export interface FalModelSelection {
  model?: string;
  durationSeconds?: number | null;
  resolution?: string;
  aspectRatio?: string;
}
export interface FalModelDefinition {
  endpoint: FalModelId;
  resolutions: readonly FalVideoResolution[];
  aspectRatios: readonly FalAspectRatio[];
  durationMode: "FRAMES" | "SECONDS" | "PROVIDER_DEFINED";
  durations: readonly number[];
  nativeAudio: boolean;
  explicitAspectRatio: boolean;
  commercialUse: true;
  catalogCheckedAt: "2026-10-04";
  priceUrl: string;
}

const definition = (endpoint: FalModelId, properties: Omit<FalModelDefinition, "endpoint" | "commercialUse" | "catalogCheckedAt" | "priceUrl">): FalModelDefinition => Object.freeze({
  endpoint, ...properties, commercialUse: true, catalogCheckedAt: "2026-10-04",
  priceUrl: `https://fal.ai/models/${endpoint}`,
});

// These are verified catalog candidates, not quality benchmark winners.
export const FAL_MODEL_CATALOG: readonly FalModelDefinition[] = Object.freeze([
  definition(FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, {resolutions: ["480p", "720p"], aspectRatios: ["auto", "16:9", "9:16", "1:1"], durationMode: "FRAMES", durations: [], nativeAudio: false, explicitAspectRatio: true}),
  definition(FAL_MODEL_ENDPOINTS.WAN_26_FLASH, {resolutions: ["720p", "1080p"], aspectRatios: ["auto", "16:9", "9:16", "1:1"], durationMode: "SECONDS", durations: [5, 10, 15], nativeAudio: true, explicitAspectRatio: false}),
  definition(FAL_MODEL_ENDPOINTS.KLING_25_STANDARD, {resolutions: ["720p"], aspectRatios: ["auto", "16:9", "9:16", "1:1"], durationMode: "SECONDS", durations: [5, 10], nativeAudio: false, explicitAspectRatio: false}),
  definition(FAL_MODEL_ENDPOINTS.LTX_23_FAST, {resolutions: ["1080p"], aspectRatios: ["auto", "16:9", "9:16"], durationMode: "SECONDS", durations: [6, 8, 10], nativeAudio: true, explicitAspectRatio: true}),
  definition(FAL_MODEL_ENDPOINTS.WAN_22_TURBO, {resolutions: ["480p", "580p", "720p"], aspectRatios: ["auto", "16:9", "9:16", "1:1"], durationMode: "PROVIDER_DEFINED", durations: [], nativeAudio: false, explicitAspectRatio: true}),
]);

export function getFalModel(endpoint: string): FalModelDefinition {
  const model = FAL_MODEL_CATALOG.find(value => value.endpoint === endpoint);
  if (!model) throw new Error("Unsupported video model configuration");
  return model;
}

export function resolveFalModelSettings(selection: FalModelSelection = {}): FalModelSettings {
  const model = getFalModel(selection.model ?? FAL_MODEL_ENDPOINTS.WAN_22_TURBO);
  const requestedResolution = selection.resolution ?? (model.resolutions.includes("720p") ? "720p" : model.resolutions[0]);
  if (!["480p", "580p", "720p", "1080p"].includes(requestedResolution)) throw new Error("Invalid video resolution configuration");
  if (!model.resolutions.includes(requestedResolution as FalVideoResolution)) throw new Error("Unsupported video resolution for selected model");
  const resolution = requestedResolution as FalVideoResolution;
  const aspectRatio = selection.aspectRatio ?? "9:16";
  if (!model.aspectRatios.includes(aspectRatio as FalAspectRatio)) throw new Error("Invalid video aspect ratio configuration");
  const settings: FalModelSettings = {model: model.endpoint, resolution, aspectRatio: aspectRatio as FalAspectRatio, durationSeconds: null, generateAudio: false};
  const requestedDuration = selection.durationSeconds ?? 8;
  if (!Number.isFinite(requestedDuration) || requestedDuration < 8 || requestedDuration > 10) throw new Error("Video duration must be between 8 and 10 seconds");
  if (model.durationMode === "PROVIDER_DEFINED") return Object.freeze(settings);
  if (model.durationMode === "FRAMES") {
    // Keep the first reference frame when rounding the generation length.
    // The pipeline validates and normalizes this slight duration overrun.
    const numFrames = Math.ceil((requestedDuration * 24 - 1) / 8) * 8 + 1;
    return Object.freeze({...settings, durationSeconds: numFrames / 24, numFrames, framesPerSecond: 24});
  }
  const durationSeconds = model.durations.find(value => value >= requestedDuration);
  if (!durationSeconds) throw new Error("Unsupported video duration configuration");
  return Object.freeze({...settings, durationSeconds});
}

export function restoreFalModelSettings(snapshot: FalModelSettings): FalModelSettings {
  const model = getFalModel(snapshot.model);
  const noFrames = snapshot.numFrames === undefined && snapshot.framesPerSecond === undefined;
  const durationValid = model.durationMode === "PROVIDER_DEFINED" ? snapshot.durationSeconds === null && noFrames
    : model.durationMode === "FRAMES" ? Number.isInteger(snapshot.numFrames) && snapshot.numFrames! >= 193 && snapshot.numFrames! <= 241
      && (snapshot.numFrames! - 1) % 8 === 0 && snapshot.framesPerSecond === 24 && snapshot.durationSeconds === snapshot.numFrames! / 24
    : snapshot.durationSeconds !== null && snapshot.durationSeconds >= 8 && snapshot.durationSeconds <= 10
      && model.durations.includes(snapshot.durationSeconds) && noFrames;
  if (!model.resolutions.includes(snapshot.resolution) || !model.aspectRatios.includes(snapshot.aspectRatio) || snapshot.generateAudio !== false || !durationValid) {
    throw new Error("Invalid saved video settings");
  }
  // Keep only the settings represented by the validated provider schema.
  return Object.freeze({model: model.endpoint, resolution: snapshot.resolution, aspectRatio: snapshot.aspectRatio,
    durationSeconds: snapshot.durationSeconds, generateAudio: false,
    ...(model.durationMode === "FRAMES" ? {numFrames: snapshot.numFrames, framesPerSecond: snapshot.framesPerSecond} : {})});
}

export function getFalModelCost(settings: FalModelSettings): {estimatedCostUsd: number; reservedCostUsd: number} {
  restoreFalModelSettings(settings);
  const seconds = settings.durationSeconds ?? 0;
  const usd = (value: number) => Number(value.toFixed(12));
  switch (settings.model) {
    case FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED:
      return {estimatedCostUsd: usd(seconds * .02), reservedCostUsd: usd(seconds * .02)};
    case FAL_MODEL_ENDPOINTS.WAN_26_FLASH: {
      // Silent billing is half the live audio-on quote. Reserve the higher quote
      // until a billing record supplies actual charged units for this request.
      const audioOnRate = settings.resolution === "1080p" ? .075 : .05;
      return {estimatedCostUsd: usd(seconds * audioOnRate / 2), reservedCostUsd: usd(seconds * audioOnRate)};
    }
    case FAL_MODEL_ENDPOINTS.KLING_25_STANDARD:
      return {estimatedCostUsd: usd(seconds * .042), reservedCostUsd: usd(seconds * .042)};
    case FAL_MODEL_ENDPOINTS.LTX_23_FAST:
      return {estimatedCostUsd: usd(seconds * .06), reservedCostUsd: usd(seconds * .06)};
    case FAL_MODEL_ENDPOINTS.WAN_22_TURBO: {
      const cost = settings.resolution === "480p" ? .05 : settings.resolution === "580p" ? .075 : .10;
      return {estimatedCostUsd: cost, reservedCostUsd: cost};
    }
  }
}

export function buildFalModelInput(settings: FalModelSettings, input: {imageUrl: string; prompt: string; seed?: number}): Record<string, unknown> {
  restoreFalModelSettings(settings);
  const base = {image_url: input.imageUrl, prompt: input.prompt};
  const seeded = input.seed === undefined ? base : {...base, seed: input.seed};
  switch (settings.model) {
    case FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED:
      return {...seeded, resolution: settings.resolution, aspect_ratio: settings.aspectRatio, num_frames: settings.numFrames, frame_rate: settings.framesPerSecond, enable_detail_pass: false, expand_prompt: false, enable_safety_checker: true};
    case FAL_MODEL_ENDPOINTS.WAN_26_FLASH:
      return {...seeded, resolution: settings.resolution, duration: String(settings.durationSeconds), generate_audio: false, enable_prompt_expansion: false, multi_shots: false, enable_safety_checker: true};
    case FAL_MODEL_ENDPOINTS.KLING_25_STANDARD:
      // This endpoint inherits composition from the source image; its own Input
      // schema does not accept aspect_ratio, resolution, audio, or seed fields.
      return {...base, duration: String(settings.durationSeconds), negative_prompt: "blur, distort, and low quality", cfg_scale: .5};
    case FAL_MODEL_ENDPOINTS.LTX_23_FAST:
      return {...base, resolution: settings.resolution, aspect_ratio: settings.aspectRatio, duration: String(settings.durationSeconds), fps: 25, generate_audio: false};
    case FAL_MODEL_ENDPOINTS.WAN_22_TURBO:
      return {...seeded, resolution: settings.resolution, aspect_ratio: settings.aspectRatio, enable_safety_checker: true, enable_output_safety_checker: true, enable_prompt_expansion: false, acceleration: "regular", video_quality: "high", video_write_mode: "balanced"};
  }
}
