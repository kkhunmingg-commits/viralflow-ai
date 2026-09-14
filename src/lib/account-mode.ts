export type AccountMode = "growth" | "affiliate";

export function detectAccountMode({
  followerCount,
  ecommercePermission,
}: {
  followerCount: number | null;
  ecommercePermission: boolean | null;
}): AccountMode {
  return followerCount !== null &&
    followerCount >= 1_000 &&
    ecommercePermission === true
    ? "affiliate"
    : "growth";
}

