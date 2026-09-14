import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  ALLOW_DEV_MOCK_SEED: z.enum(["true", "false"]).default("false"),
});

const parsed = serverEnvSchema.safeParse({
  ALLOW_DEV_MOCK_SEED: process.env.ALLOW_DEV_MOCK_SEED,
});

if (!parsed.success) {
  throw new Error(
    "Invalid server environment variables: " + z.prettifyError(parsed.error),
  );
}

export const serverEnv = Object.freeze({
  allowDevMockSeed: parsed.data.ALLOW_DEV_MOCK_SEED === "true",
});
