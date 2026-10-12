import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OperatorStartForm } from "@/components/operator-start-form";
import { contentExportConfig } from "@/features/content-export/config";
import { statusLabels } from "@/features/content-export/contracts";
import { listContentRuns } from "@/features/content-export/service";
import { AutoRefresh } from "./auto-refresh";

type Account = { id: string; display_name: string; account_status: string; authorization_status: string; effective_mode: string; daily_post_target: number; daily_post_hard_limit: number };
export async function ContentHome({ client, owner, accounts, accountId, today, dayStart, dayEnd }: {
  client: SupabaseClient; owner: string; accounts: Account[]; accountId?: string; today: string; dayStart: string; dayEnd: string;
}) {
  const config = contentExportConfig();
  const configured = config.enabled && Boolean(config.key) && config.allowedOwners.includes(owner);
  const account = accounts.find(item => item.id === accountId);
  const runs = accountId ? await listContentRuns(client, owner, accountId) : [];
  const current = runs.find(run => !["READY", "FAILED", "CANCELLED"].includes(run.status));
  const count = async (states: string[]) => {
    if (!accountId) return null;
    const result = await client.from("content_export_runs").select("id", { count: "exact", head: true })
      .eq("owner_id", owner).eq("tiktok_account_id", accountId).in("status", states).gte("created_at", dayStart).lt("created_at", dayEnd);
    if (result.error) throw new Error("content_summary_unavailable");
    return result.count ?? 0;
  };
  const values = await Promise.all([count(["REVIEW_REQUIRED", "READY"]), count(["QUEUED", "THINKING", "IMAGING", "VOICING", "GENERATING", "COMPOSING"]), count(["READY"]), count(["FAILED"])]);
  const overall = !account ? "เลือกบัญชีก่อนเริ่ม" : !configured ? "กำลังเตรียมระบบสร้างคลิป" : current ? statusLabels[current.status] : "พร้อมสร้างคลิป";
  return <div className="operator-page">
    <AutoRefresh />
    <header className="operator-hero"><div className="operator-brand-mark" aria-hidden="true">V</div>
      <div className="operator-hero-copy"><p className="operator-overline">Viral Flow AI</p><h1>Home</h1><p>ให้ระบบคิดและสร้างคลิป คุณตรวจแล้วนำไปโพสต์เอง</p></div>
      <span className="operator-state"><span aria-hidden="true">●</span>{overall}</span><Link href="/auto/accounts">จัดการหลายบัญชี →</Link></header>
    <section className="operator-command-card" aria-label="เริ่มสร้างคลิป">
      <div className="operator-card-head"><h2>เริ่มงาน</h2><span className="operator-date">{today}</span></div>
      {accounts.length ? <OperatorStartForm exportOnly requestKey={randomUUID()} disabled={false} selectedAccountId={accountId}
        accounts={accounts.map(item => ({ id: item.id, name: item.display_name, status: item.account_status, authorization: item.authorization_status,
          effectiveMode: item.effective_mode, target: item.daily_post_target, hardLimit: item.daily_post_hard_limit, budget: 0 }))} />
        : <div className="operator-empty"><p>เพิ่มบัญชีเพื่อเตรียมคอนเทนต์</p><Link href="/accounts">เชื่อม TikTok →</Link></div>}
    </section>
    {!configured && <section className="operator-action-required" role="status"><div><h2>กำลังเตรียมระบบสร้างคลิป</h2><p>ยังไม่เริ่มรายการที่มีค่าใช้จ่าย</p></div></section>}
    <section className="operator-live" aria-label="งานปัจจุบัน" aria-live="polite">
      <div className="operator-live-head"><div><p className="operator-overline">กำลังทำอะไรอยู่</p><h2>{current ? statusLabels[current.status] : "รอให้คุณเริ่มสร้าง"}</h2>
        <p className="operator-live-summary">{current?.title || "เลือก AUTO, GROWTH หรือ AFFILIATE แล้วตั้งวงเงินก่อนเริ่ม"}</p></div></div>
      <dl className="operator-live-facts"><div><dt>บัญชี</dt><dd>{account?.display_name ?? "—"}</dd></div><div><dt>แนวทาง</dt><dd>{current?.mode ?? "เลือกได้ด้านบน"}</dd></div>
        <div><dt>เริ่มเมื่อ</dt><dd>{current ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(current.createdAt)) : "—"}</dd></div></dl>
      {current?.rationale && <p>{current.rationale}</p>}{current?.script && <p><strong>เสียงบรรยาย:</strong> {current.script}</p>}
      {current?.status === "REVIEW_REQUIRED" && <div className="operator-job-preview"><video controls playsInline preload="metadata" src={`/api/post/create/${current.id}/media`} aria-label="คลิปที่รอคุณตรวจ" /></div>}
      <Link className="operator-start-button" href={`/post${accountId ? `?account=${accountId}` : ""}`}>{current ? "ดูงาน / ตรวจและดาวน์โหลด" : "เปิดหน้าสร้างคลิป"}</Link>
      <p className="operator-empty-copy">งานสร้างดำเนินต่อเมื่อเปิดหน้าสร้างคลิป การโพสต์ใน TikTok ต้องกดด้วยตัวเองระหว่างรอสิทธิ์ใช้งานจริง</p>
    </section>
    <h2 className="operator-section-heading">วันนี้</h2><section className="operator-metrics" aria-label="ผลงานสร้างคลิปวันนี้">
      {["สร้างแล้ว", "กำลังทำ", "พร้อมดาวน์โหลด", "มีปัญหา"].map((label, index) => <article key={label} className="operator-metric violet"><span>{label}</span><strong>{values[index] == null ? "—" : values[index]}</strong></article>)}
    </section>
    <section className="operator-surface operator-recent" aria-label="ผลงานล่าสุด"><div className="operator-card-head"><h2>ผลงานล่าสุด</h2></div>
      {runs.length ? <ul>{runs.slice(0, 5).map(run => <li key={run.id}><Link className="operator-result-link" href={`/post?account=${run.accountId}`}>
        <span className="operator-result-icon" aria-hidden="true">▶</span><span className="operator-result-copy"><strong>{run.title || "คอนเทนต์ใหม่"}</strong><small>{run.mode}</small></span>
        <span className="operator-result-status">{statusLabels[run.status]}</span></Link></li>)}</ul> : <p className="operator-empty-copy">ยังไม่มีคลิปที่สร้าง เริ่มจาก GROWTH แล้วเว้นหัวข้อว่างให้ระบบคิดเองได้</p>}
    </section>
  </div>;
}
