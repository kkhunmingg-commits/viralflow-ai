import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BenchmarkJournal, benchmarkLiability } from "./journal";
import type { BenchmarkCandidate, BenchmarkFixture, BenchmarkSample } from "./types";

const candidate: BenchmarkCandidate = { id: "fal_ltx_distilled", provider: "fal", apiModel: "fal-ai/ltxv-13b-098-distilled/image-to-video",
  label: "Test candidate", resolution: "720p", expectedCostUsd: .2, minimumCostUsd: .2,
  sourceUrl: "https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video", availability: "READY", limitation: null };
const sample = (patch: Partial<BenchmarkSample> = {}): BenchmarkSample => ({
  id: "fal_ltx_distilled:product:1", fixtureId: "product", candidateId: candidate.id, repeat: 1, seed: 1001,
  expectedCostUsd: .2, actualCostUsd: .2, latencyMs: null, taskId: "test-request", inputPath: null,
  sourcePath: null, outputPath: null, sourceDurationSeconds: null, normalizedDurationSeconds: null,
  technical: null, human: null, humanScore: null, status: "FAILED", generationCount: 1,
  quotaUsage: null, humanLaborRequired: false, sourceKind: "PROVIDER_API", error: "Test failure",
  submissionState: "TERMINAL", ...patch,
});
let directory: string;
let fixture: BenchmarkFixture;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "viralflow-journal-test-"));
  const imagePath = join(directory, "test-reference.png");
  await writeFile(imagePath, "synthetic test image bytes; no provider is called");
  fixture = { id: "product", label: "Test fixture", imagePath, prompt: "Preserve this product",
    renderInput: { productTitle: "Test product", hook: "Test hook", cta: "View product", overlay: [], scenes: [], template: "test" } };
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("durable benchmark spend journal", () => {
  it("counts failed generations and uncertain estimated liability", () => {
    expect(benchmarkLiability(sample({ actualCostUsd: .15, recordedCostUsd: null, costBasis: "ESTIMATED" }))).toBe(.2);
    expect(benchmarkLiability(sample({ actualCostUsd: .25, recordedCostUsd: null, costBasis: "ESTIMATED" }))).toBe(.25);
    expect(benchmarkLiability(sample({ actualCostUsd: .15, recordedCostUsd: .15, costBasis: "PROVIDER_RECORDED" }))).toBe(.15);
    expect(benchmarkLiability(sample({ actualCostUsd: .15, recordedCostUsd: .15 }))).toBe(.2);
    expect(benchmarkLiability(sample({ actualCostUsd: null, submissionState: "UNKNOWN" }))).toBe(.2);
    expect(benchmarkLiability(sample({ actualCostUsd: null, generationCount: 0, status: "PLANNED" }))).toBe(0);
  });

  it("allows only one benchmark worker per output directory", async () => {
    const first = await BenchmarkJournal.acquire(directory);
    try { await expect(BenchmarkJournal.acquire(directory)).rejects.toMatchObject({ code: "EEXIST" }); }
    finally { await first.close(); }
    const later = await BenchmarkJournal.acquire(directory);
    await later.close();
  });

  it.each(["ATTEMPT_RESERVED", "SUBMITTED", "UNKNOWN"] as const)("blocks paid resume of %s liability", async submissionState => {
    const writer = await BenchmarkJournal.acquire(directory);
    await writer.save(sample({ submissionState }));
    await writer.close();
    await expect(BenchmarkJournal.acquire(directory)).rejects.toThrow(/reconciliation/);
    await expect(readFile(join(directory, "benchmark.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("persists a pending attempt and input hash before a paid boundary can run", async () => {
    const writer = await BenchmarkJournal.acquire(directory);
    try {
      await writer.checkInput(sample().id, candidate, fixture, 1);
      await writer.save(sample({ taskId: null, submissionState: "ATTEMPT_RESERVED" }));
      const durable = JSON.parse(await readFile(join(directory, "benchmark-journal.json"), "utf8"));
      expect(durable.samples[0]).toMatchObject({ generationCount: 1, submissionState: "ATTEMPT_RESERVED", actualCostUsd: .2 });
      expect(durable.fingerprints[sample().id]).toMatch(/^[a-f0-9]{64}$/);
    } finally { await writer.close(); }
  });

  it.each(["image", "prompt", "endpoint", "resolution", "cost", "repeat"])("refuses changed %s input after a terminal attempt", async changed => {
    const writer = await BenchmarkJournal.acquire(directory);
    await writer.checkInput(sample().id, candidate, fixture, 1);
    await writer.save(sample());
    await writer.close();
    const reader = await BenchmarkJournal.acquire(directory);
    try {
      if (changed === "image") await writeFile(fixture.imagePath, "different product image");
      const updatedCandidate = { ...candidate,
        ...(changed === "endpoint" ? { apiModel: "changed-endpoint" } : {}),
        ...(changed === "resolution" ? { resolution: "1080p" } : {}),
        ...(changed === "cost" ? { expectedCostUsd: .3 } : {}) };
      const updatedFixture = { ...fixture, ...(changed === "prompt" ? { prompt: "Different motion" } : {}) };
      await expect(reader.checkInput(sample().id, updatedCandidate, updatedFixture, changed === "repeat" ? 2 : 1))
        .rejects.toThrow(/input changed/);
    } finally { await reader.close(); }
  });

  it("merges completed history without dropping an existing failed liability", async () => {
    const writer = await BenchmarkJournal.acquire(directory);
    await writer.save(sample());
    await writer.close();
    const reader = await BenchmarkJournal.acquire(directory, [sample({ id: "another", status: "COMPLETED" })]);
    try { expect(reader.samples.map(row => row.id)).toEqual([sample().id, "another"]); }
    finally { await reader.close(); }
  });

  it("checks pending liability introduced by merged resume history", async () => {
    const writer = await BenchmarkJournal.acquire(directory);
    await writer.save(sample());
    await writer.close();
    await expect(BenchmarkJournal.acquire(directory, [sample({ id: "another", submissionState: "UNKNOWN" })]))
      .rejects.toThrow(/reconciliation/);
  });

  it("rejects a corrupt negative liability before enabling paid resume", async () => {
    await writeFile(join(directory, "benchmark-journal.json"), JSON.stringify({
      version: 1, fingerprints: {}, samples: [sample({ actualCostUsd: -.2 })],
    }));
    await expect(BenchmarkJournal.acquire(directory)).rejects.toThrow(/invalid.*liability|invalid.*journal/i);
  });

  it("rejects an invalid recorded cost before enabling paid resume", async () => {
    await writeFile(join(directory, "benchmark-journal.json"), JSON.stringify({
      version: 1, fingerprints: {}, samples: [sample({ recordedCostUsd: -.1, costBasis: "PROVIDER_RECORDED" })],
    }));
    await expect(BenchmarkJournal.acquire(directory)).rejects.toThrow(/invalid.*liability/i);
  });
});
