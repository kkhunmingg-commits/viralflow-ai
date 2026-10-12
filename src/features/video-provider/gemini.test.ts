import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GEMINI_INTERACTIONS_ENDPOINT, GEMINI_OMNI_8_SECOND_VIDEO_ESTIMATE_USD, GEMINI_OMNI_MODEL, GeminiOmniProvider, geminiUsageCostUsd } from "./gemini";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const key = "local-unit-test-key-not-a-real-credential";
const id = "v1_existing_interaction";
const mp4 = Buffer.from("000000186674797069736f6d0000000069736f6d6d703431", "hex");
const image = { bytes: Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]), mimeType: "image/png" };
const usage = { total_input_tokens: 100, total_output_tokens: 46346, total_thought_tokens: 50, total_tool_use_tokens: 0, total_cached_tokens: 0,
  output_tokens_by_modality: [{ modality: "video", tokens: 46336 }, { modality: "text", tokens: 10 }] };
const completed = (video: object = { type: "video", mime_type: "video/mp4", data: mp4.toString("base64") }) => ({
  id, model: GEMINI_OMNI_MODEL, status: "completed", usage,
  steps: [{ type: "user_input", content: [{ type: "video", mime_type: "video/mp4", data: "untrusted input is never selected" }] }, { type: "model_output", content: [video] }],
});
const provider = (fetcher: typeof fetch, paidMode = true) => new GeminiOmniProvider(key, fetcher, { paidMode });

describe("Official Omni adapter with local HTTP fixtures only, never paid generation", () => {
  it("prepares both tasks with bounded reservation estimates and no persisted image data", () => {
    const p = provider(vi.fn());
    expect(p.prepare("A continuous ocean scene")).toMatchObject({ task: "text_to_video", durationSeconds: 8, aspectRatio: "9:16", resolution: "720p", estimateBasis: "CONSERVATIVE_RESERVATION_ESTIMATE" });
    const request = p.prepare("Keep the product unchanged", image);
    expect(request.task).toBe("image_to_video");
    expect(request.image?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(request)).not.toContain(image.bytes.toString("base64"));
    expect(request.estimateUsd).toBeGreaterThan(request.videoEstimateUsd);
    expect(GEMINI_OMNI_8_SECOND_VIDEO_ESTIMATE_USD).toBeCloseTo(.81088, 7);
    expect(() => p.prepare(" ")).toThrow("GEMINI_PROMPT_INVALID");
    expect(() => p.prepare("ก".repeat(3000))).toThrow("GEMINI_PROMPT_INVALID");
  });
  it("defaults paid mode OFF and does not make a request", async () => {
    const fetcher = vi.fn(); const p = new GeminiOmniProvider(key, fetcher);
    await expect(p.submit(p.prepare("Ocean"))).rejects.toThrow("GEMINI_PAID_MODE_DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("submits one official REST request with documented duration, background and aspect settings", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id, model: GEMINI_OMNI_MODEL, status: "in_progress" }));
    const p = provider(fetcher); const request = p.prepare("Ocean waves");
    expect(await p.submit(request)).toEqual({ request_id: id });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(GEMINI_INTERACTIONS_ENDPOINT);
    expect(String(url)).not.toContain(key);
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": key });
    expect(JSON.parse(String(options?.body))).toMatchObject({ model: GEMINI_OMNI_MODEL, input: "Ocean waves", response_format: { type: "video", duration: "8s", resolution: "720p", aspect_ratio: "9:16", delivery: "inline" }, background: true, store: true, stream: false, generation_config: { max_output_tokens: 65536, video_config: { task: "text_to_video" } } });
  });
  it("adds a verified image only in the runtime request and rejects changed bytes before spending", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id })); const p = provider(fetcher); const request = p.prepare("Animate this item", image);
    await expect(p.submit(request, { ...image, bytes: Buffer.concat([image.bytes, Buffer.from([5])]) })).rejects.toThrow("GEMINI_IMAGE_CHANGED");
    expect(fetcher).not.toHaveBeenCalled();
    await p.submit(request, image);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).input).toEqual([{ type: "image", data: image.bytes.toString("base64"), mime_type: "image/png" }, { type: "text", text: request.prompt }]);
    await expect(p.submit(request)).rejects.toThrow("GEMINI_IMAGE_REQUIRED");
  });
  it.each(["image/svg+xml", "image/gif"])("rejects unsupported %s references", mimeType => {
    expect(() => provider(vi.fn()).prepare("Animate", { ...image, mimeType })).toThrow("GEMINI_IMAGE_INVALID");
  });
  it("rejects mismatched image magic and oversized reference", () => {
    const p = provider(vi.fn());
    expect(() => p.prepare("Animate", { bytes: Buffer.from("not an image"), mimeType: "image/png" })).toThrow("GEMINI_IMAGE_INVALID");
    expect(() => p.prepare("Animate", { bytes: Buffer.alloc(4 * 1024 * 1024 + 1), mimeType: "image/png" })).toThrow("GEMINI_IMAGE_INVALID");
  });
  it("sanitizes network/provider failures and never retries a POST", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`secret ${key}`)); const p = provider(fetcher);
    await expect(p.submit(p.prepare("Ocean"))).rejects.toThrow("GEMINI_SUBMISSION_UNKNOWN");
    expect(fetcher).toHaveBeenCalledOnce();
    const denied = vi.fn<typeof fetch>().mockResolvedValue(json({ error: { message: key } }, 403)); const q = provider(denied);
    await expect(q.submit(q.prepare("Ocean"))).rejects.toThrow("GEMINI_SUBMISSION_UNKNOWN");
    expect(denied).toHaveBeenCalledOnce();
  });
  it("rejects tampered quote/model settings before a POST", async () => {
    const fetcher = vi.fn(); const p = provider(fetcher); const request = p.prepare("Ocean");
    await expect(p.submit({ ...request, estimateUsd: 0 })).rejects.toThrow("GEMINI_REQUEST_INVALID");
    await expect(p.submit({ ...request, maxOutputTokens: 999999 })).rejects.toThrow("GEMINI_REQUEST_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("polls only the same stored interaction ID and resumes after provider object restart", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id, status: "in_progress" })).mockResolvedValueOnce(json(completed()));
    const first = provider(fetcher), request = first.prepare("Ocean");
    expect(await first.poll(request, id)).toEqual({ status: "PENDING" });
    expect(await provider(fetcher).poll(JSON.parse(JSON.stringify(request)), id)).toEqual({ status: "COMPLETE" });
    for (const [url, options] of fetcher.mock.calls) { expect(url).toBe(`${GEMINI_INTERACTIONS_ENDPOINT}/${id}`); expect(options?.method).toBe("GET"); }
  });
  it.each(["failed", "cancelled", "incomplete", "requires_action"])("fails safely for %s with no new generation", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id, status })); const p = provider(fetcher);
    expect(await p.poll(p.prepare("Ocean"), id)).toEqual({ status: "FAILED" });
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it("rejects unsafe IDs before sending credentials and mismatched returned ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "v1_wrong", status: "queued" })); const p = provider(fetcher); const request = p.prepare("Ocean");
    await expect(p.poll(request, "https://evil.example/key")).rejects.toThrow("GEMINI_REQUEST_ID_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(p.poll(request, id)).rejects.toThrow("GEMINI_RESPONSE_INVALID");
  });
  it("decodes only model output MP4 and labels usage cost separately from actual billing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed())); const p = provider(fetcher);
    const result = await p.retrieve(p.prepare("Ocean"), id);
    expect(Buffer.from(result.bytes)).toEqual(mp4);
    expect(result.costUsd).toBeNull();
    expect(result.usageCostUsd).toBeCloseTo(.81157, 6);
    expect(result.costBasis).toBe("PROVIDER_USAGE_ESTIMATE");
    expect(await p.billedCost()).toBeNull();
  });
  it.each(["@@@@", "aaaa===", Buffer.from("html not video").toString("base64")])("rejects invalid/forged MP4 payload %s", async data => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed({ type: "video", mime_type: "video/mp4", data }))); const p = provider(fetcher);
    await expect(p.retrieve(p.prepare("Ocean"), id)).rejects.toThrow("GEMINI_VIDEO_INVALID");
  });
  it.each(["https://evil.example/files/test", "https://generativelanguage.googleapis.com.evil.example/v1beta/files/test", "https://generativelanguage.googleapis.com/v1beta/files/test?key=bad", "http://generativelanguage.googleapis.com/v1beta/files/test", "files/../secret"])("does not fetch unsafe returned file URI %s", async uri => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed({ type: "video", mime_type: "video/mp4", uri }))); const p = provider(fetcher);
    await expect(p.retrieve(p.prepare("Ocean"), id)).rejects.toThrow("GEMINI_DOWNLOAD_URL_NOT_ALLOWED");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("downloads a Google file only after ACTIVE with bounded MP4 validation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(completed({ type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/official_file" })))
      .mockResolvedValueOnce(json({ state: "ACTIVE", mimeType: "video/mp4" })).mockResolvedValueOnce(new Response(mp4, { headers: { "content-type": "video/mp4" } }));
    const p = provider(fetcher); expect(Buffer.from((await p.retrieve(p.prepare("Ocean"), id)).bytes)).toEqual(mp4);
    expect(fetcher.mock.calls[2][0]).toBe("https://generativelanguage.googleapis.com/v1beta/files/official_file:download?alt=media");
    for (const [, options] of fetcher.mock.calls) { expect(options?.redirect).toBe("error"); expect(options?.method).toBe("GET"); }
  });
  it("waits for a generated Google file still PROCESSING", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(completed({ type: "video", mime_type: "video/mp4", uri: "files/official_file" }))).mockResolvedValueOnce(json({ state: "PROCESSING" })); const p = provider(fetcher);
    expect(await p.poll(p.prepare("Ocean"), id)).toEqual({ status: "PENDING" });
  });
  it("blocks oversized responses even when Content-Length lies", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json", "content-length": String(100 * 1024 * 1024) } })); const p = provider(fetcher);
    await expect(p.retrieve(p.prepare("Ocean"), id)).rejects.toThrow("GEMINI_RESPONSE_TOO_LARGE");
  });
  it("metadata access is read-only and never proof of billing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ name: `models/${GEMINI_OMNI_MODEL}` }));
    const result = await new GeminiOmniProvider(key, fetcher).health();
    expect(result).toEqual({ keyConfigured: true, modelAvailable: true, billingVerified: false });
    expect(fetcher.mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_OMNI_MODEL}`);
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(await new GeminiOmniProvider("", fetcher).health()).toEqual({ keyConfigured: false, modelAvailable: null, billingVerified: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("limits streamed metadata bodies even without Content-Length", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65 * 1024)); controller.close(); } }), { headers: { "content-type": "application/json" } }));
    expect(await new GeminiOmniProvider(key, fetcher).health()).toEqual({ keyConfigured: true, modelAvailable: null, billingVerified: false });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("never exposes a key embedded in metadata failure text", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Network request failed x-goog-api-key=${key}`));
    expect(await new GeminiOmniProvider(key, fetcher).health()).toEqual({ keyConfigured: true, modelAvailable: null, billingVerified: false });
  });
  it("rejects multiple output videos and cannot mistake user-input video for the result", async () => {
    const result = completed();
    result.steps[1].content.push({ type: "video", mime_type: "video/mp4", data: mp4.toString("base64") });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(result)); const p = provider(fetcher);
    await expect(p.retrieve(p.prepare("Ocean"), id)).rejects.toThrow("GEMINI_VIDEO_INVALID");
  });
  it("returns UNKNOWN costs for absent, inconsistent or unpriced usage", () => {
    expect(geminiUsageCostUsd(null)).toBeNull();
    expect(geminiUsageCostUsd({ ...usage, total_output_tokens: 1 })).toBeNull();
    expect(geminiUsageCostUsd({ ...usage, total_thought_tokens: -1 })).toBeNull();
    expect(geminiUsageCostUsd({ ...usage, total_cached_tokens: 50 })).toBeNull();
    expect(geminiUsageCostUsd({ ...usage, output_tokens_by_modality: [{ modality: "audio", tokens: 46346 }] })).toBeNull();
  });
});
