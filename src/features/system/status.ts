export type SystemStatusTone = "ready" | "manual" | "waiting";

export interface SystemStatusItem {
  key: string;
  title: string;
  state: string;
  tone: SystemStatusTone;
  detail: string;
  href?: string;
  hrefLabel?: string;
}

/**
 * How each part of the system works today, for the owner. These follow the current external approvals:
 * best-seller data comes only from the TikTok Shop / Affiliate API (adapter disabled until granted),
 * Video Factory uses Google Flow, posting is a manual download, and AI LIVE waits for TikTok LIVE API approval.
 */
export const SYSTEM_STATUS: readonly SystemStatusItem[] = [
  {
    key: "video", title: "สร้างคลิป", state: "Google Flow", tone: "ready",
    detail: "ระบบเขียนบทและสั่งสร้างวิดีโอด้วย Google Flow",
  },
  {
    key: "posting", title: "โพสต์ลง TikTok", state: "ดาวน์โหลดไปโพสต์เอง", tone: "manual",
    detail: "ดาวน์โหลด MP4 พร้อมแคปชันแล้วกดโพสต์ในแอป TikTok",
    href: "/post", hrefLabel: "ไปดาวน์โหลด",
  },
  {
    key: "bestsellers", title: "สินค้าขายดี", state: "รอสิทธิ์ TikTok Shop API", tone: "waiting",
    detail: "ระหว่างรอ ใช้รายงานออเดอร์ Affiliate ที่นำเข้าเอง",
    href: "/analytics/import", hrefLabel: "นำเข้ารายงาน",
  },
  {
    key: "live", title: "AI LIVE", state: "รอ TikTok อนุมัติ LIVE API", tone: "waiting",
    detail: "ไลฟ์ตรงเข้า TikTok ไม่ใช้ OBS หรือ Stream key",
    href: "/ai-live", hrefLabel: "ดูแผนไลฟ์",
  },
];
