import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperatorRunControls } from "@/components/operator-run-controls";
import { OperatorStartForm } from "@/components/operator-start-form";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { assignmentDate } from "@/features/assignments/planner";
import { canStartOperatorRun, describeOperatorRun, operatorStepLabel } from "@/features/auto/operator";
import { getAutoOverview, getAutoRun } from "@/features/auto/services";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import { tiktokRequirementLabel } from "@/lib/tiktok-config";
import { createClient } from "@/lib/supabase/server";
import "./operator.css";

export const maxDuration = 300;

const pipeline = [
  ["FIND_OPPORTUNITY", "Idea"],
  ["CREATE_CREATIVE", "Creative"],
  ["GENERATE_VIDEO", "Video"],
  ["QUALITY_CHECK", "Quality"],
  ["COMPLIANCE_CHECK", "Safety"],
  ["QUEUE_PUBLISH", "Queue"],
  ["PUBLISH", "Publish"],
  ["COLLECT_ANALYTICS", "Analytics"],
  ["LEARN", "Learning"],
] as const;

type QueueResult = { id: string; status: string; created_at: string; video_id: string | null };
type Reservation = { state: string; reserved_usd: number | string; actual_usd: number | string | null };

const queueState: Record<string, { label: string; tone: string }> = {
  PUBLISHED: { label: "เผยแพร่แล้ว", tone: "good" },
  DRAFT_DELIVERED: { label: "ส่ง Draft แล้ว", tone: "good" },
  QUEUED: { label: "รอคิว", tone: "pending" },
  WAITING_FOR_SLOT: { label: "รอรอบโพสต์", tone: "pending" },
  FAILED: { label: "ไม่สำเร็จ", tone: "bad" },
  REJECTED: { label: "ไม่ผ่าน", tone: "bad" },
};

function money(value: number) {
  return "$" + value.toFixed(2);
}

export default async function AutoPage({ searchParams }: {
  searchParams: Promise<{ setup?: string; account?: string }>;
}) {
  const { setup, account: accountParam } = await searchParams;
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const owner = data.user.id;
  const today = assignmentDate(new Date().toISOString());
  const dayStart = new Date(`${today}T00:00:00+07:00`).toISOString();
  const dayEnd = new Date(Date.parse(dayStart) + 86_400_000).toISOString();
  const [accounts, overview, latestAlert] = await Promise.all([
    getOwnerAccounts(client, owner),
    getAutoOverview(client, owner),
    client.from("operations_alerts").select("rule_code,severity").eq("owner_id", owner)
      .eq("state", "OPEN").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (latestAlert.error) throw new Error("operator_alert_read_failed");

  const run = overview.activeRun ?? overview.runs.find((item) => item.run_date === today) ?? null;
  const detail = run ? await getAutoRun(client, owner, run.id) : null;
  const selectedAccount = accounts.find((item) => item.id === (overview.activeRun
    ? detail?.states[0]?.tiktok_account_id : accountParam))
    ?? accounts.find((item) => item.id === accountParam)
    ?? accounts[0];
  const accountId = selectedAccount?.id;
  const current = detail?.states.find((item) => item.tiktok_account_id === accountId) ?? null;
  const status = describeOperatorRun(run, current ?? undefined);
  const provider = falAutoModeAvailability({
    keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState,
  });

  const metrics = accountId ? await Promise.all([
    client.from("master_videos").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("master_videos").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("quality_status", "PASS").gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publish_eligibility_checks").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("final_status", ["HOLD", "REGENERATE", "REJECT", "ACCOUNT_BLOCKED"])
      .gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("status", ["QUEUED", "WAITING_FOR_SLOT"])
      .gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("status", "PUBLISHED")
      .gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("status", "FAILED")
      .gte("created_at", dayStart).lt("created_at", dayEnd),
  ]) : [];
  for (const metric of metrics) if (metric.error) throw new Error("operator_metric_read_failed");
  const stat = (index: number) => accountId ? (metrics[index]?.count ?? 0) : null;

  const [healthResult, budgetResult, recentResult, failedJobsResult] = accountId ? await Promise.all([
    client.from("account_publish_health").select("health_status,account_status,blockers_json")
      .eq("owner_id", owner).eq("tiktok_account_id", accountId).maybeSingle(),
    client.from("generation_budget_reservations").select("state,reserved_usd,actual_usd")
      .eq("owner_id", owner).eq("tiktok_account_id", accountId).eq("budget_day", today)
      .in("state", ["RESERVED", "SETTLED"]).limit(1000),
    client.from("publishing_queue").select("id,status,created_at,video_id").eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).order("created_at", { ascending: false }).limit(3),
    client.from("generation_jobs").select("creative_project_id").eq("owner_id", owner)
      .eq("status", "FAILED").gte("created_at", dayStart).lt("created_at", dayEnd).limit(1000),
  ]) : [null, null, null, null];
  for (const result of [healthResult, budgetResult, recentResult, failedJobsResult]) {
    if (result?.error) throw new Error("operator_overview_read_failed");
  }
  const failedJobs = failedJobsResult?.data ?? [];
  if (failedJobs.length === 1000) throw new Error("operator_failed_jobs_limit");
  const failedProjectIds = [...new Set(failedJobs.map((row) => row.creative_project_id).filter(Boolean))];
  const failedProjects = failedProjectIds.length ? await client.from("creative_projects")
    .select("id,tiktok_account_id").eq("owner_id", owner).in("id", failedProjectIds) : null;
  if (failedProjects?.error) throw new Error("operator_failed_projects_read_failed");
  const failedProjectAccount = new Map((failedProjects?.data ?? []).map((row) => [row.id, row.tiktok_account_id]));
  const failedGenerationCount = failedJobs.filter((row) => failedProjectAccount.get(row.creative_project_id) === accountId).length;
  const reservations = (budgetResult?.data ?? []) as Reservation[];
  const spent = reservations.filter((item) => item.state === "SETTLED")
    .reduce((sum, item) => sum + Number(item.actual_usd ?? 0), 0);
  const reserved = reservations.filter((item) => item.state === "RESERVED")
    .reduce((sum, item) => sum + Number(item.reserved_usd), 0);
  const accountBudget = Number((selectedAccount as typeof selectedAccount & { daily_video_budget_usd?: number | string } | undefined)?.daily_video_budget_usd ?? 0);
  const dailyBudget = accountId ? Number(current?.max_daily_cost_usd ?? accountBudget) : null;
  const remaining = dailyBudget === null ? null : Math.max(0, dailyBudget - spent - reserved);
  const recentRows = (recentResult?.data ?? []) as QueueResult[];
  const videoIds = recentRows.map((row) => row.video_id).filter((id): id is string => Boolean(id));
  const videos = videoIds.length ? await client.from("master_videos").select("id,product_id")
    .eq("owner_id", owner).in("id", videoIds) : null;
  if (videos?.error) throw new Error("operator_recent_video_read_failed");
  const productIds = (videos?.data ?? []).map((item) => item.product_id).filter((id): id is string => Boolean(id));
  const products = productIds.length ? await client.from("products").select("id,title")
    .eq("owner_id", owner).in("id", productIds) : null;
  if (products?.error) throw new Error("operator_recent_product_read_failed");
  const productById = new Map((products?.data ?? []).map((item) => [item.id, item.title]));
  const videoById = new Map((videos?.data ?? []).map((item) => [item.id, item.product_id]));

  const completed = new Set((detail?.steps ?? [])
    .filter((step) => step.state === "COMPLETED"
      && (step as typeof step & { tiktok_account_id?: string }).tiktok_account_id === accountId)
    .map((step) => step.step));
  const completeCount = pipeline.filter(([code]) => completed.has(code)).length;
  const activeStage = current?.current_step;
  const stageBlocked = current && ["WAITING_FOR_DATA", "WAITING_FOR_APPROVAL", "WAITING_FOR_PROVIDER",
    "WAITING_FOR_SLOT", "WAITING_FOR_RECONCILIATION", "RETRY_PENDING", "BLOCKED", "FAILED"].includes(current.state);
  const publishedToday = current?.published_today ?? 0;
  const target = current?.desired_daily_posts ?? 0;
  const progress = target > 0 ? Math.min(100, (publishedToday / target) * 100) : 0;
  const providerReady = provider.providerAvailable;
  const tiktokReady = Boolean(selectedAccount && !selectedAccount.is_mock
    && selectedAccount.authorization_status === "authorized"
    && selectedAccount.connection_status === "READY_FOR_DIRECT_POST"
    && selectedAccount.granted_scopes?.includes("video.publish")
    && selectedAccount.direct_post_status === "READY"
    && serverEnv.tiktokPublishingProvider === "official"
    && serverEnv.tiktokPublishingRealMode
    && serverEnv.tiktokVideoPublishApproved
    && serverEnv.tiktokDirectPostAuditStatus === "AUDITED");
  const health = healthResult?.data?.health_status;
  const runProvider = run && typeof run.metrics_json?.videoProvider === "string" ? run.metrics_json.videoProvider : null;
  const accountHealthy = Boolean(health && ["READY", "GOOD", "HEALTHY"].includes(health));
  const setupItems = [
    ...tiktokOfficialSetupMissing.map((key) => ({ text: `${tiktokRequirementLabel(key)} missing`, href: "/accounts/connect/tiktok" })),
    !selectedAccount ? { text: "เพิ่มบัญชี TikTok เพื่อเริ่มใช้งาน", href: "/accounts" } : null,
    selectedAccount && !providerReady && !selectedAccount.is_mock
      ? { text: "fal ยังไม่พร้อมใช้งานจริง", href: "/settings/integrations" } : null,
    selectedAccount && !tiktokReady && !selectedAccount.is_mock
      ? { text: "ตรวจการเชื่อมต่อและสิทธิ์เผยแพร่ TikTok", href: "/accounts" } : null,
    selectedAccount && !accountHealthy
      ? { text: "ตรวจสุขภาพบัญชีและข้อจำกัดการเผยแพร่", href: `/accounts/${selectedAccount.id}` } : null,
    current?.state === "WAITING_FOR_APPROVAL"
      ? { text: "ตรวจวิดีโอและบันทึกความยินยอมก่อนเผยแพร่", href: "/publishing" } : null,
  ].filter((item): item is { text: string; href: string } => Boolean(item));

  return <div className="operator-page">
    <header className="operator-hero">
      <div className="operator-brand-mark" aria-hidden="true">V</div>
      <div className="operator-hero-copy">
        <p className="operator-overline">VIRALFLOW AI / CONTROL CENTER</p>
        <h1>ศูนย์ควบคุม Auto</h1>
        <p>จัดการแผนสร้างคอนเทนต์ ดูงานจริง และตรวจความพร้อมในหน้าเดียว</p>
      </div>
      <span className={`operator-state ${status.tone}`}><span aria-hidden="true">●</span>{status.title}</span>
    </header>

    <section className="operator-command-card" aria-label="ควบคุมการทำงานอัตโนมัติ">
      <div className="operator-card-head"><div><p className="operator-overline">TODAY&apos;S PLAN</p><h2>กำหนดแผนประจำวัน</h2></div>
        <span className="operator-date">{today}</span></div>
      {setup && <p className="operator-notice" role="alert">{setup === "affiliate" ? "บัญชีนี้ยังไม่พร้อมใช้ Affiliate กรุณาตรวจสิทธิ์ร้านค้า" : setup === "budget" ? "เป้าหมายหรืองบเกินขีดจำกัดของบัญชี กรุณาปรับค่าแล้วลองใหม่" : "ตรวจข้อมูลบัญชีและลองอีกครั้ง"}</p>}
      {accounts.length ? <OperatorStartForm requestKey={randomUUID()} disabled={!canStartOperatorRun(overview.activeRun)}
        selectedAccountId={selectedAccount?.id}
        accounts={accounts.map((account) => ({
          id: account.id, name: account.display_name, status: account.account_status,
          authorization: account.authorization_status, effectiveMode: account.effective_mode,
          target: account.daily_post_target, hardLimit: account.daily_post_hard_limit,
          budget: Number((account as typeof account & { daily_video_budget_usd?: number | string }).daily_video_budget_usd ?? 0),
        }))}/> : <div className="operator-empty"><strong>ยังไม่มีบัญชี TikTok</strong>
        <p>เพิ่มหรือเชื่อมต่อบัญชีเพื่อเริ่มแผนแรก</p><Link href="/accounts">เพิ่มบัญชี →</Link></div>}

      <div className="operator-live" aria-live="polite">
        <div className="operator-live-head"><div><p className="operator-overline">CURRENT STATUS</p>
          <h2>{status.title}</h2><p>{status.detail}</p></div>
          <span className={`operator-health-chip ${accountHealthy ? "good" : "attention"}`}>
            <span aria-hidden="true">●</span>{accountHealthy ? "บัญชีพร้อม" : health ? `สุขภาพบัญชี: ${health}` : "ยังไม่มีข้อมูลสุขภาพ"}
          </span></div>
        {run && <div className="operator-live-meta"><span>บัญชี <strong>{selectedAccount?.display_name ?? "—"}</strong></span>
          <span>โหมด <strong>{current?.effective_mode ?? "—"}</strong></span>
          <span>ขั้นตอน <strong>{current ? operatorStepLabel(current.current_step) : "—"}</strong></span>
          <OperatorRunControls runId={run.id} state={run.state}/></div>}
        <div className="operator-daily-progress">
          <div><span>ความคืบหน้าการเผยแพร่วันนี้</span><strong>{current ? `${publishedToday} / ${target} คลิป` : "ยังไม่มีแผนวันนี้"}</strong></div>
          <div className="operator-progress-track" role="progressbar" aria-valuenow={Math.min(publishedToday, Math.max(1, target))}
            aria-valuemin={0} aria-valuemax={Math.max(1, target)}
            aria-label="จำนวนคลิปที่เผยแพร่ตามเป้าหมายวันนี้"><span style={{ width: `${progress}%` }}/></div>
        </div>
        <div className="operator-pipeline-head"><div><p className="operator-overline">PIPELINE PROGRESS</p>
          <h3>เส้นทางการทำงาน</h3></div><span>{run ? `${completeCount} / ${pipeline.length} ขั้นตอนมีหลักฐานเสร็จ` : "ยังไม่เริ่มแผน"}</span></div>
        <ol className="operator-pipeline">
          {pipeline.map(([code, label]) => {
            const state = completed.has(code) ? "completed"
              : activeStage === code && stageBlocked ? "blocked"
              : activeStage === code && current?.state === "RUNNING" ? "active" : "pending";
            return <li className={state} key={code} aria-label={`${label}: ${state}`}>
              <span className="operator-stage-symbol" aria-hidden="true">{state === "completed" ? "✓" : state === "active" ? "●" : state === "blocked" ? "!" : "○"}</span>
              <span>{label}</span>
            </li>;
          })}
        </ol>
      </div>
    </section>

    <section className="operator-overview-grid" aria-label="ความพร้อมและงบประมาณ">
      <article className="operator-surface"><div className="operator-card-head"><h2>System readiness</h2>
        <Link href="/settings/integrations">ตั้งค่าระบบ ↗</Link></div>
        <div className="operator-readiness-row"><span>Video provider</span><strong className={providerReady ? "good" : "attention"}>{providerReady ? "พร้อมตามการตั้งค่า" : "ต้องตั้งค่า"}</strong></div>
        <div className="operator-readiness-row"><span>TikTok publishing</span><strong className={tiktokReady ? "good" : "attention"}>{tiktokReady ? "พร้อมตามการตั้งค่า" : selectedAccount?.is_mock ? "บัญชีจำลอง" : "ยังไม่พร้อม"}</strong></div>
        <div className="operator-readiness-row"><span>Worker schedule</span><strong className={serverEnv.recoveryEnabled ? "good" : "attention"}>{serverEnv.recoveryEnabled ? "เปิดตามการตั้งค่า" : "ปิดอยู่"}</strong></div>
        <div className="operator-readiness-row"><span>Account health</span><strong className={accountHealthy ? "good" : "attention"}>{health ?? "ไม่มีข้อมูล"}</strong></div>
      </article>
      <article className="operator-surface operator-budget"><div className="operator-card-head"><h2>Budget today</h2>
        <span>{remaining === null ? "—" : `${money(remaining)} คงเหลือ`}</span></div>
        <p className="operator-budget-value">{dailyBudget === null ? "—" : money(spent)}
          <span> / {dailyBudget === null ? "—" : money(dailyBudget)}</span></p>
        <div className="operator-progress-track"><span style={{ width: `${dailyBudget && dailyBudget > 0 ? Math.min(100, ((spent + reserved) / dailyBudget) * 100) : 0}%` }}/></div>
        <p>{reserved > 0 ? `กันงบสำหรับงานที่ยังไม่สิ้นสุด ${money(reserved)} · ` : ""}
          Provider: {runProvider ?? "ยังไม่มีแผน"}</p>
      </article>
    </section>

    <section className="operator-metrics" aria-label="ผลลัพธ์ของบัญชีวันนี้">
      {[
        ["Generated", stat(0), "violet"], ["Passed", stat(1), "teal"],
        ["Queued", stat(3), "blue"], ["Published", stat(4), "teal"],
        ["Blocked", stat(2), "amber"], ["Failed", accountId ? (stat(5) ?? 0) + failedGenerationCount : null, "rose"],
      ].map(([label, value, tone]) => <article key={label} className={`operator-metric ${tone}`}>
        <span>{label}</span><strong>{value ?? "—"}</strong></article>)}
    </section>

    <section className="operator-bottom-grid" aria-label="งานและผลลัพธ์ล่าสุด">
      <article className="operator-surface operator-current-job"><div className="operator-card-head"><h2>กำลังทำอยู่</h2>
        {run && <Link href={`/auto/runs/${run.id}`}>ดูรายละเอียด ↗</Link>}</div>
        <span className={`operator-mini-state ${status.tone}`}>{status.title}</span>
        <h3>{current ? operatorStepLabel(current.current_step) : "ยังไม่มีงานที่กำลังทำ"}</h3>
        <p>{current ? `บัญชี ${selectedAccount?.display_name ?? "—"} · โหมด ${current.effective_mode}` : "เมื่อเริ่ม Auto งานปัจจุบันจะแสดงที่นี่"}</p>
        {current && <p className="operator-job-meta">Checkpoint {current.checkpoint_version} · {current.state}</p>}
      </article>
      <article className="operator-surface operator-recent"><div className="operator-card-head"><h2>ผลลัพธ์ล่าสุด</h2>
        <Link href="/publishing">ดูทั้งหมด ↗</Link></div>
        {recentRows.length ? <ul>{recentRows.map((row) => {
          const title = productById.get(videoById.get(row.video_id ?? "") ?? "") ?? `วิดีโอ ${(row.video_id ?? row.id).slice(0, 8)}`;
          const state = queueState[row.status] ?? { label: row.status, tone: "pending" };
          return <li key={row.id}><Link href={`/publishing/${row.id}`}>
            <span className="operator-result-icon" aria-hidden="true">▶</span>
            <span className="operator-result-copy"><strong>{title}</strong>
              <small>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(row.created_at))}</small></span>
            <span className={`operator-result-status ${state.tone}`}>{state.label}</span>
          </Link></li>;
        })}</ul> : <p className="operator-empty-copy">ยังไม่มีผลลัพธ์จากบัญชีนี้</p>}
      </article>
    </section>

    {(setupItems.length > 0 || latestAlert.data) && <section className="operator-setup-required" aria-label="สิ่งที่ต้องตั้งค่า">
      <div><p className="operator-overline">SETUP REQUIRED</p><h2>สิ่งที่ต้องดูแลก่อนทำงานต่อ</h2>
        {latestAlert.data && <p>การแจ้งเตือน: {latestAlert.data.severity} · {latestAlert.data.rule_code}</p>}
        {setupItems.map((item) => <p key={item.text}>• {item.text}</p>)}</div>
      <Link href={setupItems[0]?.href ?? "/operations"}>ตรวจการตั้งค่า ↗</Link>
    </section>}
  </div>;
}
