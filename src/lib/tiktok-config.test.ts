import { describe, expect, it } from "vitest";
import { assertTikTokOfficialConfig, missingTikTokOfficialConfig, tiktokRequirementLabel } from "./tiktok-config";

describe("TikTok official setup preflight", () => {
  it("reports only missing names and never echoes supplied values", () => {
    const missing = missingTikTokOfficialConfig({
      SUPABASE_SECRET_KEY: "server-secret",
      TIKTOK_CLIENT_KEY: " ",
      TIKTOK_CLIENT_SECRET: "client-secret",
      TIKTOK_REDIRECT_URI: "",
      TIKTOK_TOKEN_ENCRYPTION_KEY: "local-encryption-key",
    });
    expect(missing).toEqual(["TIKTOK_CLIENT_KEY", "TIKTOK_REDIRECT_URI"]);
    expect(JSON.stringify(missing)).not.toContain("client-secret");
    expect(tiktokRequirementLabel("TIKTOK_CLIENT_KEY")).toBe("TikTok Client Key");
    expect(() => assertTikTokOfficialConfig({ TIKTOK_CLIENT_KEY: "client-key" }))
      .toThrow("TikTok official configuration missing");
  });

  it("accepts a complete owner-provided configuration", () => {
    expect(missingTikTokOfficialConfig({
      SUPABASE_SECRET_KEY: "server-secret",
      TIKTOK_CLIENT_KEY: "client-key",
      TIKTOK_CLIENT_SECRET: "client-secret",
      TIKTOK_REDIRECT_URI: "https://example.test/auth/tiktok/callback",
      TIKTOK_TOKEN_ENCRYPTION_KEY: "local-encryption-key",
    })).toEqual([]);
  });
});
