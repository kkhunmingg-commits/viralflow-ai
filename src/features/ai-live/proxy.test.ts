import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { liveRequestBody, liveWorkerConfig, resolveLiveAction } from "./proxy";

const id = "f6bfce81-0e1c-437e-8b29-fd224f08d92a";

describe("AI LIVE authenticated worker boundary", () => {
  it("forwards only the supported presenter actions", () => {
    expect(resolveLiveAction("GET", ["health"])).toBe("health");
    expect(resolveLiveAction("POST", ["sessions", id, "audio"])).toBe("audio");
    expect(resolveLiveAction("GET", ["sessions", id, "preview"])).toBe("preview");
    expect(resolveLiveAction("POST", ["sessions", id, "stop"])).toBe("stop");
    expect(resolveLiveAction("POST", ["sessions", "../../admin", "stop"])).toBeNull();
    expect(resolveLiveAction("GET", ["private", "tokens"])).toBeNull();
  });

  it("keeps worker credentials server-only and requires TLS outside local development", () => {
    const token = "a".repeat(32);
    expect(liveWorkerConfig({ APP_ENV: "production", AI_LIVE_WORKER_URL: "http://worker.example/", AI_LIVE_WORKER_TOKEN: token })).toBeNull();
    expect(liveWorkerConfig({ APP_ENV: "production", AI_LIVE_WORKER_URL: "https://worker.example/other", AI_LIVE_WORKER_TOKEN: token })).toBeNull();
    expect(liveWorkerConfig({ APP_ENV: "production", AI_LIVE_WORKER_URL: "https://worker.example/", AI_LIVE_WORKER_TOKEN: "short" })).toBeNull();
    expect(liveWorkerConfig({ APP_ENV: "production", AI_LIVE_WORKER_URL: "https://worker.example/", AI_LIVE_WORKER_TOKEN: token })).toEqual({ origin: "https://worker.example", token });
    expect(liveWorkerConfig({ APP_ENV: "development", AI_LIVE_WORKER_URL: "http://127.0.0.1:8765/", AI_LIVE_WORKER_TOKEN: token })?.origin).toBe("http://127.0.0.1:8765");
  });

  it("rejects oversized chunked uploads and JSON before forwarding", async () => {
    const image = new Request("https://app.test/api/ai-live/references", {
      method: "POST", headers: { "content-type": "image/jpeg" }, body: new Uint8Array(4 * 1024 * 1024 + 1),
    });
    const imageResult = await liveRequestBody(image, "reference");
    expect(imageResult).toBeInstanceOf(Response);
    expect((imageResult as Response).status).toBe(413);

    const start = new Request("https://app.test/api/ai-live/sessions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference_id: id, target_fps: 20, extra: "x".repeat(5000) }),
    });
    const startResult = await liveRequestBody(start, "start");
    expect(startResult).toBeInstanceOf(Response);
    expect((startResult as Response).status).toBe(413);
  });
});
