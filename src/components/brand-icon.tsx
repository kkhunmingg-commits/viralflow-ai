/* eslint-disable @next/next/no-img-element */
/** The Viral Flow AI app icon: the exact artwork submitted to TikTok (public/icons/vf-icon-1024.png).
 * Every logo on the site uses this so the website, favicon and TikTok Basic Info match. */
export function BrandIcon({ className, size = 40 }: { className?: string; size?: number }) {
  return <img src="/icons/vf-brand-256.png" alt="" aria-hidden="true" width={size} height={size} className={`brand-icon ${className ?? ""}`.trim()} />;
}
