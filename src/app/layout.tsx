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
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
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

