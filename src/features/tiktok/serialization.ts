export function publicTikTokAccount(account: Record<string, unknown>) {
  const forbidden = ["access_token", "refresh_token", "ciphertext", "token_secret_ref"];
  return Object.fromEntries(
    Object.entries(account).filter(([key]) => !forbidden.some((part) => key.includes(part))),
  );
}
