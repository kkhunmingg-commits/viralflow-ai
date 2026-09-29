import type { Metadata } from "next";
import Link from "next/link";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import "../../accounts.css";

export const metadata: Metadata = { title: "เชื่อม TikTok" };

export default async function ConnectTikTokPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const available = serverEnv.tiktokProvider === "official" && tiktokOfficialSetupMissing.length === 0;
  return <div className="accounts-page account-customer-detail">
    <Link className="accounts-detail-link" href="/accounts">← กลับไปบัญชีทั้งหมด</Link>
    <header className="accounts-hero"><div className="accounts-hero-copy"><p className="accounts-overline">เพิ่มบัญชี</p>
      <h1>เชื่อม TikTok</h1><p>เลือกบัญชีที่คุณต้องการใช้กับ ViralFlow</p></div></header>
    {error && <p className="accounts-setup" role="alert">เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง</p>}
    <section className="accounts-card account-connect-choice">
      {available ? <><h2>เชื่อมบัญชีของคุณ</h2><p>คุณจะไปที่ TikTok เพื่อยืนยัน แล้วกลับมาที่ ViralFlow</p>
        <div className="accounts-card-actions"><Link className="accounts-connect" href="/auth/tiktok/start?new_account=1">เชื่อมผ่านเว็บ</Link>
          <Link className="accounts-detail-link" href="/accounts/connect/tiktok/qr">เชื่อมด้วย QR →</Link></div></>
        : <><h2>ยังเชื่อม TikTok ไม่ได้</h2><p>ระบบยังไม่พร้อมรับการเชื่อมต่อ กรุณาลองอีกครั้งภายหลัง</p></>}
    </section>
  </div>;
}
