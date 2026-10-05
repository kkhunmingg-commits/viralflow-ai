import { describe, expect, it, vi } from "vitest";
import { verifyFalBenchmarkPrices } from "./fal-pricing";
import { FAL_MODEL_ENDPOINTS } from "./fal-models";
import type { BenchmarkCandidate } from "../video-benchmark/types";

const candidate: BenchmarkCandidate = { id: "fal_ltx_distilled", provider: "fal",
  apiModel: FAL_MODEL_ENDPOINTS.LTX_098_DISTILLED, label: "Pricing test", resolution: "720p",
  expectedCostUsd: .160834, minimumCostUsd: .160834,
  sourceUrl: "https://fal.ai/models/fal-ai/ltxv-13b-098-distilled/image-to-video", availability: "READY", limitation: null };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

describe("read-only official fal pricing precheck with HTTP mocked", () => {
  it("requires credentials before any pricing request", async () => {
    const http = vi.fn();
    await expect(verifyFalBenchmarkPrices([candidate], "", http)).rejects.toThrow(/FAL_KEY/);
    expect(http).not.toHaveBeenCalled();
  });

  it("uses official pricing and estimate endpoints and reserves the largest verified liability", async () => {
    const http = vi.fn<typeof fetch>();
    http.mockResolvedValueOnce(response({ prices: [{ endpoint_id: candidate.apiModel, unit_price: .03, unit: "second", currency: "USD" }], has_more: false }));
    http.mockResolvedValueOnce(response({ total_cost: .3, currency: "USD" }));
    const verified = await verifyFalBenchmarkPrices([candidate], "test-only-credential", http);
    expect(String(http.mock.calls[0][0])).toMatch(/^https:\/\/api\.fal\.ai\/v1\/models\/pricing\?/);
    expect(http.mock.calls[1][0]).toBe("https://api.fal.ai/v1/models/pricing/estimate");
    expect(http.mock.calls[1][1]?.method).toBe("POST");
    const body = JSON.parse(String(http.mock.calls[1][1]?.body));
    expect(body).toMatchObject({ estimate_type: "unit_price", endpoints: { [candidate.apiModel]: { unit_quantity: 193 / 24 } } });
    expect(verified[0]).toMatchObject({ expectedCostUsd: .3, pricingUnit: "second", pricingUnitPriceUsd: .03 });
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls.every(call => !String(call[0]).includes("queue.fal.run"))).toBe(true);
  });

  it.each(["pixel", "credit", "unknown"])("rejects unverified %s billing units before an estimate or generation", async unit => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ prices: [{ endpoint_id: candidate.apiModel,
      unit_price: .02, unit, currency: "USD" }], has_more: false }));
    await expect(verifyFalBenchmarkPrices([candidate], "test-only-credential", http)).rejects.toThrow(/billing unit/);
    expect(http).toHaveBeenCalledOnce();
  });

  it("fails closed when the catalog price is missing", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ prices: [], has_more: false }));
    await expect(verifyFalBenchmarkPrices([candidate], "test-only-credential", http)).rejects.toThrow(/Missing current price/);
    expect(http).toHaveBeenCalledOnce();
  });

  it("rejects incomplete pricing responses", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ prices: [], has_more: true }));
    await expect(verifyFalBenchmarkPrices([candidate], "test-only-credential", http)).rejects.toThrow(/Incomplete pricing/);
    expect(http).toHaveBeenCalledOnce();
  });

  it("does not retry an unavailable pricing API", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ error: "unavailable" }, 503));
    await expect(verifyFalBenchmarkPrices([candidate], "test-only-credential", http)).rejects.toThrow(/Pricing precheck unavailable/);
    expect(http).toHaveBeenCalledOnce();
  });
});
