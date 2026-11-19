import type { Metadata } from "next";
import { LiveOverlayClient } from "./overlay-client";

export const metadata: Metadata = { title: "Live overlay", robots: { index: false, follow: false } };

/**
 * OBS Browser Source (720x1280, transparent) laid over Praew's picture on the home PC. No sign-in: the link's
 * secret is checked by /live-overlay/data. Set up from the AI LIVE page ("องค์ประกอบบนจอไลฟ์").
 */
export default async function LiveOverlayPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const { k } = await searchParams;
  return <LiveOverlayClient token={k ?? ""} />;
}
