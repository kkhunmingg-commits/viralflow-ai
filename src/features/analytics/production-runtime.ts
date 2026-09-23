import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TikTokTokenService } from "@/features/tiktok/services";
import { serverEnv } from "@/lib/server-env";
import { ProductionAnalyticsIngestion, selectAnalyticsProvider, type TokenAccess } from "./production-ingestion";

export function createProductionAnalyticsIngestion(admin: SupabaseClient) {
  const provider = selectAnalyticsProvider({ provider: serverEnv.tiktokAnalyticsProvider,
    realMode: serverEnv.tiktokAnalyticsRealMode, oauthOfficial: serverEnv.tiktokProvider === "official",
    credentialsReady: Boolean(serverEnv.supabaseSecretKey && serverEnv.tiktokClientSecret && serverEnv.tiktokTokenEncryptionKey) });
  const tokens: TokenAccess = {
    getAccessToken(ownerId, accountId, refreshBufferMs) {
      return new TikTokTokenService(admin).getAccessToken(ownerId, accountId, refreshBufferMs);
    },
  };
  return new ProductionAnalyticsIngestion(admin, provider, tokens);
}
