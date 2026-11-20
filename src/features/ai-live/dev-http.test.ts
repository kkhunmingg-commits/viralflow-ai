import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { liveDevFallbackEnabled, liveDevWorkerConfiguration } from "./dev-config";
import { handleDevWorkerRequest, resolveDevAction } from "./dev-http";

const id = "f6bfce81-0e1c-437e-8b29-fd224f08d92a";
const settings = { NODE_ENV: "development", APP_ENV: "development", AI_LIVE_DEV_FALLBACK: "true", PRESENTER_PROVIDER: "dev_fallback",
  AI_LIVE_WORKER_URL: "http://127.0.0.1:8765/", AI_LIVE_WORKER_TOKEN: "t".repeat(32) };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("DEV worker boundary", () => {
  it("disables diagnostics and CPU transport unless all explicit development gates pass", () => {
    expect(liveDevFallbackEnabled(settings)).toBe(true);
    for (const [key, value] of [["AI_LIVE_DEV_FALLBACK", "false"], ["NODE_ENV", "production"], ["APP_ENV", "production"], ["PRESENTER_PROVIDER", "musetalk"], ["VERCEL", "1"]]) {
      expect(liveDevFallbackEnabled({ ...settings, [key]: value })).toBe(false);
    }
    expect(liveDevFallbackEnabled({})).toBe(false);
  });
  it("restricts DEV forwarding to loopback and never forwards arbitrary paths", () => {
    expect(liveDevWorkerConfiguration(settings)?.origin).toBe("http://127.0.0.1:8765");
    for (const address of ["https://external.test", "http://external.test", "http://user:pass@127.0.0.1:8765", "http://127.0.0.1:8765/admin"]) {
      expect(liveDevWorkerConfiguration({ ...settings, AI_LIVE_WORKER_URL: address })).toBeNull();
    }
    expect(resolveDevAction("GET", ["sessions", id, "frame"])).toBe("frame");
    expect(resolveDevAction("GET", ["sessions", "../admin", "frame"])).toBeNull();
  });
  it("authenticates worker requests and preserves actual JPEG counter transport", async () => {
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
    vi.stubEnv("VERCEL", "");
    const upstream = vi.fn().mockResolvedValue(new Response(Uint8Array.of(0xff, 0xd8, 0xff), { headers: { "Content-Type": "image/jpeg", "X-Frame-Count": "7" } }));
    vi.stubGlobal("fetch", upstream);
    const result = await handleDevWorkerRequest(new Request(`http://localhost:3000/api/ai-live/dev/sessions/${id}/frame`), ["sessions", id, "frame"], id);
    expect(result.headers.get("x-frame-count")).toBe("7");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(Uint8Array.of(0xff, 0xd8, 0xff));
    expect(upstream.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${settings.AI_LIVE_WORKER_TOKEN}`, "X-ViralFlow-Owner-Id": id });
  });
  it("rejects cross-origin mutations before any real worker request", async () => {
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
    vi.stubEnv("VERCEL", "");
    const upstream = vi.fn(); vi.stubGlobal("fetch", upstream);
    const result = await handleDevWorkerRequest(new Request("http://localhost:3000/api/ai-live/dev/sessions", { method: "POST", headers: { Origin: "https://external.test" } }), ["sessions"], id);
    expect(result.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
  });
  it("accepts only DEV FPS and bounds start JSON without loosening production parsing", async () => {
    for (const [key, value] of Object.entries(settings)) vi.stubEnv(key, value);
    vi.stubEnv("VERCEL", "");
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ session_id: id })));
    vi.stubGlobal("fetch", upstream);
    const make = (target_fps: number) => new Request("http://localhost:3000/api/ai-live/dev/sessions", { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ reference_id: id, target_fps }) });
    expect((await handleDevWorkerRequest(make(2), ["sessions"], id)).status).toBe(200);
    expect((await handleDevWorkerRequest(make(20), ["sessions"], id)).status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
