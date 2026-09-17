import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { serverEnv } from "@/lib/server-env";

export const metadata: Metadata = { title: "เชื่อม TikTok" };

const scenarios = [
  ["connected", "CONNECTED", "ให้สิทธิ์เฉพาะข้อมูลพื้นฐาน"],
  ["partial", "PARTIAL", "ขาด video.publish และ video.upload"],
  ["upload_ready", "READY_FOR_UPLOAD", "พร้อมส่ง draft ไปให้ผู้ใช้ตรวจใน TikTok"],
  ["direct_ready", "READY_FOR_DIRECT_POST", "scope, app approval, audit และ creator_info พร้อม"],
  ["private_only", "PRIVATE_ONLY", "มี video.publish แต่ client ยังไม่ผ่าน audit"],
  ["expired", "REAUTH_REQUIRED", "access token หมดอายุ"],
  ["revoked", "REAUTH_REQUIRED", "สิทธิ์ถูกเพิกถอน"],
  ["creator_failure", "Creator error", "ทดสอบ creator_info ล้มเหลวแบบ fail-closed"],
] as const;

export default async function ConnectTikTokPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <>
      <PageHeading
        eyebrow="TIKTOK OAUTH"
        title="เชื่อมบัญชี TikTok"
        description="เริ่ม OAuth จาก server, ตรวจ state แบบใช้ครั้งเดียว และเก็บ token แบบเข้ารหัสโดยไม่ส่งไป browser"
        action={<Link className="secondary-action" href="/accounts">กลับไปบัญชี</Link>}
      />
      {error ? <p className="notice danger">เชื่อมต่อไม่สำเร็จ: <code>{error}</code></p> : null}
      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">PROVIDER</p><h2>{serverEnv.tiktokProvider === "mock" ? "MockTikTokProvider" : "OfficialTikTokProvider"}</h2></div>
          <span className="status-badge ready">ไม่มีการโพสต์คลิปใน Phase 7A</span>
        </div>
        {serverEnv.tiktokProvider === "mock" ? (
          <div className="account-cards">
            {scenarios.map(([scenario, status, description]) => (
              <article className="account-card" key={scenario}>
                <span className="status-badge ready">{status}</span>
                <h3>{scenario}</h3>
                <p>{description}</p>
                <Link className="primary-action" href={`/auth/tiktok/start?scenario=${scenario}`}>Connect TikTok</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="large-empty">
            <h2>Official TikTok Login Kit</h2>
            <p>ร้องขอเฉพาะ user.info.basic, video.publish และ video.upload โดยสิทธิ์จริงขึ้นกับ app approval และการยินยอมของผู้ใช้</p>
            <Link className="primary-action" href="/auth/tiktok/start">Connect TikTok</Link>
          </div>
        )}
      </section>
    </>
  );
}
