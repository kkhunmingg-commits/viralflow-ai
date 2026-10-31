import type { Metadata } from "next";
import { Manrope, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai" });

export const metadata: Metadata = {
  title: { default: "ViralFlow AI", template: "%s · ViralFlow AI" },
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

