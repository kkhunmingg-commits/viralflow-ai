export type AppEnvironment = "development" | "staging" | "production";

type Values = Record<string, string | undefined>;

export function validateDeploymentConfig(values: Values) {
  const environment = values.APP_ENV ?? (values.VERCEL_ENV === "production" ? "production" : values.VERCEL_ENV === "preview" ? "staging" : "development");
  if (!["development", "staging", "production"].includes(environment)) throw new Error("invalid_app_environment");
  if (values.VERCEL_ENV === "production" && environment !== "production") throw new Error("production_environment_mismatch");
  if (values.VERCEL_ENV === "preview" && environment === "production") throw new Error("preview_cannot_be_production");

  const appUrl = values.APP_URL;
  if (environment !== "development") {
    if (!appUrl) throw new Error("app_url_required");
    let url: URL;
    try { url = new URL(appUrl); } catch { throw new Error("app_url_invalid"); }
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("app_url_invalid");
  }
  if (environment !== "development" && values.VIDEO_BENCHMARK_ALLOW_PAID === "true") throw new Error("paid_benchmark_must_be_disabled");
  if (environment !== "production" && (values.TIKTOK_PUBLISHING_REAL_MODE === "true" || values.TIKTOK_SHOP_REAL_MODE === "true")) throw new Error("real_tiktok_requires_production");
  if (values.TIKTOK_PUBLISHING_REAL_MODE === "true" && values.TIKTOK_PUBLISHING_PROVIDER !== "official") throw new Error("real_publishing_provider_required");
  if (values.TIKTOK_SHOP_REAL_MODE === "true" && values.TIKTOK_SHOP_PROVIDER !== "official") throw new Error("real_shop_provider_required");
  if (values.TIKTOK_PROVIDER === "official" && environment !== "development") {
    if (!values.TIKTOK_REDIRECT_URI || !appUrl) throw new Error("tiktok_redirect_required");
    let redirect: URL;
    try { redirect = new URL(values.TIKTOK_REDIRECT_URI); } catch { throw new Error("tiktok_redirect_invalid"); }
    if (redirect.origin !== new URL(appUrl).origin || redirect.pathname !== "/auth/tiktok/callback") throw new Error("tiktok_redirect_environment_mismatch");
  }

  const recoveryEnabled = values.OPS_RECOVERY_ENABLED === "true";
  if (values.OPS_RECOVERY_ENABLED && !["true", "false"].includes(values.OPS_RECOVERY_ENABLED)) throw new Error("invalid_recovery_flag");
  if (recoveryEnabled && (!values.CRON_SECRET || values.CRON_SECRET.length < 32 || !values.SUPABASE_SECRET_KEY)) throw new Error("recovery_credentials_required");
  if (recoveryEnabled && environment !== "production") throw new Error("recovery_requires_production");

  if (values.OPS_ALERT_WEBHOOK_URL) {
    if (!values.OPS_ALERT_WEBHOOK_HOST) throw new Error("alert_host_required");
    let url: URL;
    try { url = new URL(values.OPS_ALERT_WEBHOOK_URL); } catch { throw new Error("alert_url_invalid"); }
    if (url.protocol !== "https:" || url.hostname !== values.OPS_ALERT_WEBHOOK_HOST || url.port || url.username || url.password || url.hash || !/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname === "localhost" || url.hostname.endsWith(".local") || url.hostname.endsWith(".internal") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new Error("alert_url_invalid");
  }
  return { environment: environment as AppEnvironment, recoveryEnabled, appUrl: appUrl ?? null };
}
