import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { bangkokDate, flowClipStatusLabels, type FlowClipStatus } from "@/features/flow-farm/contracts";
import { remainingCapacity } from "@/features/flow-farm/capacity";
import { listFlowAccounts, listLibrary, listTodayClips } from "@/features/flow-farm/service";
import { addFlowAccountAction, discardClipAction, flowAccountAction, markPostedAction, scheduleClipAction, startBatchAction, unscheduleClipAction } from "./actions";
import "../post/post.css";
import "./library.css";

export const metadata = { title: "คลังคลิป · Viral Flow AI" };
export const dynamic = "force-dynamic";

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Reads outside render so a missing table shows a notice instead of an error page. */
async function loadLibrary(client: Awaited<ReturnType<typeof createClient>>, owner: string, accountId?: string) {
  const settled = await Promise.allSettled([listFlowAccounts(client, owner), listTodayClips(client, owner), listLibrary(client, owner, accountId)]);
  const value = <T,>(result: PromiseSettledResult<T[]>) => result.status === "fulfilled" ? result.value : [];
  return { flowAccounts: value(settled[0]), today: value(settled[1]), library: value(settled[2]),
    unavailable: settled.some(result => result.status === "rejected"), now: Date.now() };
}

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ account?: string; msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/library");
  const owner = data.user.id, { account, msg } = await searchParams;
  const accountId = z.uuid().safeParse(account).success ? account : undefined;
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,daily_post_target,effective_mode")
    .eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = (accountsResult.data ?? []) as Array<{ id: string; display_name: string; daily_post_target: number | null; effective_mode: string | null }>;
  const names = new Map(accounts.map(a => [a.id, a.display_name]));
  const { flowAccounts, today, library, unavailable, now } = await loadLibrary(client, owner, accountId);
  const capacity = remainingCapacity(flowAccounts);
  const counts = today.reduce((map, clip) => map.set(clip.status, (map.get(clip.status) ?? 0) + 1), new Map<FlowClipStatus, number>());
  const defaultCount = Math.min(30, Math.max(1, accounts[0]?.daily_post_target ?? 5));

  return <div className="manual-page library-page">
    <header className="manual-hero"><div><p className="manual-eyebrow">ออโต้กึ่งแมนนวล</p><h1>คลังคลิป</h1>
      <p>กดปุ่มเดียว ระบบหาสินค้าและสร้างคลิปด้วย Google Flow อยู่เบื้องหลังในเครื่องของคุณ คลิปที่ผ่านการตรวจจะเข้ามารอในคลังนี้ โพสต์เสร็จแล้วระบบลบไฟล์ให้เอง</p></div>
      <Link className="manual-back" href="/auto">← กลับหน้าหลัก</Link></header>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}
    {unavailable && <p className="manual-warning">ยังอ่านข้อมูลคลังไม่ได้ (ฐานข้อมูลอาจยังไม่ได้อัปเดตตาราง flow_clips)</p>}

    <section className="manual-panel" aria-labelledby="start-title">
      <div className="manual-section-head"><div><p className="manual-eyebrow">วันนี้ {bangkokDate()}</p><h2 id="start-title">สร้างคลิปวันนี้</h2></div>
        <span className="manual-private">Flow ทำได้อีกประมาณ {capacity} คลิป</span></div>
      {accounts.length ? <form action={startBatchAction} className="library-start">
        <label className="manual-filter">บัญชี TikTok<select name="accountId" defaultValue={accountId ?? accounts[0].id}>
          {accounts.length > 1 && <option value="ALL">ทุกบัญชี</option>}
          {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name}{a.effective_mode === "AFFILIATE" ? " · ขายของ" : " · ปั้นช่อง"}</option>)}</select></label>
        <label className="manual-filter">คลิปต่อบัญชีวันนี้<input name="count" type="number" min={1} max={30} defaultValue={defaultCount} /></label>
        <button className="manual-primary" type="submit" disabled={!flowAccounts.some(f => f.active)}>ค้นหาสินค้าและสร้างคลิป</button>
      </form> : <p className="manual-warning">เชื่อมบัญชี TikTok ก่อน <Link href="/accounts">ไปที่บัญชี →</Link></p>}
      <p className="manual-muted">บัญชีขายของใช้สินค้าขายดีที่มีรูปผ่านการตรวจสิทธิ์ (ข้อมูลจาก TikTok Shop API เมื่อได้สิทธิ์ ระหว่างนี้จากรายการที่นำเข้าเอง) บัญชีอุ่นเครื่องได้คลิปปั้นช่องไม่มีสินค้า
        ระบบใช้บัญชี Flow ตามลำดับ ใช้บัญชีแรกจนเครดิตหมดแล้วค่อยย้ายบัญชีถัดไป ถ้าทุกบัญชีหมด จะหยุดที่คลิปที่ทำได้แล้วและข้ามที่เหลือ</p>
      {today.length > 0 && <>
        <ul className="library-counts">{(["QUEUED", "GENERATING", "READY", "SCHEDULED", "POSTED", "FAILED", "SKIPPED_NO_CREDIT"] as FlowClipStatus[])
          .filter(s => counts.get(s)).map(s => <li key={s} className={`library-chip library-${s.toLowerCase()}`}>{flowClipStatusLabels[s]} <strong>{counts.get(s)}</strong></li>)}</ul>
        <details className="library-today"><summary>รายการวันนี้ ({today.length})</summary><ol>{today.map(clip => <li key={clip.id}>
          <span>{clip.title}</span><small>{names.get(clip.tiktok_account_id) ?? ""} · {flowClipStatusLabels[clip.status]}{clip.error ? ` (${clip.error})` : ""}</small></li>)}</ol></details>
      </>}
    </section>

    <section className="manual-panel" aria-labelledby="library-title">
      <div className="manual-section-head"><div><p className="manual-eyebrow">รอโพสต์</p><h2 id="library-title">คลิปในคลัง ({library.length})</h2></div>
        <form method="get"><label className="manual-filter">บัญชี<select name="account" defaultValue={accountId ?? ""}><option value="">ทุกบัญชี</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}</select></label><button className="manual-secondary" type="submit">แสดง</button></form></div>
      {library.length === 0 ? <div className="manual-empty"><h3>ยังไม่มีคลิปรอโพสต์</h3><p>กด “ค้นหาสินค้าและสร้างคลิป” แล้วเปิด Flow worker ในเครื่อง คลิปที่เสร็จจะมาอยู่ตรงนี้</p></div>
        : <div className="library-grid">{library.map(clip => {
          const due = clip.status === "SCHEDULED" && clip.scheduled_at && Date.parse(clip.scheduled_at) <= now;
          return <article key={clip.id} className="library-clip">
            <video controls playsInline preload="none" src={`/api/library/${clip.id}/video`} aria-label={clip.title} />
            <div className="library-clip-body">
              <h3>{clip.title}</h3>
              <p className="library-meta">{names.get(clip.tiktok_account_id) ?? ""} · {clip.kind === "AFFILIATE" ? "ขายของ" : "ปั้นช่อง"}{clip.duration_seconds ? ` · ${Number(clip.duration_seconds).toFixed(0)} วิ` : ""}</p>
              {clip.status === "SCHEDULED" && clip.scheduled_at && <p className={due ? "library-due" : "library-scheduled"}>{due ? "ถึงเวลาโพสต์แล้ว · " : "ตั้งเวลาไว้ · "}{bangkokTime(clip.scheduled_at)}</p>}
              <textarea className="library-caption" readOnly rows={3} defaultValue={[clip.caption, clip.hashtags.join(" ")].filter(Boolean).join("\n")} aria-label="คำบรรยายสำหรับคัดลอก" />
              <div className="library-actions">
                <a className="manual-primary" href={`/api/library/${clip.id}/video?download=1`}>ดาวน์โหลด MP4</a>
                <form action={markPostedAction} className="library-inline"><input type="hidden" name="id" value={clip.id} />
                  <input name="url" type="url" placeholder="ลิงก์โพสต์ TikTok (ไม่บังคับ)" aria-label="ลิงก์โพสต์ TikTok" />
                  <button className="manual-secondary" type="submit">โพสต์แล้ว · ลบไฟล์</button></form>
                <form action={scheduleClipAction} className="library-inline"><input type="hidden" name="id" value={clip.id} />
                  <input name="at" type="datetime-local" required aria-label="เวลาโพสต์ (เวลาไทย)" />
                  <button className="manual-secondary" type="submit">ตั้งเวลา</button></form>
                <div className="library-inline">
                  {clip.status === "SCHEDULED" && <form action={unscheduleClipAction}><input type="hidden" name="id" value={clip.id} /><button className="library-link" type="submit">ยกเลิกเวลา</button></form>}
                  <form action={discardClipAction}><input type="hidden" name="id" value={clip.id} /><button className="library-link danger" type="submit">ทิ้งคลิปนี้</button></form>
                </div>
              </div>
            </div>
          </article>;
        })}</div>}
      <p className="manual-muted">ตอนโพสต์ใน TikTok ให้เปิดป้าย “เนื้อหาที่สร้างด้วย AI” ทุกครั้ง การตั้งเวลาตอนนี้เป็นการเตือนในคลัง เมื่อ TikTok อนุมัติ API โพสต์อัตโนมัติ คลิปที่ตั้งเวลาไว้จะส่งขึ้นเองและลบไฟล์หลังโพสต์</p>
    </section>

    <section className="manual-panel" aria-labelledby="flow-title">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ลำดับการใช้เครดิต</p><h2 id="flow-title">บัญชี Google Flow</h2></div></div>
      {flowAccounts.length ? <ol className="library-flow-list">{flowAccounts.map((f, index) => <li key={f.id} className={f.active ? undefined : "paused"}>
        <div><strong>{index + 1}. {f.label}</strong><small>
          {!f.active ? "พักไว้" : f.exhaustedToday ? `เครดิตหมดวันนี้ · ทำไป ${f.clipsToday} คลิป` : `วันนี้ทำไป ${f.clipsToday} คลิป · คาดว่าได้ ${f.clipsPerDayEstimate}/วัน`}</small>
          <code>id: {f.id}</code></div>
        <form action={flowAccountAction} className="library-inline"><input type="hidden" name="id" value={f.id} />
          <button className="library-link" name="op" value="UP" type="submit" disabled={index === 0} aria-label="เลื่อนขึ้น">↑</button>
          <button className="library-link" name="op" value="DOWN" type="submit" disabled={index === flowAccounts.length - 1} aria-label="เลื่อนลง">↓</button>
          {f.exhaustedToday && <button className="library-link" name="op" value="RESET" type="submit">เติมเครดิตแล้ว</button>}
          <button className="library-link" name="op" value={f.active ? "PAUSE" : "RESUME"} type="submit">{f.active ? "พัก" : "ใช้งาน"}</button>
          <button className="library-link danger" name="op" value="REMOVE" type="submit">ลบ</button></form>
      </li>)}</ol> : <p className="manual-warning">ยังไม่มีบัญชี Flow เพิ่มอย่างน้อย 1 บัญชีก่อนเริ่ม</p>}
      <form action={addFlowAccountAction} className="library-start">
        <label className="manual-filter">ชื่อบัญชี (เช่น อีเมลย่อ)<input name="label" required maxLength={60} placeholder="flow-1" /></label>
        <label className="manual-filter">ประมาณคลิป/วัน<input name="clipsPerDay" type="number" min={1} max={200} defaultValue={5} /></label>
        <button className="manual-secondary" type="submit">เพิ่มบัญชี Flow</button></form>
      <p className="manual-muted">ตัวเลขคลิป/วันใช้ประมาณการเท่านั้น ระบบจะใช้บัญชีจนกว่า Flow แจ้งว่าเครดิตหมดจริง ล็อกอินแต่ละบัญชีในเครื่องครั้งแรกด้วย
        <code> .\scripts\flow-farm-d.ps1 -Login &lt;id&gt;</code> แล้วสั่งทำงานเบื้องหลังด้วย <code>.\scripts\flow-farm-d.ps1</code></p>
    </section>
  </div>;
}
