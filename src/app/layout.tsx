import type { Metadata, Viewport } from "next";
import { Manrope, Noto_Sans_Thai } from "next/font/google";
import { PwaBoot } from "@/components/pwa/pwa-boot";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai" });

export const metadata: Metadata = {
  title: { default: "ViralFlow AI", template: "%s · ViralFlow AI" },
  description: "ศูนย์ควบคุมคอนเทนต์และข้อมูล TikTok Affiliate สำหรับประเทศไทย",
  applicationName: "ViralFlow",
  appleWebApp: { capable: true, title: "ViralFlow", statusBarStyle: "black-translucent" },
  icons: {
    // Same artwork as the TikTok app icon (public/icons/vf-icon-1024.png). Keep them identical.
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/vf-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/vf-favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/vf-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/vf-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/icons/vf-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d1018",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={manrope.variable + " " + thai.variable}>
      <body>{children}<PwaBoot /></body>
    </html>
  );
}

