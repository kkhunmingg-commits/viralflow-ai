import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OperatorStartForm } from "@/components/operator-start-form";
import { accountPhase } from "@/features/accounts/account-phase";
import { contentExportConfig } from "@/features/content-export/config";
import { statusLabels } from "@/features/content-export/contracts";
import { listContentRuns } from "@/features/content-export/service";
import { SYSTEM_STATUS } from "@/features/system/status";
import { AutoRefresh } from "./auto-refresh";

type Account = { id: string; display_name: string; account_status: string; authorization_status: string; effective_mode: string; daily_post_target: number; daily_post_hard_limit: number; follower_count: number };
export async function ContentHome({ client, owner, accounts, accountId, today, dayStart, dayEnd }: {
  client: SupabaseClient; owner: string; accounts: Account[]; accountId?: string; today: string; dayStart: string; dayEnd: string;
}) {
  const config = contentExportConfig();
  const configured = config.enabled && Boolean(config.key) && config.allowedOwners.includes(owner);
  const account = accounts.find(item => item.id === accountId);
  const phase = account ? accountPhase(account) : null;
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
  const readyToDownload = values[2] ?? 0;
  const overall = !account ? "เชื่อมบัญชีก่อนเริ่ม" : !configured ? "กำลังเตรียมระบบสร้างคลิป" : current ? statusLabels[current.status] : "พร้อมสร้างคลิป";
  const postHref = `/post${accountId ? `?account=${accountId}` : ""}`;
  const steps = [
    { title: "เชื่อมบัญชี TikTok", detail: accounts.length ? `เชื่อมแล้ว ${accounts.length.toLocaleString("th-TH")} บัญชี` : "เริ่มจากตรงนี้", done: accounts.length > 0, href: "/accounts" },
    { title: "ให้ระบบสร้างคลิป", detail: current ? statusLabels[current.status] : "บท ภาพ และวิดีโอด้วย Google Flow", done: Boolean(current) || readyToDownload > 0, href: postHref },
    { title: "ดาวน์โหลดแล้วโพสต์เอง", detail: readyToDownload ? `พร้อมดาวน์โหลด ${readyToDownload.toLocaleString("th-TH")} คลิป` : "เปิดแอป TikTok แล้วกดโพสต์", done: false, href: postHref },
  ];
  const nextStep = steps.findIndex(step => !step.done);
  return <div className="operator-page">
    <AutoRefresh />
    <header className="operator-hero"><div className="operator-brand-mark" aria-hidden="true">V</div>
      <div className="operator-hero-copy"><p className="operator-overline">Viral Flow AI</p><h1>หน้าหลัก</h1><p>ระบบทำคลิปให้ทุกวัน คุณแค่ตรวจ ดาวน์โหลด แล้วโพสต์ใน TikTok</p></div>
      <span className="operator-state"><span aria-hidden="true">●</span>{overall}</span></header>

    <ol className="home-steps" aria-label="ขั้นตอนการใช้งาน">
      {steps.map((step, index) => <li key={step.title} className={step.done ? "done" : index === nextStep ? "next" : undefined}>
        <Link href={step.href}><span className="home-step-number" aria-hidden="true">{step.done ? "✓" : index + 1}</span>
          <span><strong>{step.title}</strong><small>{step.detail}</small></span></Link></li>)}
    </ol>

    <section className="operator-command-card" aria-label="เริ่มสร้างคลิป">
      <div className="operator-card-head"><h2>สร้างคลิปวันนี้</h2><span className="operator-date">{today}</span></div>
      {accounts.length ? <OperatorStartForm exportOnly requestKey={randomUUID()} disabled={false} selectedAccountId={accountId}
        accounts={accounts.map(item => {
          const view = accountPhase(item);
          return { id: item.id, name: item.display_name, status: item.account_status, authorization: item.authorization_status,
            effectiveMode: item.effective_mode, target: item.daily_post_target, hardLimit: item.daily_post_hard_limit, budget: 0,
            phase: { label: view.label, plan: view.plan, clipsPerDay: view.clipsPerDay } };
        })} />
        : <div className="operator-empty"><strong>ยังไม่มีบัญชี TikTok</strong><p>เชื่อมบัญชีแรกเพื่อให้ระบบเริ่มทำคลิป</p><Link href="/accounts">เชื่อม TikTok →</Link></div>}
    </section>
    {!configured && <section className="operator-action-required" role="status"><div><h2>กำลังเตรียมระบบสร้างคลิป</h2><p>ยังไม่เริ่มรายการที่มีค่าใช้จ่าย</p></div></section>}

    <section className="home-two-col">
      <article className="operator-live" aria-label="งานปัจจุบัน" aria-live="polite">
        <div className="operator-live-head"><div><p className="operator-overline">กำลังทำอะไรอยู่</p><h2>{current ? statusLabels[current.status] : "ยังไม่มีงานที่กำลังทำ"}</h2>
          <p className="operator-live-summary">{current?.title || "กด “สร้างคลิป” ด้านบน ระบบจะคิดหัวข้อให้เองตามช่วงของบัญชี"}</p></div></div>
        {current?.rationale && <p>{current.rationale}</p>}{current?.script && <p><strong>เสียงบรรยาย:</strong> {current.script}</p>}
        {current?.status === "REVIEW_REQUIRED" && <div className="operator-job-preview"><video controls playsInline preload="metadata" src={`/api/post/create/${current.id}/media`} aria-label="คลิปที่รอคุณตรวจ" /></div>}
        <Link className="operator-start-button" href={postHref}>{current ? "ดูงาน / ตรวจและดาวน์โหลด" : readyToDownload ? "ไปดาวน์โหลดคลิป" : "เปิดหน้าสร้างคลิป"}</Link>
        <p className="operator-empty-copy">งานสร้างดำเนินต่อเมื่อเปิดหน้าสร้างคลิป การโพสต์ใน TikTok ต้องกดด้วยตัวเอง</p>
      </article>

      <article className="operator-surface home-phase" aria-label="ช่วงของบัญชี">
        <div className="operator-card-head"><h2>ช่วงของบัญชี</h2>{phase && <span className={`home-phase-chip ${phase.phase.toLowerCase()}`}>{phase.label}</span>}</div>
        {account && phase ? <>
          <p className="home-phase-account">{account.display_name}</p>
          <div className="operator-daily-progress"><div><span>ผู้ติดตาม</span>
            <strong>{phase.followers.toLocaleString("th-TH")} / 1,000</strong></div>
            <div className="operator-progress-track" role="progressbar" aria-valuenow={phase.progress} aria-valuemin={0} aria-valuemax={100} aria-label="ความคืบหน้าสู่ช่วงขายสินค้า">
              <span style={{ width: `${phase.progress}%` }} /></div></div>
          <dl className="home-phase-facts"><div><dt>จำนวนคลิป</dt><dd>{phase.clipsPerDay}</dd></div><div><dt>ระบบทำอะไร</dt><dd>{phase.plan}</dd></div></dl>
        </> : <p className="operator-empty-copy">เชื่อมบัญชี TikTok เพื่อดูว่าอยู่ช่วงอุ่นเครื่องหรือช่วงขายสินค้า</p>}
        {accounts.length > 1 && <Link href="/auto/accounts">ดูทุกบัญชี →</Link>}
      </article>
    </section>

    <h2 className="operator-section-heading">วันนี้</h2><section className="operator-metrics home-metrics" aria-label="ผลงานสร้างคลิปวันนี้">
      {["สร้างแล้ว", "กำลังทำ", "พร้อมดาวน์โหลด", "มีปัญหา"].map((label, index) => <article key={label} className={`operator-metric ${index === 3 ? "rose" : index === 2 ? "teal" : "violet"}`}><span>{label}</span><strong>{values[index] == null ? "—" : values[index]}</strong></article>)}
    </section>

    <section className="operator-surface operator-recent" aria-label="ผลงานล่าสุด"><div className="operator-card-head"><h2>ผลงานล่าสุด</h2>{runs.length > 0 && <Link href={postHref}>ดูทั้งหมด →</Link>}</div>
      {runs.length ? <ul>{runs.slice(0, 5).map(run => <li key={run.id}><Link className="operator-result-link" href={`/post?account=${run.accountId}`}>
        <span className="operator-result-icon" aria-hidden="true">▶</span><span className="operator-result-copy"><strong>{run.title || "คอนเทนต์ใหม่"}</strong><small>{run.mode}</small></span>
        <span className="operator-result-status">{statusLabels[run.status]}</span></Link></li>)}</ul> : <p className="operator-empty-copy">ยังไม่มีคลิปที่สร้าง กด “สร้างคลิป” แล้วปล่อยหัวข้อว่างให้ระบบคิดเองได้</p>}
    </section>

    <section aria-label="สถานะระบบ"><h2 className="operator-section-heading">สถานะระบบตอนนี้</h2>
      <div className="home-status-grid">{SYSTEM_STATUS.map(item => <article key={item.key} className={`home-status home-status-${item.tone}`}>
        <span className="home-status-title">{item.title}</span><strong><span aria-hidden="true">●</span> {item.state}</strong><p>{item.detail}</p>
        {item.href && <Link href={item.href}>{item.hrefLabel} →</Link>}</article>)}</div>
    </section>
  </div>;
}
