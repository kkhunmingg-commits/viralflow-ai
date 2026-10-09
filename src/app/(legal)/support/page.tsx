import type { Metadata } from "next";
import Link from "next/link";
import { SupportContact } from "../../support-contact";

export const metadata: Metadata = {
  title: { absolute: "Viral Flow AI — Contact & Support" },
  description: "ติดต่อ Viral Flow AI ที่ kkhunmingg@gmail.com สำหรับความช่วยเหลือ การยกเลิกบริการ และคำขอลบข้อมูลส่วนบุคคล",
};

export default function SupportPage() {
  return <main className="legal-main">
    <div className="legal-intro"><p className="legal-kicker">VIRAL FLOW AI · CONTACT</p><h1>Viral Flow AI<br />Contact &amp; Support</h1><p>ช่องทางติดต่ออย่างเป็นทางการสำหรับบริการและข้อมูลส่วนบุคคล</p></div>
    <article className="legal-card"><div className="legal-card-accent" aria-hidden="true" /><div className="legal-content">
      <section><h2>ติดต่อทีมดูแลบริการ</h2><SupportContact /><p>ระบุหน้าที่พบปัญหาและขั้นตอนที่ทำก่อนเกิดปัญหา หากแนบภาพ ให้ปิดข้อมูลส่วนตัวและข้อมูลรับรองก่อนส่ง เราไม่ได้รับรหัสผ่าน TikTok ผ่านอีเมล</p></section>
      <section><h2>ขอลบข้อมูลหรือยุติการใช้งาน</h2><p>ส่งคำขอจากอีเมลที่ใช้เข้าสู่ระบบ พร้อมระบุว่าต้องการลบบัญชี Viral Flow AI หรือข้อมูลใด เราจะตรวจสอบความเป็นเจ้าของก่อนดำเนินการ ไม่ต้องส่งรหัสผ่านหรือโทเคน การลบข้อมูลในบริการไม่ลบโพสต์บน TikTok โดยอัตโนมัติ</p><p>คุณยกเลิกการเชื่อม TikTok รายบัญชีจาก Accounts หรือถอนสิทธิ์ใน TikTok ได้ด้วยตนเอง อ่านรายละเอียดใน <Link href="/privacy">Privacy Policy</Link> และ <Link href="/terms">Terms of Service</Link></p></section>
      <section><h2>วิธีเข้าใช้งานและตรวจบริการ</h2><p><Link href="/product-guide">Product guide</Link> อธิบายขั้นตอนที่มีอยู่จริง ส่วน <Link href="/review-guide">Reviewer guide</Link> ระบุวิธีเข้าใช้และข้อจำกัด Sandbox โดยไม่เปิดเผยรหัสผ่านบนเว็บไซต์</p></section>
    </div></article>
  </main>;
}
