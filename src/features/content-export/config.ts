import "server-only";
import { serverEnv } from "@/lib/server-env";
export function contentExportConfig() {
  return { enabled: process.env.CONTENT_EXPORT_ENABLED === "true", key: serverEnv.falKey ?? "",
    allowedOwners: (process.env.CONTENT_EXPORT_ALLOWED_OWNER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean),
    brainModel: "google/gemini-2.5-flash-lite", dailyCapUsd: 5, monthlyCapUsd: 30 };
}
