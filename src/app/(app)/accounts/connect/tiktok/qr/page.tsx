import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { TikTokQrConnect } from "./tiktok-qr-connect";

export const metadata: Metadata = { title: "เชื่อม TikTok ด้วย QR" };

export default function TikTokQrConnectPage() {
  return <>
    <PageHeading
      eyebrow="TIKTOK LOGIN KIT"
      title="เชื่อม TikTok บัญชีอื่น"
      description="สแกนด้วยแอป TikTok ที่เข้าสู่บัญชีที่ต้องการเชื่อม ระบบจะบันทึกแต่ละบัญชีแยกจากกัน"
      action={<Link className="secondary-action" href="/accounts">กลับไปบัญชี</Link>}
    />
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">QR CODE AUTHORIZATION</p><h2>เลือกบัญชีบนโทรศัพท์ของคุณ</h2></div></div>
      <p>ก่อนอนุญาต โปรดตรวจว่าแอป TikTok บนโทรศัพท์แสดงบัญชีที่ต้องการ เช่น <strong>rorarisgirl</strong> การสแกนนี้จะไม่ตัดการเชื่อมต่อบัญชีอื่น</p>
      <TikTokQrConnect />
      <p><Link href="/auth/tiktok/start?new_account=1">ใช้การเชื่อมผ่านเว็บแทน</Link></p>
    </section>
  </>;
}
