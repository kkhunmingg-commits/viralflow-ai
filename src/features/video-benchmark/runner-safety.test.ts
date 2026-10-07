import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkJournal } from "./journal";
import { runVideoProviderBenchmark, type RunBenchmarkInput } from "./runner";
import { ProviderGenerationError } from "./runway-provider";
import type { BenchmarkCandidate, BenchmarkFixture, BenchmarkSample, RemoteVideoRequest } from "./types";

const mock = vi.hoisted(() => ({ generate: vi.fn(), retrieve: vi.fn(), construct: vi.fn(), normalize: vi.fn() }));
vi.mock("./direct-providers", () => {
  class Provider { constructor(...args:unknown[]){mock.construct(...args)} generate = mock.generate; retrieve = mock.retrieve; }
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
  mock.retrieve.mockImplementation(async ({taskId,outputPath}:{taskId:string;outputPath:string}) => ({
    taskId,provider:"fal",model:candidate.apiModel,outputPath,costUsd:.16,latencyMs:1000,
    remoteUrl:"https://example.invalid/recovered.mp4",retryCount:0,
  }));
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
    expect(mock.generate).toHaveBeenCalledTimes(0);
  });

  it("writes durable liability before its one paid submission and records the accepted request", async () => {
    mock.generate.mockImplementationOnce(async (request: RemoteVideoRequest) => {
      const pending = JSON.parse(await readFile(join(directory, "benchmark-journal.json"), "utf8"));
      expect(pending.samples[0]).toMatchObject({ submissionState: "ATTEMPT_RESERVED", generationCount: 1, actualCostUsd: .2, taskId: null });
      expect(pending.samples[0]).toMatchObject({inputPath:fixture.imagePath,endpoint:candidate.apiModel,
        nativeSettings:{model:candidate.apiModel,numFrames:193,framesPerSecond:24},
        plannedSourcePath:join(directory,"fal_ltx_distilled-product-1-source.mp4"),
        plannedOutputPath:join(directory,"fal_ltx_distilled-product-1.mp4")});
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
    expect(mock.generate).toHaveBeenCalledTimes(0);
  });

  it("refuses changed product input on resume without paying again", async () => {
    await history(sample({ status: "COMPLETED" }));
    await writeFile(fixture.imagePath, "different product image bytes");
    await expect(runVideoProviderBenchmark(input)).rejects.toThrow(/input changed/);
    expect(mock.generate).toHaveBeenCalledTimes(0);
  });

  it("reuses a terminal attempt after a live quote changes without changing its original reserve", async () => {
    await history(sample({status:"COMPLETED"}));
    const report=await runVideoProviderBenchmark({...input,candidates:[{...candidate,expectedCostUsd:.3}]});
    expect(report.samples[0]).toMatchObject({expectedCostUsd:.2,actualCostUsd:.2,status:"COMPLETED"});
    expect(mock.generate).toHaveBeenCalledTimes(0);
  });

  it("recovers a saved request with original settings and reserve, with zero additional paid calls", async () => {
    mock.generate.mockImplementationOnce(async (request:RemoteVideoRequest)=>{
      await request.onSubmitted?.("pending-request");throw new Error("status request unavailable");
    });
    await runVideoProviderBenchmark(input);
    mock.generate.mockClear();mock.construct.mockClear();
    const second:BenchmarkCandidate={...candidate,id:"fal_ltx_2_3_fast",apiModel:"fal-ai/ltx-2.3/image-to-video/fast"};
    const report=await runVideoProviderBenchmark({...input,execute:false,recoverOnly:true,candidates:[{...candidate,expectedCostUsd:.4},second]});
    expect(mock.generate).toHaveBeenCalledTimes(0);expect(mock.retrieve).toHaveBeenCalledOnce();
    expect(mock.retrieve).toHaveBeenCalledWith({taskId:"pending-request",outputPath:join(directory,"fal_ltx_distilled-product-1-source.mp4")});
    expect(mock.construct.mock.calls[0][2]).toMatchObject({settings:{model:candidate.apiModel,numFrames:193,framesPerSecond:24}});
    expect(report.samples[0]).toMatchObject({status:"COMPLETED",submissionState:"TERMINAL",generationCount:1,expectedCostUsd:.2,actualCostUsd:.2,latencyMs:null,recoveryLatencyMs:1000});
    expect(report.samples[1]).toMatchObject({status:"SKIPPED",generationCount:0});
    await expect(runVideoProviderBenchmark(input)).resolves.toMatchObject({samples:[{status:"COMPLETED"}]});
    expect(mock.generate).toHaveBeenCalledTimes(0);
  });

  it("keeps a lost submission response unresolved during recovery and never substitutes a new request", async () => {
    mock.generate.mockRejectedValueOnce(new Error("lost response"));await runVideoProviderBenchmark(input);
    mock.generate.mockClear();
    const report=await runVideoProviderBenchmark({...input,execute:false,recoverOnly:true});
    expect(report.samples[0]).toMatchObject({submissionState:"UNKNOWN",taskId:null,generationCount:1,expectedCostUsd:.2});
    expect(mock.generate).toHaveBeenCalledTimes(0);expect(mock.retrieve).toHaveBeenCalledTimes(0);
    await expect(runVideoProviderBenchmark(input)).rejects.toThrow(/reconciliation/);
  });

  it("rejects paid execution combined with recovery before any provider boundary", async () => {
    await expect(runVideoProviderBenchmark({...input,recoverOnly:true})).rejects.toThrow(/cannot enable paid/);
    expect(mock.generate).toHaveBeenCalledTimes(0);expect(mock.retrieve).toHaveBeenCalledTimes(0);
  });

  it("requires original native settings before recovering a legacy pending sample", async () => {
    await history(sample({submissionState:"SUBMITTED"}));
    await expect(runVideoProviderBenchmark({...input,execute:false,recoverOnly:true})).rejects.toThrow(/original endpoint/);
    expect(mock.generate).toHaveBeenCalledTimes(0);expect(mock.retrieve).toHaveBeenCalledTimes(0);
  });

  it("retains a higher observed bill durably before halting later generations", async () => {
    mock.generate.mockResolvedValueOnce({taskId:"over-reserve",provider:"fal",model:candidate.apiModel,
      outputPath:"test.mp4",costUsd:.3,recordedCostUsd:.35,costBasis:"PROVIDER_RECORDED",latencyMs:1000,remoteUrl:"https://example.invalid/result.mp4"});
    const second:BenchmarkCandidate={...candidate,id:"fal_kling_2_5_standard"};
    const report=await runVideoProviderBenchmark({...input,candidates:[candidate,second]});
    const durable=JSON.parse(await readFile(join(directory,"benchmark-journal.json"),"utf8"));
    expect(durable.samples[0]).toMatchObject({actualCostUsd:.3,recordedCostUsd:.35,costBasis:"PROVIDER_RECORDED",taskId:"over-reserve",submissionState:"TERMINAL",status:"FAILED",sourcePath:join(directory,"fal_ltx_distilled-product-1-source.mp4")});
    expect(report.samples[1]).toMatchObject({status:"SKIPPED",generationCount:0});
    expect(mock.generate).toHaveBeenCalledOnce();
  });

  it("retains confirmed terminal failure liability and permits a distinct request within budget", async () => {
    mock.generate.mockRejectedValueOnce(new ProviderGenerationError("confirmed failure","failed-request",.2,true));
    const second:BenchmarkCandidate={...candidate,id:"fal_kling_2_5_standard",apiModel:"fal-ai/kling-video/v2.5-turbo/standard/image-to-video"};
    const report=await runVideoProviderBenchmark({...input,candidates:[candidate,second]});
    expect(report.samples[0]).toMatchObject({status:"FAILED",submissionState:"TERMINAL",actualCostUsd:.2});
    expect(report.samples[1].status).toBe("COMPLETED");expect(mock.generate).toHaveBeenCalledTimes(2);
  });

  it("includes prior failed liability when deciding whether another clip fits the cap", async () => {
    await history(sample({ id: "older-paid-generation", actualCostUsd: 4.9, expectedCostUsd: 4.9 }));
    const report = await runVideoProviderBenchmark(input);
    expect(report.samples[0]).toMatchObject({ status: "SKIPPED", generationCount: 0 });
    expect(mock.generate).toHaveBeenCalledTimes(0);
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
    expect(mock.generate).toHaveBeenCalledTimes(0);
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
