import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listManualClips, type ManualClip } from "@/features/manual-post/services";
import { LocalPreparation } from "./local-preparation";
import "./post.css";
export const metadata = { title: "โพสต์เอง · Viral Flow AI" };
export const dynamic = "force-dynamic";
export default async function ManualPostPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/post");
  const { account } = await searchParams;
  const accountId = z.uuid().safeParse(account).success ? account : undefined;
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,username")
    .eq("owner_id", data.user.id).is("hidden_at", null).order("created_at", { ascending: false });
  const accounts = accountsResult.data ?? [];
  let clips: ManualClip[] = [], unavailable = false;
  try { clips = await listManualClips(client, data.user.id, accountId); } catch { unavailable = true; }
  return <div className="manual-page">
    <header className="manual-hero"><div><p className="manual-eyebrow">Viral Flow AI</p><h1>โพสต์เอง ไม่ต้องรอ</h1>
      <p>เตรียมวิดีโอและคำบรรยาย แล้วนำไปโพสต์ใน TikTok ด้วยตัวเอง</p></div><Link className="manual-back" href="/auto">← กลับ Home</Link></header>
    <ol className="manual-steps" aria-label="วิธีโพสต์เอง"><li><span>1</span>เลือกคลิป</li><li><span>2</span>ตรวจและดาวน์โหลด</li><li><span>3</span>เปิด TikTok แล้วโพสต์</li></ol>
    <LocalPreparation accounts={accounts.map(account => ({ name: account.username ? account.display_name + " · @" + account.username.replace(/^@/, "") : account.display_name }))} />
    <section className="manual-panel" aria-labelledby="saved-title"><div className="manual-section-head"><div><p className="manual-eyebrow">คลิปจาก Viral Flow AI</p><h2 id="saved-title">คลิปที่บันทึกไว้</h2></div>
      <form method="get"><label className="manual-filter">บัญชี<select name="account" defaultValue={accountId ?? ""}><option value="">ทุกบัญชี</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.display_name}</option>)}</select></label><button className="manual-secondary" type="submit">แสดง</button></form></div>
      {unavailable ? <p className="manual-warning">ยังอ่านรายการคลิปไม่ได้ กรุณาลองอีกครั้ง คุณยังเตรียมไฟล์บนเครื่องได้ด้านบน</p>
        : clips.length === 0 ? <div className="manual-empty"><h3>ยังไม่มีคลิปที่บันทึกไว้</h3><p>เมื่อมีวิดีโอที่ผ่านการตรวจ จะดาวน์โหลดพร้อมคำบรรยายได้จากตรงนี้ ระหว่างนี้ใช้ MP4 ของคุณด้านบนได้</p></div>
        : <div className="manual-saved-list">{clips.map(clip => <article className="manual-saved-clip" key={clip.id}>
          <div><h3>{clip.name}</h3><p>{clip.accountName}</p>{clip.caption && <p className="manual-caption">{clip.caption}</p>}</div>
          {clip.ready ? <a className="manual-primary" href={`/api/post/clips/${clip.id}/download`} download>ดาวน์โหลดไปโพสต์</a>
            : <span className="manual-warning">ยังไม่ผ่านการตรวจครบ</span>}
        </article>)}</div>}
      <p className="manual-muted">ดาวน์โหลดได้เฉพาะไฟล์ที่ผ่านคุณภาพและการตรวจเนื้อหา การดาวน์โหลดไม่ถือว่าโพสต์แล้ว และไม่ส่งวิดีโอให้ TikTok อัตโนมัติ</p>
    </section>
    <aside className="manual-help"><h2>หลังดาวน์โหลด ทำอย่างไร?</h2><p>แตกไฟล์ ZIP → เปิด <strong>video.mp4</strong> ใน TikTok → ใส่คำบรรยายจาก <strong>caption.txt</strong> → ตรวจการรับชมและการระบุคอนเทนต์ AI → กดโพสต์ด้วยตัวเอง</p>
      <p>การสร้างคลิปอัตโนมัติยังขึ้นกับความพร้อมของระบบและงบ การดาวน์โหลดนี้ไม่ได้เปิดบริการสร้างวิดีโอแบบเสียเงิน</p></aside>
  </div>;
}
