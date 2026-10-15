import Image from "next/image";

/** Same owner-supplied VF artwork as TikTok Basic Info; no CSS-drawn substitute. */
export function BrandIcon({ size = 40, className = "", priority = false }: {
  size?: number; className?: string; priority?: boolean;
}) {
  return <Image src="/brand/viral-flow-ai-vf.png?v=c50a95595c7c" alt="Viral Flow AI"
    width={size} height={size} className={`shrink-0 rounded-xl object-contain ${className}`}
    unoptimized priority={priority} />;
}
