import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "Viral Flow AI — POST & Multi-account Product Guide" },
  description: "การใช้งานจริงของ Viral Flow AI: เชื่อมหลายบัญชี TikTok เตรียมวิดีโอ ตรวจรายละเอียด และติดตามการเผยแพร่ตามสิทธิ์ที่ได้รับ",
};

export default function ProductGuide() {
  return <main className="legal-main">
    <div className="legal-intro"><p className="legal-kicker">VIRAL FLOW AI · PRODUCT GUIDE</p>
      <h1>พื้นที่ทำงาน POST<br />และบัญชี TikTok ของคุณ</h1>
      <p>สำหรับครีเอเตอร์และผู้สร้างคอนเทนต์แนะนำสินค้า ที่ต้องการเตรียมงานและดูแลหลายบัญชีในบริการเดียว โดยเลือกบัญชีและตรวจคอนเทนต์ก่อนเผยแพร่</p></div>
    <article className="legal-card"><div className="legal-card-accent" /><div className="legal-content">
      <section><h2>1. เชื่อม TikTok — Connect</h2><p>เข้าสู่ระบบ Viral Flow AI แล้วเปิด Accounts เลือก “เชื่อม TikTok บัญชีอื่น” และ “เชื่อมผ่านเว็บ” คุณจะเข้าสู่หน้าอนุญาตของ TikTok เลือกบัญชีที่คุณมีสิทธิ์จัดการ ตรวจสิทธิ์ที่ขอ แล้วกลับมาที่บริการ</p>
        <figure><Image src="/connect-workflow.jpg" alt="ภาพหน้าเชื่อม TikTok จริงของ Viral Flow AI พร้อมปุ่มเชื่อมผ่านเว็บ" width={547} height={430} className="product-guide-image" /><figcaption>ภาพจากแอปจริง ตัดพื้นที่โปรไฟล์ออกเพื่อไม่เปิดเผยข้อมูลส่วนบุคคล</figcaption></figure></section>
      <section><h2>2. จัดการหลายบัญชี</h2><p>บัญชีที่เชื่อมแต่ละบัญชีแสดงแยกกันใน Accounts เลือก “เปิดบัญชี” เพื่อดูบัญชีนั้น เชื่อมเพิ่มได้โดยไม่แทนที่บัญชีอื่น และยกเลิกการเชื่อมต่อเฉพาะบัญชีที่เลือกได้ บัญชีเดิมที่ยกเลิกแล้วสามารถเอาออกจากรายการได้โดยไม่ลบประวัติงาน</p>
        <figure><Image src="/accounts-workflow.jpg" alt="ภาพหัวหน้า Accounts จริงของ Viral Flow AI พร้อมปุ่มเชื่อม TikTok บัญชีอื่น" width={547} height={178} className="product-guide-image" /><figcaption>ภาพส่วนควบคุม Accounts จริง ไม่แสดงชื่อ รูป หรือข้อมูลของเจ้าของบัญชี</figcaption></figure></section>
      <section><h2>3. เตรียมเนื้อหาและวิดีโอ — Create</h2><p>เปิด Home เลือกบัญชีและโหมด AUTO, GROWTH หรือ AFFILIATE กำหนดเป้าหมายและงบของงาน เลือกสินค้าที่มีสิทธิ์นำเสนอ เตรียมไอเดีย บทพูดและคลิป ตรวจข้อความบนภาพ เสียง และข้อมูลสินค้าตามข้อเท็จจริง</p><p>การสร้างวิดีโอขึ้นกับความพร้อมและงบที่ตั้งไว้ หากยังไม่พร้อม ระบบจะแสดงสิ่งที่ต้องดำเนินการ ไม่แสดงผลสร้างสำเร็จจำลอง</p></section>
      <section><h2>4. ตรวจรายละเอียด — Review</h2><p>ดูตัวอย่างวิดีโอ ตรวจบัญชีปลายทาง ข้อความประกอบ สิทธิ์ในภาพและเสียง การเปิดเผยเนื้อหาเชิงพาณิชย์ และการตั้งค่าการรับชมที่ TikTok อนุญาต การเชื่อมบัญชีไม่ได้สั่งโพสต์ให้อัตโนมัติ</p></section>
      <section><h2>5. เผยแพร่และติดตาม — Publish</h2><p>เมื่อสิทธิ์บัญชีและแอปพร้อม จึงส่งคอนเทนต์ที่คุณอนุญาตผ่านการเผยแพร่ไป TikTok ติดตามผลจนสำเร็จหรือแสดงปัญหา การเผยแพร่สาธารณะยังขึ้นกับการอนุมัติ TikTok</p><p>การทดสอบ Sandbox จำกัดบัญชีทดสอบที่เจ้าของแอปกำหนดและใช้การรับชม “เฉพาะฉัน” สำหรับบัญชีส่วนตัว รายละเอียดการทดสอบอยู่ใน <Link href="/review-guide">Reviewer guide</Link> ไม่มีการอ้างว่าเปิดโพสต์สาธารณะก่อนอนุมัติ</p></section>
      <section><h2>6. ผลลัพธ์และการเรียนรู้</h2><p>Home แสดงสถานะงาน งานที่รอดำเนินการและผลล่าสุด ตัวชี้วัดจะแสดงเมื่อระบบมีข้อมูลจริง การเชื่อมบัญชีอย่างเดียวไม่ได้ทำให้มีข้อมูลยอดขายหรือผลการเข้าชม และไม่มีการรับประกันรายได้</p></section>
      <section className="legal-callout"><h2>ขอบเขต AI LIVE</h2><p>AI LIVE เป็นส่วนที่อยู่ระหว่างพัฒนา ไม่ใช่ฟังก์ชัน TikTok LIVE ที่เปิดใช้งานแล้ว และไม่อยู่ใน flow Login Kit / Content Posting ที่ขอ review ครั้งนี้</p></section>
      <section><h2>เริ่มใช้งาน</h2><p><Link href="/login">Login / Get Started</Link> → Accounts → เชื่อม TikTok → Home → เลือกบัญชีและเตรียมงาน อ่าน <Link href="/privacy">Privacy Policy</Link> และ <Link href="/terms">Terms of Service</Link> ก่อนเริ่มใช้บริการ</p></section>
    </div></article>
  </main>;
}
