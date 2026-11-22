"use client";

import { useState } from "react";

/** A TikTok account's profile picture, served fresh by /api/accounts/[id]/avatar, with the initial as fallback. */
export function TikTokAccountAvatar({ accountId, name, size, className, fallbackClassName, hasAvatar = true }: {
  accountId: string; name: string; size: number; className: string; fallbackClassName: string; hasAvatar?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const initial = name.replace(/^@/, "").slice(0, 1).toUpperCase() || "T";
  if (!hasAvatar || failed) return <span className={fallbackClassName} aria-hidden="true">{initial}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={`/api/accounts/${accountId}/avatar`} alt="" width={size} height={size}
    loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
