import { describe, expect, it, vi } from "vitest";
import { MockFrameVisionProvider, OpenAIFrameVisionProvider, verifyVideoFrames, type FrameVisionInput } from "./frame-verification";
import { DeterministicVideoQualityEvaluator } from "./quality";
import type { VideoQualityInput } from "./types";

const image = new Uint8Array([0xff, 0xd8, ...Array(128).fill(17), 0xff, 0xd9]);
const input: FrameVisionInput = { referenceImage: image,
  frames: [.75, 4, 7.25].map(atSeconds => ({ atSeconds, jpeg: image })),
  productTitle: "Fictional Test Product", expectedText: ["View details"] };
const media = { path: "actual.mp4", duration: 8, width: 720, height: 1280, fps: 30,
  videoCodec: "h264", audioCodec: "aac", hasAudio: true, sizeBytes: 100_000,
  overlay: [], scenes: [{ start: 0, end: 2, visual: "hook", motion: "pan" },
    { start: 2, end: 5, visual: "product", motion: "zoom" },
    { start: 5, end: 8, visual: "cta", motion: "hold" }],
  productVisible: true, ctaVisible: true, malformedAssets: false, inheritedRisk: "SAFE" } satisfies VideoQualityInput;

describe("actual-frame verification boundary", () => {
  it("fails closed without a production vision provider", async () => {
    const result = await verifyVideoFrames(input, null);
    expect(result).toMatchObject({ status: "REVIEW", reason: "VISION_PROVIDER_UNAVAILABLE" });
    expect(result.evidence.map(frame => frame.atSeconds)).toEqual([.75, 4, 7.25]);
    expect(new DeterministicVideoQualityEvaluator().evaluate({ ...media, visualVerification: result }))
      .toMatchObject({ status: "RETRY", explanation: { visualVerificationStatus: "REVIEW" } });
  });

  it("uses a deterministic mock only after receiving three extracted-image inputs", async () => {
    const provider = new MockFrameVisionProvider(), result = await verifyVideoFrames(input, provider);
    expect(provider.inputs).toHaveLength(1);
    expect(result).toMatchObject({ status: "PASS", provider: "mock-vision", evidence: [{ atSeconds: .75 }, { atSeconds: 4 }, { atSeconds: 7.25 }] });
    expect(new DeterministicVideoQualityEvaluator().evaluate({ ...media, visualVerification: result }).status).toBe("PASS");
    const incomplete = await verifyVideoFrames({ ...input, frames: input.frames.slice(0, 2) }, provider);
    expect(incomplete.status).toBe("REVIEW");
    expect(provider.inputs).toHaveLength(1);
  });

  it("rejects clear substitution or unsafe text and holds uncertain checks for review", async () => {
    const failure = await verifyVideoFrames(input, new MockFrameVisionProvider({ productVisible: false, ctaVisible: false,
      checks: { shape: "FAIL", colors: "PASS", packaging: "PASS", details: "PASS", deformation: "PASS", visibleText: "FAIL", commercialSafety: "FAIL" },
      reasons: ["Product differs from reference", "Misleading visible claim"] }));
    expect(failure.status).toBe("FAIL");
    expect(new DeterministicVideoQualityEvaluator().evaluate({ ...media, visualVerification: failure }).status).toBe("REJECT");
    const uncertain = await verifyVideoFrames(input, new MockFrameVisionProvider({ productVisible: true, ctaVisible: true,
      checks: { shape: "PASS", colors: "PASS", packaging: "REVIEW", details: "PASS", deformation: "PASS", visibleText: "PASS", commercialSafety: "PASS" },
      reasons: ["Packaging obscured"] }));
    expect(uncertain.status).toBe("REVIEW");
    expect(new DeterministicVideoQualityEvaluator().evaluate({ ...media, visualVerification: uncertain }).status).toBe("RETRY");
  });

  it("sends only reference plus sampled frames to the existing OpenAI Responses boundary", async () => {
    const assessment = { productVisible: true, ctaVisible: true,
      checks: { shape: "PASS", colors: "PASS", packaging: "PASS", details: "PASS", deformation: "PASS", visibleText: "PASS", commercialSafety: "PASS" }, reasons: [] };
    const network = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body)) as { input: Array<{ content: Array<{ type: string }> }> };
      expect(body.input[0]?.content.filter(part => part.type === "input_image")).toHaveLength(4);
      expect(String(request.body)).not.toContain("secret-test-key");
      return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify(assessment) }),
        { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new OpenAIFrameVisionProvider("secret-test-key", "gpt-4.1-mini", network as typeof fetch);
    expect(await verifyVideoFrames(input, provider)).toMatchObject({ status: "PASS", provider: "openai", model: "gpt-4.1-mini" });
    expect(network).toHaveBeenCalledOnce();
  });
});
