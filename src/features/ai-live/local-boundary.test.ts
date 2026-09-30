import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config";
import { LIVE_COMPONENT_VERSIONS } from "./local-contract";

const auth = vi.hoisted(() => ({ authenticated: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({
    data: { user: auth.authenticated ? { id: "owner" } : null }, error: null,
  }) } }),
}));
import { GET, POST } from "../../app/api/ai-live/[...path]/route";

describe("local AI LIVE media boundary", () => {
  beforeEach(() => { auth.authenticated = true; vi.unstubAllGlobals(); });

  it("does not send presenter media through the cloud even with a legacy worker configured", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("AI_LIVE_WORKER_URL", "https://worker.example.com");
    vi.stubEnv("AI_LIVE_WORKER_TOKEN", "x".repeat(40));
    try {
      const context = { params: Promise.resolve({ path: ["sessions", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "preview"] }) };
      const preview = await GET(new Request("https://app.test/api/ai-live/preview"), context);
      expect(preview.status).toBe(410);
      const audio = await POST(new Request("https://app.test/api/ai-live/audio", {
        method: "POST", headers: { origin: "https://app.test" }, body: "local audio",
      }), { params: Promise.resolve({ path: ["sessions", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "audio"] }) });
      expect(audio.status).toBe(410);
      expect(fetcher).not.toHaveBeenCalled();
      const health = await GET(new Request("https://app.test/api/ai-live/health"), { params: Promise.resolve({ path: ["health"] }) });
      expect(await health.json()).toEqual({ ready: false, localRequired: true });
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });

  it("retains authentication and same-origin checks for retired endpoints", async () => {
    const context = { params: Promise.resolve({ path: ["references"] }) };
    const request = new Request("https://app.test/api/ai-live/references", { method: "POST" });
    expect((await POST(request, context)).status).toBe(403);
    auth.authenticated = false;
    expect((await POST(request, context)).status).toBe(401);
  });

  it("permits only the fixed local companion and microphone on the AI LIVE page", async () => {
    const rules = await nextConfig.headers!();
    const base = new Map(rules[0].headers.map((header) => [header.key, header.value]));
    const live = rules.find((rule) => rule.source === "/ai-live")!;
    const scoped = new Map(live.headers.map((header) => [header.key, header.value]));
    expect(base.get("Permissions-Policy")).toContain("microphone=()");
    expect(base.get("Content-Security-Policy")).not.toContain("127.0.0.1");
    expect(scoped.get("Permissions-Policy")).toContain("microphone=(self)");
    expect(scoped.get("Content-Security-Policy")).toContain("http://127.0.0.1:8766");
    expect(scoped.get("Content-Security-Policy")).not.toContain("http://localhost:*");
    expect(scoped.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("keeps the packaged agent version tuple aligned with the web signer", () => {
    const source = readFileSync("workers/ai-live/local_agent/agent.py", "utf8");
    const declaration = source.match(/VERSIONS = (\{[^}]+\})/)?.[1];
    expect(declaration).toBeDefined();
    expect(JSON.parse(declaration!)).toEqual(LIVE_COMPONENT_VERSIONS);
  });
});
