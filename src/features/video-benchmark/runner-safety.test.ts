import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkJournal } from "./journal";
import { runVideoProviderBenchmark, type RunBenchmarkInput } from "./runner";
import type { BenchmarkCandidate, BenchmarkFixture, BenchmarkSample, RemoteVideoRequest } from "./types";

const mock = vi.hoisted(() => ({ generate: vi.fn(), normalize: vi.fn() }));
vi.mock("./direct-providers", () => {
  class Provider { generate = mock.generate; }
  return { FalWan22TurboProvider: Provider, PixVerseProvider: Provider, TikTokSymphonyProvider: Provider };
});
vi.mock("./provider-normalization", () => ({ normalizeProviderBenchmarkClip: mock.normalize }));

const candidate: BenchmarkCandidate = { id: "fal_ltx_distilled", provider: "fal", apiModel: "fal-ai/ltxv-13b-098-distilled/image-to-video",
  label: "Test candidate", resolution: "720p", expectedCostUsd: .2, minimumCostUsd: .2,
  sourceUrl: "https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video", availability: "READY", limitation: null };
const media = { path: "test.mp4", duration: 8, width: 720, height: 1280, fps: 30,
  videoCodec: "h264", audioCodec: null, hasAudio: false, sizeBytes: 100_000 };
let directory: string;
let fixture: BenchmarkFixture;
let input: RunBenchmarkInput;

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "viralflow-benchmark-safety-"));
  const imagePath = join(directory, "test-reference.png");
  await writeFile(imagePath, "synthetic test image bytes; all paid boundaries are mocked");
  fixture = { id: "product", label: "Test fixture", imagePath, prompt: "Preserve this product",
    renderInput: { productTitle: "Test product", hook: "Test hook", cta: "View product", overlay: [], scenes: [], template: "test" } };
  input = { candidates: [candidate], fixtures: [fixture], repeats: 1, execute: true,
    budgetCapUsd: 5, hardMaxUsd: 5, outputDir: directory, ownerFlowReferenceProvided: false };
  mock.generate.mockImplementation(async (request: RemoteVideoRequest) => {
    await request.onSubmitted?.("mock-request");
    return { taskId: "mock-request", provider: "fal", model: request.candidate.apiModel,
      outputPath: request.outputPath, costUsd: request.candidate.expectedCostUsd,
      latencyMs: 1000, remoteUrl: "https://example.invalid/test.mp4", retryCount: 0 };
  });
  mock.normalize.mockResolvedValue({ source: media, normalized: media, outputPath: "test.mp4", reason: null });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const sample = (patch: Partial<BenchmarkSample> = {}): BenchmarkSample => ({
  id: "fal_ltx_distilled:product:1", fixtureId: "product", candidateId: candidate.id, repeat: 1, seed: 1001,
  expectedCostUsd: .2, actualCostUsd: .2, latencyMs: null, taskId: "known-request", inputPath: null,
  sourcePath: null, outputPath: null, sourceDurationSeconds: null, normalizedDurationSeconds: null,
  technical: null, human: null, humanScore: null, status: "FAILED", generationCount: 1,
  quotaUsage: null, humanLaborRequired: false, sourceKind: "PROVIDER_API", error: "Test failure",
  submissionState: "TERMINAL", ...patch,
});
async function history(row: BenchmarkSample) {
  const writer = await BenchmarkJournal.acquire(directory);
  await writer.checkInput(row.id, candidate, fixture, 1);
  await writer.save(row);
  await writer.close();
}

describe("benchmark paid-call safety with provider/network boundaries mocked", () => {
  it("rejects a fresh forecast above the five-dollar hard maximum before any provider call", async () => {
    await expect(runVideoProviderBenchmark({ ...input, budgetCapUsd: 100,
      candidates: [{ ...candidate, expectedCostUsd: 5.01 }] })).rejects.toThrow(/exceeds benchmark cap 5.00/);
    expect(mock.generate).not.toHaveBeenCalled();
  });

  it("writes durable liability before its one paid submission and records the accepted request", async () => {
    mock.generate.mockImplementationOnce(async (request: RemoteVideoRequest) => {
      const pending = JSON.parse(await readFile(join(directory, "benchmark-journal.json"), "utf8"));
      expect(pending.samples[0]).toMatchObject({ submissionState: "ATTEMPT_RESERVED", generationCount: 1, actualCostUsd: .2, taskId: null });
      await request.onSubmitted?.("accepted-request");
      const submitted = JSON.parse(await readFile(join(directory, "benchmark-journal.json"), "utf8"));
      expect(submitted.samples[0]).toMatchObject({ submissionState: "SUBMITTED", taskId: "accepted-request" });
      return { taskId: "accepted-request", provider: "fal", model: candidate.apiModel,
        outputPath: request.outputPath, costUsd: .2, latencyMs: 1000, remoteUrl: "https://example.invalid/test.mp4" };
    });
    const report = await runVideoProviderBenchmark(input);
    expect(report.samples[0]).toMatchObject({ status: "COMPLETED", generationCount: 1, retryCount: 0, submissionState: "TERMINAL" });
    expect(mock.generate).toHaveBeenCalledOnce();
  });

  it("halts remaining candidates after an unknown submission and blocks paid resume", async () => {
    mock.generate.mockRejectedValueOnce(new Error("connection closed after send"));
    const second: BenchmarkCandidate = { ...candidate, id: "fal_kling_2_5_standard", apiModel: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video" };
    const report = await runVideoProviderBenchmark({ ...input, candidates: [candidate, second] });
    expect(report.samples[0]).toMatchObject({ status: "FAILED", submissionState: "UNKNOWN", actualCostUsd: .2 });
    expect(report.samples[1]).toMatchObject({ status: "SKIPPED", generationCount: 0 });
    await expect(runVideoProviderBenchmark({ ...input, candidates: [candidate, second] })).rejects.toThrow(/reconciliation/);
    expect(mock.generate).toHaveBeenCalledOnce();
  });

  it.each(["FAILED", "COMPLETED"] as const)("never makes another paid call for a terminal %s sample", async status => {
    await history(sample({ status }));
    const report = await runVideoProviderBenchmark(input);
    expect(report.samples[0].status).toBe(status);
    expect(mock.generate).not.toHaveBeenCalled();
  });

  it("refuses changed product input on resume without paying again", async () => {
    await history(sample({ status: "COMPLETED" }));
    await writeFile(fixture.imagePath, "different product image bytes");
    await expect(runVideoProviderBenchmark(input)).rejects.toThrow(/input changed/);
    expect(mock.generate).not.toHaveBeenCalled();
  });

  it("includes prior failed liability when deciding whether another clip fits the cap", async () => {
    await history(sample({ id: "older-paid-generation", actualCostUsd: 4.9, expectedCostUsd: 4.9 }));
    const report = await runVideoProviderBenchmark(input);
    expect(report.samples[0]).toMatchObject({ status: "SKIPPED", generationCount: 0 });
    expect(mock.generate).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "FAILED"] as const)("keeps the authenticated reserve when a %s clip only returns a lower estimate", async status => {
    await history(sample({ id: "older-paid-generation", actualCostUsd: .6, expectedCostUsd: .6 }));
    const second: BenchmarkCandidate = { ...candidate, id: "fal_kling_2_5_standard" };
    mock.generate.mockResolvedValueOnce({ taskId: "estimated-request", provider: "fal", model: candidate.apiModel,
      outputPath: "test.mp4", costUsd: .05, recordedCostUsd: null, costBasis: "ESTIMATED",
      latencyMs: 1000, remoteUrl: "https://example.invalid/test.mp4" });
    if (status === "FAILED") mock.normalize.mockRejectedValueOnce(new Error("normalization failed after provider completion"));
    const report = await runVideoProviderBenchmark({ ...input, candidates: [candidate, second], budgetCapUsd: .9 });
    expect(report.samples[0]).toMatchObject({ status, actualCostUsd: .05, recordedCostUsd: null });
    expect(report.samples[1]).toMatchObject({ status: "SKIPPED", generationCount: 0 });
    expect(mock.generate).toHaveBeenCalledOnce();
  });

  it("keeps prior failed estimated attempts at their original reserve on resume", async () => {
    await history(sample({ id: "older-paid-generation", actualCostUsd: .1, expectedCostUsd: .8,
      recordedCostUsd: null, costBasis: "ESTIMATED" }));
    const report = await runVideoProviderBenchmark({ ...input, budgetCapUsd: .9 });
    expect(report.samples[0]).toMatchObject({ status: "SKIPPED", generationCount: 0 });
    expect(mock.generate).not.toHaveBeenCalled();
  });

  it("uses a lower provider-recorded bill when deciding whether another clip fits", async () => {
    await history(sample({ id: "older-paid-generation", actualCostUsd: .6, expectedCostUsd: .6 }));
    mock.generate.mockResolvedValueOnce({ taskId: "billed-request", provider: "fal", model: candidate.apiModel,
      outputPath: "test.mp4", costUsd: .05, recordedCostUsd: .05, costBasis: "PROVIDER_RECORDED",
      latencyMs: 1000, remoteUrl: "https://example.invalid/test.mp4" });
    const report = await runVideoProviderBenchmark({ ...input,
      candidates: [candidate, { ...candidate, id: "fal_kling_2_5_standard" }], budgetCapUsd: .9 });
    expect(report.samples.map(row => row.status)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(mock.generate).toHaveBeenCalledTimes(2);
  });

  it("blocks a concurrent run before a second worker reaches the paid boundary", async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    let releaseProvider!: () => void;
    const release = new Promise<void>(resolve => { releaseProvider = resolve; });
    mock.generate.mockImplementationOnce(async (request: RemoteVideoRequest) => {
      notifyStarted();
      await release;
      return { taskId: "concurrent-request", provider: "fal", model: candidate.apiModel,
        outputPath: request.outputPath, costUsd: .2, latencyMs: 1000, remoteUrl: "https://example.invalid/test.mp4" };
    });
    const first = runVideoProviderBenchmark(input);
    await started;
    try { await expect(runVideoProviderBenchmark(input)).rejects.toMatchObject({ code: "EEXIST" }); }
    finally { releaseProvider(); await first; }
    expect(mock.generate).toHaveBeenCalledOnce();
  });
});
