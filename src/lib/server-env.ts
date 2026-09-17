import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  ALLOW_DEV_MOCK_SEED: z.enum(["true", "false"]).default("false"),
  CREATIVE_AI_PROVIDER: z.enum(["mock","openai"]).default("mock"),
  CREATIVE_AI_MODEL: z.string().min(1).default("gpt-5.4-nano"),
  OPENAI_API_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(20).optional()),
  SUPABASE_SECRET_KEY: z.preprocess(value=>value===""?undefined:value,z.string().startsWith("sb_secret_").min(24).optional()),
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
  TIKTOK_ALLOWED_PULL_HOSTS: z.string().default(""),
  TIKTOK_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
}).superRefine((value,ctx)=>{
  if(value.CREATIVE_AI_PROVIDER==="openai"&&!value.OPENAI_API_KEY)ctx.addIssue({code:"custom",path:["OPENAI_API_KEY"],message:"OPENAI_API_KEY is required when CREATIVE_AI_PROVIDER=openai"});
  if(value.TIKTOK_PROVIDER==="official") for(const key of ["SUPABASE_SECRET_KEY","TIKTOK_CLIENT_KEY","TIKTOK_CLIENT_SECRET","TIKTOK_REDIRECT_URI","TIKTOK_TOKEN_ENCRYPTION_KEY"] as const) if(!value[key])ctx.addIssue({code:"custom",path:[key],message:`${key} is required when TIKTOK_PROVIDER=official`});
  if(value.TIKTOK_PUBLISHING_PROVIDER==="official"&&value.TIKTOK_PUBLISHING_REAL_MODE!=="true")ctx.addIssue({code:"custom",path:["TIKTOK_PUBLISHING_REAL_MODE"],message:"TIKTOK_PUBLISHING_REAL_MODE=true is required for official publishing"});
  if(value.TIKTOK_PUBLISHING_PROVIDER==="official") for(const key of ["SUPABASE_SECRET_KEY","TIKTOK_CLIENT_SECRET","TIKTOK_TOKEN_ENCRYPTION_KEY"] as const) if(!value[key])ctx.addIssue({code:"custom",path:[key],message:`${key} is required for official publishing`});
});

const parsed = serverEnvSchema.safeParse({
  ALLOW_DEV_MOCK_SEED: process.env.ALLOW_DEV_MOCK_SEED,
  CREATIVE_AI_PROVIDER: process.env.CREATIVE_AI_PROVIDER,
  CREATIVE_AI_MODEL: process.env.CREATIVE_AI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
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
  TIKTOK_ALLOWED_PULL_HOSTS: process.env.TIKTOK_ALLOWED_PULL_HOSTS,
  TIKTOK_WEBHOOK_TOLERANCE_SECONDS: process.env.TIKTOK_WEBHOOK_TOLERANCE_SECONDS,
});

if (!parsed.success) {
  throw new Error(
    "Invalid server environment variables: " + z.prettifyError(parsed.error),
  );
}

export const serverEnv = Object.freeze({
  allowDevMockSeed: parsed.data.ALLOW_DEV_MOCK_SEED === "true",
  creativeAIProvider: parsed.data.CREATIVE_AI_PROVIDER,
  creativeAIModel: parsed.data.CREATIVE_AI_MODEL,
  openAIApiKey: parsed.data.OPENAI_API_KEY,
  supabaseSecretKey: parsed.data.SUPABASE_SECRET_KEY,
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
  tiktokAllowedPullHosts: parsed.data.TIKTOK_ALLOWED_PULL_HOSTS.split(",").map(value=>value.trim().toLowerCase()).filter(Boolean),
  tiktokWebhookToleranceSeconds: parsed.data.TIKTOK_WEBHOOK_TOLERANCE_SECONDS,
});
