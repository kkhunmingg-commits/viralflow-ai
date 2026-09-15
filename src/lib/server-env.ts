import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  ALLOW_DEV_MOCK_SEED: z.enum(["true", "false"]).default("false"),
  CREATIVE_AI_PROVIDER: z.enum(["mock","openai"]).default("mock"),
  CREATIVE_AI_MODEL: z.string().min(1).default("gpt-5.4-nano"),
  OPENAI_API_KEY: z.preprocess(value=>value===""?undefined:value,z.string().min(20).optional()),
}).superRefine((value,ctx)=>{
  if(value.CREATIVE_AI_PROVIDER==="openai"&&!value.OPENAI_API_KEY)ctx.addIssue({code:"custom",path:["OPENAI_API_KEY"],message:"OPENAI_API_KEY is required when CREATIVE_AI_PROVIDER=openai"});
});

const parsed = serverEnvSchema.safeParse({
  ALLOW_DEV_MOCK_SEED: process.env.ALLOW_DEV_MOCK_SEED,
  CREATIVE_AI_PROVIDER: process.env.CREATIVE_AI_PROVIDER,
  CREATIVE_AI_MODEL: process.env.CREATIVE_AI_MODEL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
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
});
