import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "Viral Flow AI — TikTok Reviewer Access Guide" },
  description: "วิธีตรวจ Viral Flow AI: Login, Login Kit, เลือกบัญชี และการทดสอบ Direct Post ใน Sandbox ที่ได้รับอนุญาต",
};

export default function ReviewerGuide() {
  return <main className="legal-main"><div className="legal-intro">
    <p className="legal-kicker">VIRAL FLOW AI · REVIEWER ACCESS</p><h1>Viral Flow AI<br />คู่มือสำหรับผู้ตรวจ</h1>
    <p>เว็บไซต์และเอกสารเปิดได้โดยไม่เข้าสู่ระบบ ส่วนบัญชีและคอนเทนต์ส่วนบุคคลต้อง Login ตามปกติ หน้านี้อธิบาย flow จริง ไม่ใช่หน้าจำลองการโพสต์</p></div>
    <article className="legal-card"><div className="legal-card-accent" /><div className="legal-content">
      <section><h2>1. Login เข้า Viral Flow AI</h2><p>เปิด <Link href="/login">Login</Link> ใช้ Continue with Google หรืออีเมลและรหัสผ่านของบัญชีทดสอบที่เจ้าของส่งผ่านช่อง App Review อย่างเป็นส่วนตัว ห้ามใส่รหัสผ่านหรือข้อมูลรับรองบนเว็บไซต์สาธารณะ</p><p>บัญชีทดสอบสำหรับผู้ตรวจต้องเข้าระบบได้จริงและได้รับสิทธิ์ใช้งานที่จำเป็น หากไม่ได้รับบัญชีทดสอบ กรุณาติดต่อเจ้าของแอปผ่าน <Link href="/support">Support</Link></p></section>
      <section><h2>2. Connect TikTok ผ่าน Login Kit</h2><p>เปิด <Link href="/accounts">Accounts</Link> → เชื่อม TikTok บัญชีอื่น → เชื่อมผ่านเว็บ เลือกบัญชี TikTok ที่อยู่ใน Sandbox target users และยืนยันบนหน้าของ TikTok ระบบจะกลับเข้าหน้าแอปพร้อมบัญชีที่เชื่อมต่อ ห้ามใช้บัญชีที่ไม่ได้รับอนุญาตทดสอบ</p><p>การเชื่อมต่อใช้ข้อมูลโปรไฟล์พื้นฐานและสิทธิ์ Direct Post ที่ได้รับ ไม่มีการขอ draft upload ใน flow นี้</p></section>
      <section><h2>3. เลือกบัญชีและเตรียมวิดีโอ</h2><p>กลับ Accounts ตรวจบัญชีที่เลือก จากนั้นเปิด Home เพื่อดูการเตรียมงาน เครื่องมือ Direct Post Sandbox ของรุ่นนี้ใช้ไฟล์ MP4 ทดสอบสั้นที่ระบบเตรียมไว้แล้ว โดยไม่เรียกการสร้างวิดีโอแบบเสียเงิน ไม่ใช่หน้าอัปโหลด MP4 ทั่วไป</p><p>เครื่องมือทดสอบ Sandbox ของรุ่นนี้จำกัดให้เจ้าของทดสอบบัญชีที่กำหนดไว้ ไม่ได้เปิดให้สมาชิกทุกคนโพสต์ทดสอบจากหน้า Home ผู้ตรวจที่ใช้บัญชีอื่นต้องให้เจ้าของจัดเตรียมสิทธิ์ทดสอบก่อน</p></section>
      <section><h2>4. ตรวจรายละเอียดก่อนส่ง</h2><p>ตรวจตัวอย่างคลิป บัญชีผู้รับ ข้อความ สิทธิ์ในเสียงและภาพ และการตั้งค่าการรับชม ใช้บัญชี TikTok Private และเลือก “เฉพาะฉัน” เท่านั้นใน Sandbox ของแอปที่ยังไม่ได้รับอนุมัติ การส่งต้องได้รับความยินยอมของเจ้าของบัญชี</p></section>
      <section><h2>5. Direct Post ผ่าน Content Posting API</h2><p>เจ้าของใช้เครื่องมือทดสอบ Sandbox ที่มีอยู่ของระบบ ส่งคลิปจริงไป TikTok แล้วติดตามผลจนเผยแพร่เสร็จหรือได้รับเหตุผลที่ล้มเหลวจาก TikTok การส่งไฟล์เสร็จยังไม่ถือว่าโพสต์เสร็จ ตรวจคลิปในบัญชี TikTok เป้าหมายด้วย</p><p>หากรุ่นเว็บที่ส่งตรวจไม่มีปุ่มเตรียม/ส่งคลิปให้ผู้ตรวจใช้งานเอง เจ้าของต้องให้ demo ของ flow จริงพร้อมคำอธิบายข้อจำกัดใน App Review ไม่ควรรายงานว่าผู้ตรวจสามารถทดสอบครบได้จากหน้านี้</p></section>
      <section><h2>ลำดับ demo ที่ต้องตรวจสอบก่อนส่งใหม่</h2><ol><li>เปิดเว็บไซต์ Viral Flow AI บนโดเมนเดียวกับ Website URL และแสดง Privacy / Terms</li><li>Login → Accounts → เชื่อม TikTok → หน้าการอนุญาตจริง → กลับมาบัญชีที่เชื่อม</li><li>เลือกบัญชี → เตรียมวิดีโอ → ตรวจรายละเอียดและความยินยอม</li><li>Direct Post เฉพาะฉัน → แสดงผลสุดท้ายและคลิปใน TikTok</li></ol><p>AI LIVE ไม่ใช่ส่วนที่ขออนุมัติในรอบนี้ ไม่ใช้ mock หรือผลสำเร็จจำลองใน demo</p></section>
      <section className="legal-callout"><h2>ข้อมูลสำหรับการส่ง review</h2><p>ส่งข้อมูลรับรองบัญชีทดสอบผ่านช่อง Review ของ TikTok Developer Portal เท่านั้น เว็บไซต์นี้ไม่เก็บหรือแสดงรหัสผ่านผู้ตรวจ อ่าน <Link href="/product-guide">Product guide</Link> สำหรับขอบเขตบริการ</p></section>
    </div></article></main>;
}
