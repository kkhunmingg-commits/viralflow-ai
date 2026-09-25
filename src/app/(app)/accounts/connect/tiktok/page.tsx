import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import { tiktokRequirementLabel } from "@/lib/tiktok-config";

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
      {error ? <p className="notice danger" role="alert">{error === "tiktok_setup_required" ? "TikTok setup required — ตั้งค่าที่ขาดก่อนเชื่อมบัญชี" : "เชื่อมต่อ TikTok ไม่สำเร็จ โปรดลองอีกครั้งหรือตรวจการตั้งค่า"}</p> : null}
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
        ) : tiktokOfficialSetupMissing.length ? (
          <div className="large-empty">
            <h2>TikTok setup required</h2>
            <p>ยังไม่สามารถเริ่มการเชื่อมต่อได้ กรุณาเพิ่มค่าต่อไปนี้ในสภาพแวดล้อมของ server:</p>
            <ul>{tiktokOfficialSetupMissing.map((key) => <li key={key}>{tiktokRequirementLabel(key)} missing</li>)}</ul>
            <p>ระบบยังไม่ได้ติดต่อ TikTok และยังไม่ได้สร้าง OAuth request</p>
          </div>
        ) : (
          <div className="large-empty">
            <h2>Official TikTok Login Kit</h2>
            <p>{serverEnv.tiktokOAuthScopeMode === "basic"
              ? "เชื่อมบัญชีด้วย user.info.basic เท่านั้น บัญชีนี้ยังไม่พร้อมเผยแพร่จนกว่าแอปจะได้รับสิทธิ์ video.publish หรือ video.upload และผู้ใช้อนุญาต"
              : "ร้องขอ user.info.basic, video.publish และ video.upload โดยสิทธิ์จริงขึ้นกับ app approval และการยินยอมของผู้ใช้"}</p>
            <Link className="primary-action" href="/auth/tiktok/start">Connect TikTok</Link>
          </div>
        )}
      </section>
    </>
  );
}
