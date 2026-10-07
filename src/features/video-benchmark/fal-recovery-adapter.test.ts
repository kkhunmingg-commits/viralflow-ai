import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FalWanVideoProvider, type FalWanClient } from "../video/fal-wan";
import { FAL_MODEL_ENDPOINTS, resolveFalModelSettings, type FalModelSettings } from "../video/fal-models";
import { FalWan22TurboProvider } from "./direct-providers";
import { ProviderGenerationError } from "./runway-provider";
import type { BenchmarkCandidate, BenchmarkFixture, RemoteVideoRequest } from "./types";

vi.mock("@fal-ai/client", () => ({
  createFalClient: vi.fn(() => { throw new Error("Real fal SDK construction is forbidden in adapter tests"); }),
}));
vi.mock("@runwayml/sdk", () => ({
  default: class {},
  TaskFailedError: class extends Error {},
}));

const candidate: BenchmarkCandidate = {
  id: "fal_ltx_distilled", provider: "fal", apiModel: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED,
  label: "Mock recovery candidate", resolution: "720p", expectedCostUsd: .3, minimumCostUsd: .3,
  sourceUrl: "https://example.invalid/mock-catalog", availability: "READY", limitation: null,
};
const taskId = "saved-mock-request";
const videoUrl = "https://v3b.fal.media/mock-recovery.mp4";
const sourceBytes = new Uint8Array([0, 1, 2, 3, 4]);
const syntheticKey = "adapter-test-placeholder";
let directory: string;
let fixture: BenchmarkFixture;

function boundaries(settings?: FalModelSettings) {
  const upload = vi.fn<FalWanClient["upload"]>(async () => "https://example.invalid/mock-image.png");
  const submit = vi.fn<FalWanClient["submit"]>(async () => ({ request_id: taskId }));
  const status = vi.fn<FalWanClient["status"]>(async () => ({ status: "COMPLETED" }));
  const result = vi.fn<FalWanClient["result"]>(async () => ({
    requestId: taskId, data: { video: { url: videoUrl } },
  }));
  const download = vi.fn<typeof fetch>(async () => new Response(sourceBytes));
  const client = { upload, submit, status, result } satisfies FalWanClient;
  const provider = new FalWan22TurboProvider(candidate, syntheticKey, {
    settings, client, fetchImpl: download as typeof fetch,
    sleep: async () => {}, pollIntervalMs: 0, readRetryAttempts: 0,
  });
  return { provider, upload, submit, status, result, download };
}

function request(outputPath = join(directory, "provider-source.mp4")): RemoteVideoRequest {
  return { candidate, fixture, seed: 1001, outputPath };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unmocked network access is forbidden in adapter tests"); }));
  directory = await mkdtemp(join(tmpdir(), "viralflow-fal-adapter-"));
  const imagePath = join(directory, "mock-product.png");
  await writeFile(imagePath, "synthetic product bytes");
  fixture = { id: "mock-product", label: "Mock product", imagePath, prompt: "Preserve the product",
    renderInput: { productTitle: "Mock product", hook: "Mock hook", cta: "View product", overlay: [], scenes: [], template: "mock" } };
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (directory) {
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

describe("fal benchmark recovery adapter with all remote boundaries mocked", () => {
  it("polls and downloads a saved request without generating, uploading or submitting", async () => {
    const mock = boundaries();
    mock.status.mockResolvedValueOnce({ status: "IN_QUEUE" }).mockResolvedValueOnce({ status: "IN_PROGRESS" });
    const generate = vi.spyOn(FalWanVideoProvider.prototype, "generate");
    const outputPath = join(directory, "recovered-source.mp4");

    const recovered = await mock.provider.retrieve({ taskId, outputPath });

    expect(recovered).toMatchObject({ taskId, provider: "fal", model: candidate.apiModel,
      outputPath, remoteUrl: videoUrl, recordedCostUsd: null, costBasis: "ESTIMATED", retryCount: 0 });
    expect(await readFile(outputPath)).toEqual(Buffer.from(sourceBytes));
    expect(mock.status).toHaveBeenCalledTimes(3);
    expect(mock.status.mock.calls.every(([endpoint, id]) => endpoint === candidate.apiModel && id === taskId)).toBe(true);
    expect(mock.result).toHaveBeenCalledOnce();
    expect(mock.download).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledTimes(0);
    expect(mock.upload).toHaveBeenCalledTimes(0);
    expect(mock.submit).toHaveBeenCalledTimes(0);
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("recovers the saved native duration, frame count, resolution and aspect ratio independently of current defaults", async () => {
    const savedSettings = { ...resolveFalModelSettings({ model: candidate.apiModel, durationSeconds: 10,
      resolution: "480p", aspectRatio: "1:1" }) };
    const originalSettings = { ...savedSettings };
    const mock = boundaries(savedSettings);
    savedSettings.durationSeconds = 8;
    savedSettings.numFrames = 193;
    const exposedSettings = mock.provider.getSettings();
    expect(exposedSettings).toEqual(originalSettings);
    exposedSettings.aspectRatio = "16:9";

    const recovered = await mock.provider.retrieve({ taskId, outputPath: join(directory, "native-source.mp4") });

    expect(mock.provider.getSettings()).toEqual(originalSettings);
    expect(originalSettings).toMatchObject({ numFrames: 241, framesPerSecond: 24, resolution: "480p", aspectRatio: "1:1" });
    expect(recovered.costUsd).toBeCloseTo(241 / 24 * .02, 12);
    expect(mock.status.mock.calls[0]).toEqual([originalSettings.model, taskId, expect.any(AbortSignal)]);
    expect(mock.submit).toHaveBeenCalledTimes(0);
    expect(mock.upload).toHaveBeenCalledTimes(0);
  });

  it("preserves existing provider source bytes when retrieval is repeated", async () => {
    const mock = boundaries();
    const outputPath = join(directory, "existing-source.mp4");
    const originalBytes = Buffer.from("the original provider artifact");
    await writeFile(outputPath, originalBytes);

    const first = await mock.provider.retrieve({ taskId, outputPath });
    const second = await mock.provider.retrieve({ taskId, outputPath });

    expect(first).toMatchObject({ taskId, outputPath });
    expect(second).toMatchObject({ taskId, outputPath });
    expect(await readFile(outputPath)).toEqual(originalBytes);
    expect(mock.submit).toHaveBeenCalledTimes(0);
    expect(mock.upload).toHaveBeenCalledTimes(0);
  });

  it("writes the original source bytes and forwards the accepted identity for a mocked generation", async () => {
    const mock = boundaries();
    const onSubmitted = vi.fn(async (id: string) => {
      expect(id).toBe(taskId);
      expect(mock.status).toHaveBeenCalledTimes(0);
    });
    const generationRequest = { ...request(), onSubmitted };

    const generated = await mock.provider.generate(generationRequest);

    expect(await readFile(generationRequest.outputPath)).toEqual(Buffer.from(sourceBytes));
    expect(generated).toMatchObject({ taskId, outputPath: generationRequest.outputPath, retryCount: 0 });
    expect(onSubmitted).toHaveBeenCalledExactlyOnceWith(taskId);
    expect(mock.submit).toHaveBeenCalledOnce();
  });

  it("rejects source collisions during generation without overwriting the earlier artifact", async () => {
    const mock = boundaries();
    const generationRequest = request();
    const originalBytes = Buffer.from("earlier immutable provider source");
    await writeFile(generationRequest.outputPath, originalBytes);

    await expect(mock.provider.generate(generationRequest)).rejects.toMatchObject({
      name: "ProviderGenerationError", taskId, terminalConfirmed: true,
      costUsd: expect.closeTo(193 / 24 * .02, 12),
    });

    expect(await readFile(generationRequest.outputPath)).toEqual(originalBytes);
    expect(mock.submit).toHaveBeenCalledOnce();
  });

  it.each(["generate", "retrieve"] as const)("forwards a confirmed terminal failure from %s with its identity and conservative cost", async operation => {
    const mock = boundaries();
    mock.status.mockResolvedValueOnce({ status: "FAILED" });
    const action = operation === "generate" ? mock.provider.generate(request())
      : mock.provider.retrieve({ taskId, outputPath: request().outputPath });

    await expect(action).rejects.toBeInstanceOf(ProviderGenerationError);
    await expect(action).rejects.toMatchObject({ taskId, terminalConfirmed: true, costUsd: expect.closeTo(193 / 24 * .02, 12) });
    expect(mock.result).toHaveBeenCalledTimes(0);
    expect(mock.download).toHaveBeenCalledTimes(0);
    expect(mock.submit).toHaveBeenCalledTimes(operation === "generate" ? 1 : 0);
  });

  it("retains a confirmed completed request and its liability when its media download fails", async () => {
    const mock = boundaries();
    mock.download.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(mock.provider.retrieve({ taskId, outputPath: request().outputPath }))
      .rejects.toMatchObject({ taskId, terminalConfirmed: true, costUsd: expect.closeTo(193 / 24 * .02, 12) });

    expect(mock.submit).toHaveBeenCalledTimes(0);
    expect(mock.upload).toHaveBeenCalledTimes(0);
  });

  it("retains uncertainty and liability when the saved request cannot be polled", async () => {
    const mock = boundaries();
    mock.status.mockRejectedValueOnce(new Error("mock status unavailable"));

    await expect(mock.provider.retrieve({ taskId, outputPath: request().outputPath }))
      .rejects.toMatchObject({ taskId, terminalConfirmed: false, costUsd: expect.closeTo(193 / 24 * .02, 12) });

    expect(mock.result).toHaveBeenCalledTimes(0);
    expect(mock.submit).toHaveBeenCalledTimes(0);
    expect(mock.upload).toHaveBeenCalledTimes(0);
  });
});
