import "server-only";
import { z } from "zod";
import { validateDeploymentConfig } from "./deployment-config";

const exactHostnameList = z.string().min(1).refine((value) => {
  const hosts = value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  return hosts.length > 0 && hosts.every((host) =>
    !host.includes("://")
    && !host.includes("/")
    && !host.includes("*")
    && /^[a-z0-9.-]+$/.test(host),
  );
}, "Expected a comma-separated list of exact hostnames");

const serverEnvSchema = z.object({
  ALLOW_DEV_MOCK_SEED: z.enum(["true", "false"]).default("false"),
  CREATIVE_AI_PROVIDER: z.enum(["mock","openai"]).default("mock"),
  CREATIVE_AI_MODEL: z.string().min(1).default("gpt-5.4-nano"),
  OPENAI_API_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(20).optional()),
  GOOGLE_GENAI_API_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(20).optional()),
  GOOGLE_VEO_MODEL: z.enum(["VEO_3_1_LITE","VEO_3_1_FAST","VEO_3_1_STANDARD"]).default("VEO_3_1_LITE"),
  FAL_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(20).optional()),
  FAL_WAN_PROVIDER_STATE: z.enum(["PRIMARY_CANDIDATE","BENCHMARK_FAILED","BENCHMARK_PASS_PENDING_OWNER_REVIEW","PRODUCTION_APPROVED"]).default("PRIMARY_CANDIDATE"),
  VIDEO_PRODUCT_IMAGE_ALLOWED_HOSTS: exactHostnameList.optional(),
  SUPABASE_SECRET_KEY: z.preprocess(value=>value===""?undefined:value,z.string().startsWith("sb_secret_").min(24).optional()),
  OPS_RECOVERY_TOKEN: z.preprocess(value=>value===""?undefined:value,z.string().min(32).optional()),
  CRON_SECRET: z.preprocess(value=>value===""?undefined:value,z.string().min(32).optional()),
  OPS_RECOVERY_ENABLED: z.enum(["true", "false"]).default("false"),
  OPS_ALERT_WEBHOOK_URL: z.preprocess(value=>value===""?undefined:value,z.url().optional()),
  OPS_ALERT_WEBHOOK_HOST: z.preprocess(value=>value===""?undefined:value,z.string().optional()),
  OPS_ALERT_WEBHOOK_TOKEN: z.preprocess(value=>value===""?undefined:value,z.string().min(20).optional()),
  TIKTOK_PROVIDER: z.enum(["mock", "official"]).default("mock"),
  TIKTOK_CLIENT_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(3).optional()),
  TIKTOK_CLIENT_SECRET: z.preprocess(value=>value===""?undefined:value,z.string().min(8).optional()),
  TIKTOK_REDIRECT_URI: z.preprocess(value=>value===""?undefined:value,z.url().optional()),
  TIKTOK_TOKEN_ENCRYPTION_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(32).optional()),
  TIKTOK_VIDEO_PUBLISH_APPROVED: z.enum(["true", "false"]).default("false"),
  TIKTOK_VIDEO_UPLOAD_APPROVED: z.enum(["true", "false"]).default("false"),
  TIKTOK_DIRECT_POST_AUDIT_STATUS: z.enum(["UNAUDITED", "IN_REVIEW", "AUDITED"]).default("UNAUDITED"),
  TIKTOK_CREATOR_CACHE_TTL_SECONDS: z.coerce.number().int().min(180).max(3600).default(300),
  TIKTOK_PUBLISHING_PROVIDER: z.enum(["mock", "official"]).default("mock"),
  TIKTOK_PUBLISHING_REAL_MODE: z.enum(["true", "false"]).default("false"),
  TIKTOK_ANALYTICS_PROVIDER: z.enum(["mock", "official"]).default("mock"),
  TIKTOK_ANALYTICS_REAL_MODE: z.enum(["true", "false"]).default("false"),
  TIKTOK_ALLOWED_PULL_HOSTS: z.string().default(""),
  TIKTOK_ALLOWED_UPLOAD_HOSTS: exactHostnameList.default("open-upload.tiktokapis.com,upload.us.tiktokapis.com"),
  TIKTOK_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  TIKTOK_WEBHOOK_MAX_BYTES: z.coerce.number().int().min(1024).max(262144).default(65536),
  TIKTOK_WEBHOOK_RATE_LIMIT: z.coerce.number().int().min(1).max(10000).default(120),
  TIKTOK_OAUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  AUTHENTICATED_MUTATION_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(60),
  TIKTOK_SHOP_PROVIDER: z.enum(["mock","official"]).default("mock"),
  TIKTOK_SHOP_REAL_MODE: z.enum(["true","false"]).default("false"),
  TIKTOK_SHOP_APP_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(3).optional()),
  TIKTOK_SHOP_APP_SECRET: z.preprocess(value=>value===""?undefined:value,z.string().min(8).optional()),
}).superRefine((value,ctx)=>{
  if(value.CREATIVE_AI_PROVIDER==="openai"&&!value.OPENAI_API_KEY)ctx.addIssue({code:"custom",path:["OPENAI_API_KEY"],message:"OPENAI_API_KEY is required when CREATIVE_AI_PROVIDER=openai"});
  if(value.TIKTOK_PROVIDER==="official") for(const key of ["SUPABASE_SECRET_KEY","TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET","TIKTOK_REDIRECT_URI","TIKTOK_TOKEN_ENCRYPTION_KEY"] as const) if(!value[key])ctx.addIssue({code:"custom",path:[key],message:`${key} is required when TIKTOK_PROVIDER=official`});
  if(value.TIKTOK_PUBLISHING_PROVIDER==="official"&&value.TIKTOK_PUBLISHING_REAL_MODE!=="true")ctx.addIssue({code:"custom",path:["TIKTOK_PUBLISHING_REAL_MODE"],message:"TIKTOK_PUBLISHING_REAL_MODE=true is required for official publishing"});
  if(value.TIKTOK_PUBLISHING_PROVIDER==="official") for(const key of ["SUPABASE_SECRET_KEY","TIKTOK_CLIENT_SECRET","TIKTOK_TOKEN_ENCRYPTION_KEY"] as const) if(!value[key])ctx.addIssue({code:"custom",path:[key],message:`${key} is required for official publishing`});
  if(value.TIKTOK_ANALYTICS_PROVIDER==="official"&&value.TIKTOK_ANALYTICS_REAL_MODE!=="true")ctx.addIssue({code:"custom",path:["TIKTOK_ANALYTICS_REAL_MODE"],message:"TIKTOK_ANALYTICS_REAL_MODE=true is required for official analytics"});
  if(value.TIKTOK_ANALYTICS_PROVIDER==="official"&&value.TIKTOK_PROVIDER!=="official")ctx.addIssue({code:"custom",path:["TIKTOK_PROVIDER"],message:"TIKTOK_PROVIDER=official is required for official analytics"});
  if(value.TIKTOK_SHOP_PROVIDER==="official"&&value.TIKTOK_SHOP_REAL_MODE!=="true")ctx.addIssue({code:"custom",path:["TIKTOK_SHOP_REAL_MODE"],message:"TIKTOK_SHOP_REAL_MODE=true is required for official Shop integration"});
  if(value.TIKTOK_SHOP_PROVIDER==="official")for(const key of ["SUPABASE_SECRET_KEY","TIKTOK_SHOP_APP_KEY","TIKTOK_SHOP_APP_SECRET","TIKTOK_TOKEN_ENCRYPTION_KEY"] as const)if(!value[key])ctx.addIssue({code:"custom",path:[key],message:`${key} is required for official Shop integration`});
});

const parsed = serverEnvSchema.safeParse({
  ALLOW_DEV_MOCK_SEED: process.env.ALLOW_DEV_MOCK_SEED,
  CREATIVE_AI_PROVIDER: process.env.CREATIVE_AI_PROVIDER,
  CREATIVE_AI_MODEL: process.env.CREATIVE_AI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY,
  GOOGLE_VEO_MODEL: process.env.GOOGLE_VEO_MODEL,
  FAL_KEY: process.env.FAL_KEY,
  FAL_WAN_PROVIDER_STATE: process.env.FAL_WAN_PROVIDER_STATE,
  VIDEO_PRODUCT_IMAGE_ALLOWED_HOSTS: process.env.VIDEO_PRODUCT_IMAGE_ALLOWED_HOSTS,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  OPS_RECOVERY_TOKEN: process.env.OPS_RECOVERY_TOKEN,
  CRON_SECRET: process.env.CRON_SECRET,
  OPS_RECOVERY_ENABLED: process.env.OPS_RECOVERY_ENABLED,
  OPS_ALERT_WEBHOOK_URL: process.env.OPS_ALERT_WEBHOOK_URL,
  OPS_ALERT_WEBHOOK_HOST: process.env.OPS_ALERT_WEBHOOK_HOST,
  OPS_ALERT_WEBHOOK_TOKEN: process.env.OPS_ALERT_WEBHOOK_TOKEN,
  TIKTOK_PROVIDER: process.env.TIKTOK_PROVIDER,
  TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET,
  TIKTOK_REDIRECT_URI: process.env.TIKTOK_REDIRECT_URI,
  TIKTOK_TOKEN_ENCRYPTION_KEY: process.env.TIKTOK_TOKEN_ENCRYPTION_KEY,
  TIKTOK_VIDEO_PUBLISH_APPROVED: process.env.TIKTOK_VIDEO_PUBLISH_APPROVED,
  TIKTOK_VIDEO_UPLOAD_APPROVED: process.env.TIKTOK_VIDEO_UPLOAD_APPROVED,
  TIKTOK_DIRECT_POST_AUDIT_STATUS: process.env.TIKTOK_DIRECT_POST_AUDIT_STATUS,
  TIKTOK_CREATOR_CACHE_TTL_SECONDS: process.env.TIKTOK_CREATOR_CACHE_TTL_SECONDS,
  TIKTOK_PUBLISHING_PROVIDER: process.env.TIKTOK_PUBLISHING_PROVIDER,
  TIKTOK_PUBLISHING_REAL_MODE: process.env.TIKTOK_PUBLISHING_REAL_MODE,
  TIKTOK_ANALYTICS_PROVIDER: process.env.TIKTOK_ANALYTICS_PROVIDER,
  TIKTOK_ANALYTICS_REAL_MODE: process.env.TIKTOK_ANALYTICS_REAL_MODE,
  TIKTOK_ALLOWED_PULL_HOSTS: process.env.TIKTOK_ALLOWED_PULL_HOSTS,
  TIKTOK_ALLOWED_UPLOAD_HOSTS: process.env.TIKTOK_ALLOWED_UPLOAD_HOSTS,
  TIKTOK_WEBHOOK_TOLERANCE_SECONDS: process.env.TIKTOK_WEBHOOK_TOLERANCE_SECONDS,
  TIKTOK_WEBHOOK_MAX_BYTES: process.env.TIKTOK_WEBHOOK_MAX_BYTES,
  TIKTOK_WEBHOOK_RATE_LIMIT: process.env.TIKTOK_WEBHOOK_RATE_LIMIT,
  TIKTOK_OAUTH_RATE_LIMIT: process.env.TIKTOK_OAUTH_RATE_LIMIT,
  AUTHENTICATED_MUTATION_RATE_LIMIT: process.env.AUTHENTICATED_MUTATION_RATE_LIMIT,
  TIKTOK_SHOP_PROVIDER: process.env.TIKTOK_SHOP_PROVIDER,
  TIKTOK_SHOP_REAL_MODE: process.env.TIKTOK_SHOP_REAL_MODE,
  TIKTOK_SHOP_APP_KEY: process.env.TIKTOK_SHOP_APP_KEY,
  TIKTOK_SHOP_APP_SECRET: process.env.TIKTOK_SHOP_APP_SECRET,
});

if (!parsed.success) {
  throw new Error(
    "Invalid server environment variables: " + z.prettifyError(parsed.error),
  );
}

const deployment = validateDeploymentConfig(process.env);

export const serverEnv = Object.freeze({
  appEnvironment: deployment.environment,
  appUrl: deployment.appUrl,
  recoveryEnabled: deployment.recoveryEnabled,
  cronSecret: parsed.data.CRON_SECRET,
  opsAlertWebhookUrl: parsed.data.OPS_ALERT_WEBHOOK_URL,
  opsAlertWebhookToken: parsed.data.OPS_ALERT_WEBHOOK_TOKEN,
  allowDevMockSeed: parsed.data.ALLOW_DEV_MOCK_SEED === "true",
  creativeAIProvider: parsed.data.CREATIVE_AI_PROVIDER,
  creativeAIModel: parsed.data.CREATIVE_AI_MODEL,
  openAIApiKey: parsed.data.OPENAI_API_KEY,
  googleGenAIApiKey: parsed.data.GOOGLE_GENAI_API_KEY,
  googleVeoModel: parsed.data.GOOGLE_VEO_MODEL,
  falKey: parsed.data.FAL_KEY,
  falWanProviderState: parsed.data.FAL_WAN_PROVIDER_STATE,
  videoProductImageAllowedHosts: parsed.data.VIDEO_PRODUCT_IMAGE_ALLOWED_HOSTS?.split(",").map(value=>value.trim().toLowerCase()).filter(Boolean)??[],
  supabaseSecretKey: parsed.data.SUPABASE_SECRET_KEY,
  opsRecoveryToken: parsed.data.OPS_RECOVERY_TOKEN,
  tiktokProvider: parsed.data.TIKTOK_PROVIDER,
  tiktokClientKey: parsed.data.TIKTOK_CLIENT_KEY,
  tiktokClientSecret: parsed.data.TIKTOK_CLIENT_SECRET,
  tiktokRedirectUri: parsed.data.TIKTOK_REDIRECT_URI,
  tiktokTokenEncryptionKey: parsed.data.TIKTOK_TOKEN_ENCRYPTION_KEY,
  tiktokVideoPublishApproved: parsed.data.TIKTOK_VIDEO_PUBLISH_APPROVED === "true",
  tiktokVideoUploadApproved: parsed.data.TIKTOK_VIDEO_UPLOAD_APPROVED === "true",
  tiktokDirectPostAuditStatus: parsed.data.TIKTOK_DIRECT_POST_AUDIT_STATUS,
  tiktokCreatorCacheTtlSeconds: parsed.data.TIKTOK_CREATOR_CACHE_TTL_SECONDS,
  tiktokPublishingProvider: parsed.data.TIKTOK_PUBLISHING_PROVIDER,
  tiktokPublishingRealMode: parsed.data.TIKTOK_PUBLISHING_REAL_MODE === "true",
  tiktokAnalyticsProvider: parsed.data.TIKTOK_ANALYTICS_PROVIDER,
  tiktokAnalyticsRealMode: parsed.data.TIKTOK_ANALYTICS_REAL_MODE === "true",
  tiktokAllowedPullHosts: parsed.data.TIKTOK_ALLOWED_PULL_HOSTS.split(",").map(value=>value.trim().toLowerCase()).filter(Boolean),
  tiktokAllowedUploadHosts: parsed.data.TIKTOK_ALLOWED_UPLOAD_HOSTS.split(",").map(value=>value.trim().toLowerCase()).filter(Boolean),
  tiktokWebhookToleranceSeconds: parsed.data.TIKTOK_WEBHOOK_TOLERANCE_SECONDS,
  tiktokWebhookMaxBytes: parsed.data.TIKTOK_WEBHOOK_MAX_BYTES,
  tiktokWebhookRateLimit: parsed.data.TIKTOK_WEBHOOK_RATE_LIMIT,
  tiktokOAuthRateLimit: parsed.data.TIKTOK_OAUTH_RATE_LIMIT,
  authenticatedMutationRateLimit: parsed.data.AUTHENTICATED_MUTATION_RATE_LIMIT,
  tiktokShopProvider:parsed.data.TIKTOK_SHOP_PROVIDER,
  tiktokShopRealMode:parsed.data.TIKTOK_SHOP_REAL_MODE==="true",
  tiktokShopAppKey:parsed.data.TIKTOK_SHOP_APP_KEY,
  tiktokShopAppSecret:parsed.data.TIKTOK_SHOP_APP_SECRET,
});
