import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { listManualClips, type ManualClip } from "@/features/manual-post/services";
import { LocalPreparation } from "./local-preparation";
import { ContentStudio } from "./content-studio";
import { FlowStudio, type StudioAccount } from "./flow-studio";
import { contentExportConfig } from "@/features/content-export/config";
import { listContentRuns } from "@/features/content-export/service";
import "./post.css";
export const metadata = { title: "สร้างคลิปฟรี · Viral Flow AI" };
export const dynamic = "force-dynamic";

/** Main path is free Google Flow clips (FlowStudio). The paid API path stays below, folded, as a backup only. */
export default async function ManualPostPage({ searchParams }: { searchParams: Promise<{ account?: string; mode?: string; msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/post");
  const { account, mode, msg } = await searchParams;
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,username,daily_post_target,effective_mode")
    .eq("owner_id", data.user.id).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = (accountsResult.data ?? []) as Array<StudioAccount & { username: string | null }>;
  const accountId = z.uuid().safeParse(account).success && accounts.some(a => a.id === account) ? account : accounts[0]?.id;
  const selected = accounts.find(a => a.id === accountId);
  const productsResult = await client.from("products").select("id,title").eq("owner_id", data.user.id).eq("status", "available").limit(100);
  const config = contentExportConfig();
  const initialRuns = await listContentRuns(client, data.user.id).catch(() => []);
  let clips: ManualClip[] = [], unavailable = false;
  try { clips = await listManualClips(client, data.user.id, accountId); } catch { unavailable = true; }
  return <div className="manual-page">
    <header className="manual-hero"><div><p className="manual-eyebrow">Viral Flow AI · Google Flow</p><h1>สร้างคลิปฟรี</h1>
      <p>ไม่เสียเงินต่อคลิป ใช้เครดิตฟรีของบัญชี Google ที่ผูกไว้ หมุนเวียนทุกวัน ระบบสร้างอยู่เบื้องหลังในคอมพิวเตอร์ของคุณ แล้วเก็บคลิปไว้ในคลังรอโพสต์</p></div>
      <Link className="manual-back" href="/auto">← กลับหน้าหลัก</Link></header>
    <ol className="manual-steps" aria-label="ขั้นตอน"><li><span>1</span>ผูกบัญชี Google (สูงสุด 5)</li><li><span>2</span>กดสร้างคลิปฟรี</li><li><span>3</span>ดาวน์โหลด/ตั้งเวลา แล้วโพสต์ (ลบไฟล์ให้เอง)</li></ol>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}

    {accounts.length === 0 ? <section className="manual-panel"><div className="manual-empty"><h3>ยังไม่มีบัญชี TikTok</h3><p>เชื่อมบัญชี TikTok ก่อน แล้วกลับมาผูกบัญชี Google เพื่อสร้างคลิปฟรี</p>
      <Link className="manual-primary" href="/accounts">เชื่อม TikTok →</Link></div></section> : <>
      <form method="get" className="flow-account-picker"><label className="manual-filter">บัญชี TikTok<select name="account" defaultValue={accountId}>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name}{a.effective_mode === "AFFILIATE" ? " · ขายของ" : " · ปั้นช่อง"}</option>)}</select></label>
        <button className="manual-secondary" type="submit">เปลี่ยนบัญชี</button></form>
      {selected && <FlowStudio client={client} owner={data.user.id} account={selected} />}
    </>}

    <details className="manual-panel flow-backup"><summary><strong>ระบบสำรอง (เสียเงินต่อคลิป)</strong><small>ใช้เมื่อเครดิตฟรีไม่พอหรือ Flow ใช้ไม่ได้เท่านั้น · ค่าใช้จ่ายตาม API</small></summary>
      <ContentStudio accounts={accounts.map(a => ({ id: a.id, display_name: a.display_name, username: a.username }))} products={productsResult.data ?? []}
        configured={config.enabled && Boolean(config.key) && config.allowedOwners.includes(data.user.id)} initialRuns={initialRuns} initialAccount={accountId} initialMode={mode} />
      <details className="manual-panel"><summary>ใช้ MP4 ที่มีอยู่แล้ว</summary><LocalPreparation accounts={accounts.map(a => ({ name: a.username ? a.display_name + " · @" + a.username.replace(/^@/, "") : a.display_name }))} /></details>
      <section aria-labelledby="saved-title"><h2 id="saved-title">คลิปจากระบบเดิมที่บันทึกไว้</h2>
        {unavailable ? <p className="manual-warning">ยังอ่านรายการคลิปไม่ได้ กรุณาลองอีกครั้ง</p>
          : clips.length === 0 ? <p className="manual-muted">ไม่มีคลิปจากระบบเดิม</p>
          : <div className="manual-saved-list">{clips.map(clip => <article className="manual-saved-clip" key={clip.id}>
            <div><h3>{clip.name}</h3><p>{clip.accountName}</p>{clip.caption && <p className="manual-caption">{clip.caption}</p>}</div>
            {clip.ready ? <a className="manual-primary" href={`/api/post/clips/${clip.id}/download`} download>ดาวน์โหลดไปโพสต์</a>
              : <span className="manual-warning">ยังไม่ผ่านการตรวจครบ</span>}
          </article>)}</div>}
      </section>
    </details>
  </div>;
}
