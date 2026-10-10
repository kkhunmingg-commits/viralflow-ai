import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InboxUpload } from "./upload";
import "../../accounts.css";

export const metadata = { title: "ส่งวิดีโอเข้า TikTok" };
export default async function InboxUploadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) notFound();
  const { data: account } = await client.from("tiktok_accounts").select("id,display_name,username,is_mock,authorization_status,granted_scopes")
    .eq("id", id).eq("owner_id", data.user.id).single();
  if (!account || account.is_mock) notFound();
  return <div className="accounts-page">
    <Link className="accounts-detail-link" href={`/accounts/${id}`}>← กลับไปบัญชี</Link>
    <header className="accounts-hero"><div className="accounts-hero-copy"><p className="accounts-overline">Viral Flow AI</p>
      <h1>ส่งวิดีโอเข้า TikTok</h1><p>{account.display_name} {account.username ? `· @${account.username}` : ""}</p></div></header>
    <section className="accounts-card">
      <p>เลือกวิดีโอที่คุณมีสิทธิ์ใช้งาน แล้วส่งเข้า TikTok เพื่อเปิดตรวจ แก้ไข และเลือกการรับชมด้วยตัวเอง การส่งนี้ยังไม่เผยแพร่โพสต์</p>
      <p>ขณะทดสอบ ใช้เฉพาะบัญชี Sandbox ที่ได้รับอนุญาต และเลือก “เฉพาะฉัน” ใน TikTok</p>
      {account.authorization_status !== "authorized" || !account.granted_scopes?.includes("video.upload")
        ? <><p>เชื่อมบัญชีอีกครั้งเพื่ออนุญาตการส่งวิดีโอเข้า TikTok แล้วกลับมาหน้านี้</p>
          <Link className="accounts-connect" href="/auth/tiktok/start?inbox=1&new_account=1">อนุญาตส่งวิดีโอเข้า TikTok</Link></>
        : <InboxUpload accountId={id} />}
    </section>
  </div>;
}
