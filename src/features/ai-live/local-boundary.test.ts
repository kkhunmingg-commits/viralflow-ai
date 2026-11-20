import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { LIVE_COMPONENT_VERSIONS } from "./local-contract";

// Production keeps Praew's cloud proxy at /api/ai-live/*; LIVE Lite talks only to the loopback companion.
describe("local AI LIVE media boundary", () => {
  it("permits only the fixed local companion and microphone on the AI LIVE Lite page", async () => {
    const rules = await nextConfig.headers!();
    const base = new Map(rules[0].headers.map((header) => [header.key, header.value]));
    const live = rules.find((rule) => rule.source === "/ai-live/lite")!;
    const scoped = new Map(live.headers.map((header) => [header.key, header.value]));
    expect(base.get("Permissions-Policy")).toContain("microphone=()");
    expect(base.get("Content-Security-Policy")).not.toContain("127.0.0.1");
    expect(scoped.get("Permissions-Policy")).toContain("microphone=(self)");
    expect(scoped.get("Content-Security-Policy")).toContain("http://127.0.0.1:8786");
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
