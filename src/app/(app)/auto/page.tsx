import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperatorRunControls } from "@/components/operator-run-controls";
import { OperatorStartForm } from "@/components/operator-start-form";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { canStartOperatorRun, describeOperatorRun, operatorStages, operatorStepLabel } from "@/features/auto/operator";
import { getAutoOverview, getAutoRun } from "@/features/auto/services";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export default async function AutoPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const { setup } = await searchParams;
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const owner = data.user.id;
  const [accounts, overview, latestAlert] = await Promise.all([
    getOwnerAccounts(client, owner),
    getAutoOverview(client, owner),
    client.from("operations_alerts").select("rule_code,severity").eq("owner_id", owner).eq("state", "OPEN").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (latestAlert.error) throw new Error("operator_alert_read_failed");
  const run = overview.activeRun;
  const detail = run ? await getAutoRun(client, owner, run.id) : null;
  const current = detail?.states[0] ?? null;
  const selectedAccount = accounts.find((account) => account.id === current?.tiktok_account_id) ?? accounts[0];
  const status = describeOperatorRun(run, current ?? undefined);
  const provider = falAutoModeAvailability({ keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState });
  const day = new Date().toISOString().slice(0, 10);
  const accountId = selectedAccount?.id;
  const metrics = accountId ? await Promise.all([
    client.from("master_videos").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("tiktok_account_id", accountId).in("status", ["READY", "APPROVED", "REJECTED"]).gte("created_at", day),
    client.from("master_videos").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("tiktok_account_id", accountId).eq("quality_status", "PASS").gte("created_at", day),
    client.from("publish_eligibility_checks").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("tiktok_account_id", accountId).in("final_status", ["HOLD", "REGENERATE", "REJECT", "ACCOUNT_BLOCKED"]).gte("created_at", day),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("tiktok_account_id", accountId).in("status", ["QUEUED", "WAITING_FOR_SLOT"]).gte("created_at", day),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("tiktok_account_id", accountId).eq("status", "PUBLISHED").gte("created_at", day),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("tiktok_account_id", accountId).eq("status", "FAILED").gte("created_at", day),
  ]) : [];
  for (const metric of metrics) if (metric.error) throw new Error("operator_metric_read_failed");
  const stat = (index: number) => metrics[index]?.count ?? 0;
  const doneSteps = new Set((detail?.steps ?? []).filter((step) => step.state === "COMPLETED").map((step) => step.step));
  const remaining = run ? Math.max(0, Number(run.budget_usd) - Number(run.spent_usd)) : 0;

  return <div className="operator-page">
    <header className="operator-hero">
      <div><p className="operator-overline">VIRALFLOW · OPERATOR CENTER</p><h1>เริ่มงานวันนี้ในที่เดียว</h1><p>เลือกบัญชีและเป้าหมาย แล้วให้ระบบตรวจความพร้อมและบันทึกแผนอย่างปลอดภัย</p></div>
      <span className={`operator-state ${status.tone}`}>{status.title}</span>
    </header>

    <section className="operator-primary-grid" aria-label="ตั้งค่าและสถานะ Auto">
      <article className="panel operator-setup">
        <div className="panel-heading"><div><p className="eyebrow">01 / SETUP</p><h2>ตั้งค่าแผนประจำวัน</h2></div></div>
        {setup && <p className="operator-notice" role="alert">{setup === "affiliate" ? "บัญชีนี้ยังไม่พร้อมใช้ Affiliate กรุณาตรวจสิทธิ์ร้านค้า" : setup === "budget" ? "เป้าหมายหรืองบเกินขีดจำกัดของบัญชี กรุณาปรับค่าแล้วลองใหม่" : "ตรวจข้อมูลบัญชีและลองอีกครั้ง"}</p>}
        {accounts.length ? <OperatorStartForm requestKey={randomUUID()} disabled={!canStartOperatorRun(run)} accounts={accounts.map((account) => ({ id: account.id, name: account.display_name, status: account.account_status, authorization: account.authorization_status, effectiveMode: account.effective_mode, target: account.daily_post_target, hardLimit: account.daily_post_hard_limit, budget: Number((account as typeof account & { daily_video_budget_usd?: number }).daily_video_budget_usd ?? 0) }))}/>
          : <div className="operator-empty"><strong>ยังไม่มีบัญชี TikTok</strong><p>เพิ่มหรือเชื่อมต่อบัญชีเพื่อสร้างแผนแรก</p><Link className="primary-action" href="/accounts">เพิ่มบัญชี →</Link></div>}
      </article>
      <article className="panel operator-live" aria-live="polite">
        <p className="eyebrow">02 / LIVE STATUS</p><h2>{status.title}</h2><p>{status.detail}</p>
        {run && <><div className="operator-live-meta"><span>บัญชี <strong>{selectedAccount?.display_name ?? "ไม่ทราบบัญชี"}</strong></span><span>โหมด <strong>{current?.effective_mode ?? "—"}</strong></span><span>ขั้นตอนล่าสุด <strong>{operatorStepLabel(run.current_step)}</strong></span></div><OperatorRunControls runId={run.id} state={run.state}/></>}
        {status.setupRequired && <div className="operator-notice"><strong>SETUP REQUIRED</strong><p>{status.detail}</p><Link href="/settings/integrations">ตรวจการเชื่อมต่อ →</Link></div>}
        {current?.state === "WAITING_FOR_APPROVAL" && <div className="operator-notice"><strong>ต้องตรวจและยินยอมก่อนส่ง</strong><p>เปิดรายการเผยแพร่เพื่อตรวจวิดีโอและบันทึกความยินยอมอย่างชัดเจน ระบบจะตรวจสถานะเดิมต่อโดยไม่ส่งซ้ำ</p><Link href="/publishing">ตรวจคิวเผยแพร่ →</Link></div>}
        {!provider.providerAvailable && <div className="operator-notice"><strong>ผู้สร้างวิดีโอยังไม่พร้อม</strong><p>ต้องมีการอนุมัติใช้งานจริงและกุญแจผู้ให้บริการบนเซิร์ฟเวอร์ก่อนสร้างวิดีโอแบบอัตโนมัติ</p></div>}
      </article>
    </section>

    <section className="operator-readiness" aria-label="ความพร้อมก่อนทำงาน">
      <div><span className={provider.providerAvailable ? "readiness-dot ready" : "readiness-dot"}/><strong>Video provider</strong><small>{provider.providerAvailable ? "พร้อมตามการตั้งค่า" : "ต้องตั้งค่า"}</small></div>
      <div><span className={selectedAccount?.authorization_status === "authorized" && !selectedAccount.is_mock ? "readiness-dot ready" : "readiness-dot"}/><strong>TikTok</strong><small>{selectedAccount?.is_mock ? "บัญชีจำลอง · ยังไม่เชื่อมต่อจริง" : selectedAccount?.authorization_status === "authorized" ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}</small></div>
      <div><span className={selectedAccount?.account_status === "active" ? "readiness-dot ready" : "readiness-dot"}/><strong>บัญชี</strong><small>{selectedAccount?.account_status === "active" ? "ใช้งานได้" : "ต้องตรวจสุขภาพ"}</small></div>
      <div><span className="readiness-dot"/><strong>เผยแพร่จริง</strong><small>รอความยินยอมและสิทธิ์ production</small></div>
    </section>

    <section className="operator-metrics" aria-label="ผลลัพธ์ของบัญชีวันนี้">
      {[["วิดีโอวันนี้", current?.published_today ?? 0], ["สร้างแล้ว", stat(0)], ["ผ่านคุณภาพ", stat(1)], ["ถูกกั้นโดยข้อกำหนด", stat(2)], ["รอคิว", stat(3)], ["เผยแพร่", stat(4)], ["ล้มเหลว", stat(5)], ["ใช้ไป", `$${Number(run?.spent_usd ?? 0).toFixed(2)}`], ["งบคงเหลือ", `$${remaining.toFixed(2)}`]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>

    <section className="operator-lower-grid">
      <article className="panel"><div className="panel-heading"><div><p className="eyebrow">REAL EVIDENCE</p><h2>ขั้นตอนการทำงาน</h2></div>{run && <Link href={`/auto/runs/${run.id}`}>รายละเอียด →</Link>}</div>
        <ol className="operator-timeline">{operatorStages.map(([code, label]) => <li key={code} className={doneSteps.has(code) ? "done" : "pending"}><span aria-hidden="true">{doneSteps.has(code) ? "✓" : "·"}</span><div><strong>{label}</strong><small>{doneSteps.has(code) ? "บันทึกแล้ว" : "ยังไม่มีหลักฐานว่าสำเร็จ"}</small></div></li>)}</ol>
      </article>
      <article className="panel operator-side"><div><p className="eyebrow">ATTENTION</p><h2>สิ่งที่ต้องดูแล</h2>{latestAlert.data ? <p><strong>{latestAlert.data.severity}</strong> · {latestAlert.data.rule_code}</p> : <p>ไม่มีการแจ้งเตือนที่เปิดอยู่</p>}{status.blockers.length > 0 && <p>แผนติดเงื่อนไข {status.blockers.length} รายการ กรุณาตรวจสถานะและการเชื่อมต่อ</p>}<Link href="/operations">เปิดการดำเนินงาน →</Link></div>
        <div><p className="eyebrow">ADVANCED</p><h2>ตรวจรายละเอียด</h2><p>เครื่องมือวิเคราะห์ สร้างวิดีโอ ข้อกำหนด และการเผยแพร่ยังอยู่ในเมนูขั้นสูง</p><Link href="/dashboard">เปิดภาพรวมเชิงลึก →</Link></div>
      </article>
    </section>
  </div>;
}
