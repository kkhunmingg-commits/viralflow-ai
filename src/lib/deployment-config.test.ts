import { describe, expect, it } from "vitest";
import { validateDeploymentConfig } from "./deployment-config";

const production = { APP_ENV: "production", VERCEL_ENV: "production", APP_URL: "https://viralflow.example" };

describe("deployment environment contract", () => {
  it("boots unrelated app routes without optional provider keys", () => {
    expect(validateDeploymentConfig({ APP_ENV: "development" })).toMatchObject({ environment: "development", recoveryEnabled: false });
    expect(validateDeploymentConfig({ ...production })).toMatchObject({ environment: "production", recoveryEnabled: false });
  });

  it("fails closed when a scheduler is enabled without server credentials", () => {
    expect(() => validateDeploymentConfig({ ...production, OPS_RECOVERY_ENABLED: "true" })).toThrow("recovery_credentials_required");
    expect(validateDeploymentConfig({ ...production, OPS_RECOVERY_ENABLED: "true", CRON_SECRET: "c".repeat(32), SUPABASE_SECRET_KEY: "sb_secret_test" }).recoveryEnabled).toBe(true);
  });

  it("never allows preview/staging to publish or use paid benchmark flags", () => {
    expect(() => validateDeploymentConfig({ APP_ENV: "staging", VERCEL_ENV: "preview", APP_URL: "https://preview.example", TIKTOK_PUBLISHING_REAL_MODE: "true" })).toThrow("real_tiktok_requires_production");
    expect(() => validateDeploymentConfig({ ...production, VIDEO_BENCHMARK_ALLOW_PAID: "true" })).toThrow("paid_benchmark_must_be_disabled");
    expect(() => validateDeploymentConfig({ APP_ENV: "production", VERCEL_ENV: "preview", APP_URL: "https://preview.example" })).toThrow("preview_cannot_be_production");
  });

  it("requires environment-matched OAuth redirect and exact HTTPS alert host", () => {
    expect(() => validateDeploymentConfig({ ...production, TIKTOK_PROVIDER: "official", TIKTOK_REDIRECT_URI: "https://staging.example/auth/tiktok/callback" })).toThrow("tiktok_redirect_environment_mismatch");
    expect(() => validateDeploymentConfig({ ...production, OPS_ALERT_WEBHOOK_URL: "https://localhost/alerts", OPS_ALERT_WEBHOOK_HOST: "localhost" })).toThrow("alert_url_invalid");
    expect(validateDeploymentConfig({ ...production, OPS_ALERT_WEBHOOK_URL: "https://alerts.example/hook", OPS_ALERT_WEBHOOK_HOST: "alerts.example" }).environment).toBe("production");
  });

  it("keeps fal unavailable until existing owner-approval gate is satisfied", async () => {
    const { falAutoModeAvailability } = await import("../features/video/provider-routing");
    expect(falAutoModeAvailability({ keyPresent: false, state: "PRODUCTION_APPROVED" }).providerAvailable).toBe(false);
    expect(falAutoModeAvailability({ keyPresent: true, state: "PRIMARY_CANDIDATE" }).providerAvailable).toBe(false);
  });
});
