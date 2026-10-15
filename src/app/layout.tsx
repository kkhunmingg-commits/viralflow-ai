import type { Metadata } from "next";
import { Manrope, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai" });

export const metadata: Metadata = {
  applicationName: "Viral Flow AI",
  title: { default: "Viral Flow AI", template: "%s · Viral Flow AI" },
  icons: {
    shortcut: "/favicon.ico?v=c50a95595c7c",
    icon: { url: "/icon.png?v=c50a95595c7c", type: "image/png", sizes: "512x512" },
    apple: { url: "/apple-touch-icon.png?v=c50a95595c7c", type: "image/png", sizes: "180x180" },
  },
  description: "ศูนย์ควบคุมคอนเทนต์และข้อมูล TikTok Affiliate สำหรับประเทศไทย",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={manrope.variable + " " + thai.variable}>
      <body>{children}</body>
    </html>
  );
}

