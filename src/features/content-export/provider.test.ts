import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertFalAssetUrl, ContentProvider, endpoints, paidStep } from "./provider";
const idea = { title: "หัวข้อ", hook: "ลองคิดดู", script: "เรื่องเล็ก ๆ ทำให้วันของเราดีขึ้นได้", caption: "ไอเดียวันนี้", hashtags: ["#ไอเดีย"], imagePrompt: "A tidy desk, natural light", videoPrompt: "Slow gentle camera push", rationale: "เรื่องใกล้ตัว" };
describe("bounded real provider contracts", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("uses the supported reasoning endpoint with tools/search disabled and bounded tokens", () => {
    const step = paidStep("IDEA", { prompt: "context", model: "google/gemini-2.5-flash-lite" });
    expect(step.endpoint).toBe("openrouter/router"); expect(step.input.enable_web_search).toBe(false);
    expect(step.input.max_tokens).toBe(1200); expect(step.reserveUsd).toBe(.05);
  });
  it("all modes generate portrait footage and real Thai narration within the initial reserve", () => {
    const context = { prompt: "", model: "", idea, imageUrl: "https://fal.media/reference.jpg" };
    const image = paidStep("IMAGE", context), voice = paidStep("VOICE", context), video = paidStep("VIDEO", context);
    expect(image.input.image_size).toEqual({ width: 720, height: 1280 }); expect(voice.input.text).toBe(idea.script);
    expect(voice.input.language_boost).toBe("Thai"); expect(video.input.aspect_ratio).toBe("9:16");
    expect(video.input.num_frames).toBe(193); expect(video.input.generate_audio).toBeUndefined();
    expect(.05 + image.reserveUsd + voice.reserveUsd + video.reserveUsd).toBeLessThan(.3);
  });
  it("rejects arbitrary hosts, credentials, HTTP, lookalikes and encoded traversal", () => {
    for (const url of ["http://fal.media/a", "https://fal.media.evil.test/a", "https://evil.test/a", "https://127.0.0.1/a", "https://x:y@fal.media/a", "https://fal.media:443/a", "https://storage.googleapis.com/other/a", "https://fal.media/a%2fb"]) {
      if (url === "https://fal.media:443/a") continue; // URL canonicalizes the standard HTTPS port.
      expect(() => assertFalAssetUrl(url)).toThrow();
    }
    expect(() => assertFalAssetUrl("https://v3.fal.media/a")).not.toThrow();
    expect(() => assertFalAssetUrl("https://storage.googleapis.com/falserverless/a")).not.toThrow();
  });
  it("polling is read-only; pending does not submit or download", async () => {
    const queue = { upload: vi.fn(), submit: vi.fn(), status: vi.fn(async () => ({ status: "IN_PROGRESS" })), result: vi.fn() };
    const provider = new ContentProvider("test", vi.fn(), queue);
    expect(await provider.read({ endpoint: endpoints.VIDEO, input: {}, reserveUsd: .17 }, "same-request")).toBeNull();
    expect(queue.submit).not.toHaveBeenCalled(); expect(queue.result).not.toHaveBeenCalled();
  });
  it("quotes current prices and rounds reservations up before spending", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ has_more: false, prices: [{ endpoint_id: endpoints.VIDEO, unit: "seconds", unit_price: .04, currency: "USD" }] }));
    const provider = new ContentProvider("test", fetcher);
    const quote = await provider.quote({ endpoint: endpoints.VIDEO, input: {}, reserveUsd: .17 });
    expect(quote.reserveUsd).toBe(.321667);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
  it.each(["EUR", "wrong-unit", "missing", "paginated"])("blocks spending if the price quote is unverifiable: %s", async problem => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ has_more: problem === "paginated", prices: problem === "missing" ? [] : [{ endpoint_id: endpoints.VIDEO, unit: problem === "wrong-unit" ? "pixels" : "seconds", unit_price: .02, currency: problem === "EUR" ? "EUR" : "USD" }] }));
    await expect(new ContentProvider("test", fetcher).quote({ endpoint: endpoints.VIDEO, input: {}, reserveUsd: .17 })).rejects.toThrow("price_unavailable");
  });
  it("does not follow redirects or download beyond the bound", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("x", { headers: { "content-type": "video/mp4", "content-length": "60000000" } }));
    const provider = new ContentProvider("test", fetcher);
    await expect(provider.download("https://fal.media/video.mp4", "video")).rejects.toThrow("too_large");
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
});
