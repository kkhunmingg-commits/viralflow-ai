export const tiktokOfficialRequirements = [
  ["SUPABASE_SECRET_KEY", "Supabase server key"],
  ["TIKTOK_CLIENT_KEY", "TikTok Client Key"],
  ["TIKTOK_CLIENT_SECRET", "TikTok Client Secret"],
  ["TIKTOK_REDIRECT_URI", "TikTok Redirect URI"],
  ["TIKTOK_TOKEN_ENCRYPTION_KEY", "TikTok token encryption key"],
] as const;

type TikTokOfficialConfig = Partial<Record<(typeof tiktokOfficialRequirements)[number][0], string | undefined>>;

export function missingTikTokOfficialConfig(values: TikTokOfficialConfig) {
  return tiktokOfficialRequirements.filter(([key]) => !values[key]?.trim()).map(([key]) => key);
}

export function assertTikTokOfficialConfig(values: TikTokOfficialConfig) {
  const missing = missingTikTokOfficialConfig(values);
  if (missing.length) throw new Error(`TikTok official configuration missing: ${missing.join(", ")}`);
}

export function tiktokRequirementLabel(key: (typeof tiktokOfficialRequirements)[number][0]) {
  return tiktokOfficialRequirements.find(([name]) => name === key)?.[1] ?? key;
}
