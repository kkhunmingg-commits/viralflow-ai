import type { Metadata } from "next";
import Image from "next/image";
import { signOut } from "@/app/(app)/actions";
import { createClient } from "@/lib/supabase/server";
import "./profile.css";

export const metadata: Metadata = { title: "โปรไฟล์" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const name = profile?.display_name || (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null)
    || user.email?.split("@")[0] || "สมาชิก ViralFlow";
  const rawAvatar = user.app_metadata.provider === "google" && typeof user.user_metadata?.avatar_url === "string"
    ? user.user_metadata.avatar_url : null;
  let avatar: string | null = null;
  if (rawAvatar) {
    try { const url = new URL(rawAvatar); if (url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) avatar = url.href; }
    catch { /* Fall back to an initial. */ }
  }
  return <div className="profile-page">
    <header><p className="profile-eyebrow">บัญชีของคุณ</p><h1>โปรไฟล์</h1><p>ข้อมูลที่ใช้กับ ViralFlow</p></header>
    <section className="profile-card profile-identity" aria-label="ข้อมูลสมาชิก">
      {avatar ? <Image src={avatar} alt="" width={72} height={72} unoptimized referrerPolicy="no-referrer" />
        : <span className="profile-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
      <div><h2>{name}</h2><p>{user.email}</p></div>
    </section>
    <section className="profile-card" aria-label="แพ็กเกจสมาชิก"><p className="profile-eyebrow">สมาชิก</p>
      <h2>ข้อมูลแพ็กเกจ</h2><p>ยังไม่มีข้อมูลแพ็กเกจหรือวันต่ออายุในบัญชีนี้</p>
    </section>
    <div className="profile-actions">
      <button type="button" disabled title="ยังไม่มีระบบแพ็กเกจให้จัดการ">จัดการแพ็กเกจ</button>
      <button type="button" disabled title="ยังไม่เปิดให้แก้ไขข้อมูลบัญชี">ตั้งค่าบัญชี</button>
      <form action={signOut}><button type="submit">ออกจากระบบ</button></form>
    </div>
  </div>;
}
