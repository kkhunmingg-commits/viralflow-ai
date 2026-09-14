import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ตั้งค่า" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, locale, timezone")
    .eq("id", userData.user?.id ?? "")
    .maybeSingle();

  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE"
        title="ตั้งค่าระบบ"
        description="ข้อมูลพื้นที่ทำงาน ภาษา เขตเวลา และนโยบายพื้นฐาน"
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">PROFILE</p><h2>Workspace profile</h2></div>
          <span className="health-badge">SECURED BY RLS</span>
        </div>
        <dl className="settings-list">
          <div><dt>ชื่อที่แสดง</dt><dd>{profile?.display_name || "ยังไม่ได้ตั้งค่า"}</dd></div>
          <div><dt>อีเมลเจ้าของ</dt><dd>{userData.user?.email}</dd></div>
          <div><dt>ภาษา</dt><dd>{profile?.locale || "th-TH"}</dd></div>
          <div><dt>เขตเวลา</dt><dd>{profile?.timezone || "Asia/Bangkok"}</dd></div>
        </dl>
        <button className="secondary-action" disabled>แก้ไขโปรไฟล์ในเฟสถัดไป</button>
      </section>
    </>
  );
}

