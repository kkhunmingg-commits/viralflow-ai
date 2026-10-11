import {describe, expect, it} from "vitest";
import {buildFalModelInput, FAL_MODEL_CATALOG, FAL_MODEL_ENDPOINTS, getFalModelCost, resolveFalModelSettings, restoreFalModelSettings} from "./fal-models";

const reference = {imageUrl: "https://example.invalid/product.jpg", prompt: "Slow portrait product reveal", seed: 42};

describe("fal production model catalog", () => {
  it("keeps the five verified choices and marks quality approval separately", () => {
    expect(FAL_MODEL_CATALOG.map(model => model.endpoint)).toEqual(Object.values(FAL_MODEL_ENDPOINTS));
    expect(FAL_MODEL_CATALOG.every(model => model.commercialUse && model.catalogCheckedAt === "2026-10-04")).toBe(true);
    expect(FAL_MODEL_CATALOG[0]).toHaveProperty("explicitAspectRatio", true);
  });

  it("uses real native frames for both LTX target durations and silent pricing", () => {
    const eight = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, durationSeconds: 8});
    const ten = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, durationSeconds: 10});
    expect(eight).toMatchObject({numFrames: 193, framesPerSecond: 24, durationSeconds: 193 / 24, resolution: "720p", aspectRatio: "9:16", generateAudio: false});
    expect(ten).toMatchObject({numFrames: 241, durationSeconds: 241 / 24});
    expect(getFalModelCost(eight).reservedCostUsd).toBeCloseTo(.160833333333);
    expect(getFalModelCost(ten).reservedCostUsd).toBeCloseTo(.200833333333);
    expect(buildFalModelInput(ten, reference)).toEqual({image_url: reference.imageUrl, prompt: reference.prompt, seed: 42, resolution: "720p", aspect_ratio: "9:16", num_frames: 241, frame_rate: 24, enable_detail_pass: false, expand_prompt: false, enable_safety_checker: true});
  });

  it("rounds the requested duration to a supported Wan duration and reserves the higher published quote", () => {
    const settings = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.WAN_26_FLASH, durationSeconds: 8});
    expect(settings).toMatchObject({durationSeconds: 10, resolution: "720p", generateAudio: false});
    expect(getFalModelCost(settings)).toEqual({estimatedCostUsd: .25, reservedCostUsd: .5});
    expect(getFalModelCost(resolveFalModelSettings({model: settings.model, durationSeconds: 10, resolution: "1080p"}))).toEqual({estimatedCostUsd: .375, reservedCostUsd: .75});
    expect(buildFalModelInput(settings, reference)).toEqual({image_url: reference.imageUrl, prompt: reference.prompt, seed: 42, resolution: "720p", duration: "10", generate_audio: false, enable_prompt_expansion: false, multi_shots: false, enable_safety_checker: true});
  });

  it("uses only fields accepted by the actual Kling Standard endpoint", () => {
    const settings = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.KLING_25_STANDARD, durationSeconds: 8});
    expect(getFalModelCost(settings)).toEqual({estimatedCostUsd: .42, reservedCostUsd: .42});
    expect(buildFalModelInput(settings, reference)).toEqual({image_url: reference.imageUrl, prompt: reference.prompt, duration: "10", negative_prompt: "blur, distort, and low quality", cfg_scale: .5});
  });

  it("selects the supported 1080p LTX 2.3 output and turns audio off", () => {
    const settings = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_23_FAST, durationSeconds: 8});
    expect(settings).toMatchObject({durationSeconds: 8, resolution: "1080p", aspectRatio: "9:16"});
    expect(getFalModelCost(settings)).toEqual({estimatedCostUsd: .48, reservedCostUsd: .48});
    expect(buildFalModelInput(settings, reference)).toEqual({image_url: reference.imageUrl, prompt: reference.prompt, resolution: "1080p", aspect_ratio: "9:16", duration: "8", fps: 25, generate_audio: false});
  });

  it("keeps the legacy Turbo default without inventing its source duration", () => {
    const settings = resolveFalModelSettings({durationSeconds: 10});
    expect(settings).toMatchObject({model: FAL_MODEL_ENDPOINTS.WAN_22_TURBO, durationSeconds: null});
    expect(getFalModelCost(settings)).toEqual({estimatedCostUsd: .1, reservedCostUsd: .1});
    const payload = buildFalModelInput(settings, reference);
    expect(Object.keys(payload).includes("duration")).toBe(false);
    expect(Object.keys(payload).includes("num_frames")).toBe(false);
  });

  it("rejects unsupported endpoints, malformed settings and duration overflow before submission", () => {
    expect(() => resolveFalModelSettings({model: "fal-ai/unknown"})).toThrow("Unsupported video model");
    expect(() => resolveFalModelSettings({resolution: "8k"})).toThrow("Invalid video resolution");
    expect(() => resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_23_FAST, aspectRatio: "1:1"})).toThrow("Invalid video aspect ratio");
    for (const durationSeconds of [0, 5, 7.99, 11, NaN, Infinity]) {
      for (const model of Object.values(FAL_MODEL_ENDPOINTS)) expect(() => resolveFalModelSettings({model, durationSeconds})).toThrow("Video duration");
    }
  });

  it("rejects an explicit unsupported source resolution instead of silently downgrading", () => {
    expect(() => resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, resolution: "1080p"})).toThrow("Unsupported video resolution");
    expect(() => resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_23_FAST, resolution: "720p"})).toThrow("Unsupported video resolution");
    expect(resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_23_FAST}).resolution).toBe("1080p");
  });

  it("restores every native target setting exactly without accepting altered frame or billing settings", () => {
    for (const model of Object.values(FAL_MODEL_ENDPOINTS)) for (const durationSeconds of [8, 10]) {
      const settings = resolveFalModelSettings({model, durationSeconds});
      expect(restoreFalModelSettings({...settings})).toEqual(settings);
    }
    const frames = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED});
    const seconds = resolveFalModelSettings({model: FAL_MODEL_ENDPOINTS.WAN_26_FLASH});
    const turbo = resolveFalModelSettings();
    const invalid = [
      {...frames, numFrames: 194, durationSeconds: 194 / 24},
      {...frames, numFrames: 1441, durationSeconds: 1441 / 24},
      {...frames, durationSeconds: 8},
      {...seconds, durationSeconds: 15},
      {...seconds, durationSeconds: 5},
      {...seconds, numFrames: 241},
      {...turbo, durationSeconds: 8},
      {...turbo, framesPerSecond: 24},
      {...turbo, generateAudio: true as unknown as false},
    ];
    for (const settings of invalid) {
      expect(() => restoreFalModelSettings(settings)).toThrow("Invalid saved video settings");
      expect(() => getFalModelCost(settings)).toThrow("Invalid saved video settings");
      expect(() => buildFalModelInput(settings, reference)).toThrow("Invalid saved video settings");
    }
  });
});
