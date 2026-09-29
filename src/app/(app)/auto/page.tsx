import { randomUUID } from "node:crypto";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OperatorRunControls } from "@/components/operator-run-controls";
import { OperatorStartForm } from "@/components/operator-start-form";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { assignmentDate } from "@/features/assignments/planner";
import { mapControlCenterActivity, mapControlCenterStages, mapCustomerStages, type ControlCenterStepEvidence } from "@/features/auto/control-center-view";
import { canStartOperatorRun, describeOperatorRun } from "@/features/auto/operator";
import { getAutoOverview, getAutoRun } from "@/features/auto/services";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { VIDEO_BUCKET } from "@/features/video/types";
import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "./auto-refresh";
import "./operator.css";

export const maxDuration = 300;

type QueueResult = { id: string; status: string; created_at: string; video_id: string | null; video_kind: string };
type Reservation = { state: string; reserved_usd: number | string; actual_usd: number | string | null };
type VideoRow = { id: string; product_id: string | null };
type AnalyticsRow = { video_id: string; video_kind: string; views: number | null; orders: number | null; source_snapshot_at: string; source: string };

const queueState: Record<string, { label: string; tone: string }> = {
  PUBLISHED: { label: "เผยแพร่แล้ว", tone: "good" },
  DRAFT_DELIVERED: { label: "ส่ง Draft แล้ว", tone: "good" },
  QUEUED: { label: "รอคิว", tone: "pending" },
  WAITING_FOR_SLOT: { label: "รอรอบโพสต์", tone: "pending" },
  FAILED: { label: "ไม่สำเร็จ", tone: "bad" },
  REJECTED: { label: "ไม่ผ่าน", tone: "bad" },
};

const blockerCopy: Record<string, { text: string; href: string | null }> = {
  PROVIDER_UNAVAILABLE: { text: "การสร้างวิดีโอยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง", href: null },
  ASSIGNMENT_REQUIRED: { text: "ยังไม่มีสินค้าที่เหมาะกับบัญชีนี้", href: "/accounts" },
  ACCOUNT_HEALTH: { text: "บัญชียังไม่พร้อมเผยแพร่", href: "/accounts" },
  BUDGET_EXCEEDED: { text: "งบวิดีโอของบัญชีไม่เพียงพอ", href: null },
  CONSENT: { text: "มีวิดีโอรอให้คุณยืนยันก่อนเผยแพร่", href: "/publishing" },
  COMMERCE: { text: "สิทธิ์ Affiliate ยังไม่พร้อม", href: "/accounts" },
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function stepEvidence(value: unknown): ControlCenterStepEvidence | null {
  const row = record(value);
  if (!row || !string(row.id) || !string(row.step) || !string(row.state)) return null;
  return {
    id: String(row.id), step: String(row.step), state: String(row.state),
    created_at: string(row.created_at), completed_at: string(row.completed_at),
    input_json: record(row.input_json), output_json: record(row.output_json),
  };
}
function dateTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
function number(value: number | null | undefined): string {
  return value == null ? "—" : Number(value).toLocaleString("th-TH");
}
function modeLabel(mode: string | null | undefined): string {
  return mode === "GROWTH" ? "Growth" : mode === "AFFILIATE" ? "Affiliate" : mode === "AUTO" ? "Auto" : "—";
}
function customerStepCopy(label: string | undefined) {
  const copy: Record<string, string> = {
    "สินค้า": "กำลังเลือกสินค้า", "เนื้อหา": "กำลังเตรียมเนื้อหา", "วิดีโอ": "กำลังสร้างวิดีโอ",
    "ตรวจสอบ": "กำลังตรวจวิดีโอ", "โพสต์": "กำลังโพสต์", "เสร็จ": "กำลังเก็บผลลัพธ์",
  };
  return label ? copy[label] ?? "กำลังทำงาน" : "กำลังทำงาน";
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
  const [accounts, overview] = await Promise.all([
    getOwnerAccounts(client, owner), getAutoOverview(client, owner),
  ]);
  const run = overview.activeRun ?? overview.runs.find((item) => item.run_date === today) ?? null;
  const detail = run ? await getAutoRun(client, owner, run.id) : null;
  const activeAccountId = overview.activeRun ? detail?.states[0]?.tiktok_account_id : null;
  const selectedAccount = accounts.find((item) => item.id === activeAccountId)
    ?? accounts.find((item) => item.id === accountParam) ?? accounts[0];
  const accountId = selectedAccount?.id;
  const current = detail?.states.find((item) => item.tiktok_account_id === accountId) ?? null;
  const status = describeOperatorRun(run, current ?? undefined);
  const customerStatus = !selectedAccount ? "รอการเชื่อมบัญชี" : status.state === "IDLE" ? "พร้อมทำงาน"
    : status.state === "RUNNING" || status.state === "STARTING" ? "กำลังทำงาน"
      : status.state === "COMPLETED" ? "เสร็จแล้ว" : ["BLOCKED", "FAILED"].includes(status.state) ? "ต้องการการดำเนินการ" : status.title;
  const provider = falAutoModeAvailability({
    keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState,
  });

  const metrics = accountId ? await Promise.all([
    client.from("master_videos").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("status", ["READY", "APPROVED"])
      .not("storage_path", "is", null).gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("master_videos").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("quality_status", "PASS").gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publish_eligibility_checks").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("final_status", ["HOLD", "REGENERATE", "REJECT", "ACCOUNT_BLOCKED"])
      .gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("status", ["QUEUED", "WAITING_FOR_SLOT"])
      .gte("created_at", dayStart).lt("created_at", dayEnd),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("status", "PUBLISHED").gte("completed_at", dayStart).lt("completed_at", dayEnd),
    client.from("publishing_queue").select("id", { count: "exact", head: true }).eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("status", "FAILED").gte("created_at", dayStart).lt("created_at", dayEnd),
  ]) : [];
  for (const metric of metrics) if (metric.error) throw new Error("operator_metric_read_failed");
  const stat = (index: number) => accountId ? (metrics[index]?.count ?? 0) : null;
  const [healthResult, budgetResult, recentResult, failedJobsResult, latestCheckpointResult, recentStepsResult] = accountId
    ? await Promise.all([
      client.from("account_publish_health").select("health_status,account_status,blockers_json")
        .eq("owner_id", owner).eq("tiktok_account_id", accountId).maybeSingle(),
      client.from("generation_budget_reservations").select("state,reserved_usd,actual_usd")
        .eq("owner_id", owner).eq("tiktok_account_id", accountId).eq("budget_day", today)
        .in("state", ["RESERVED", "SETTLED"]).limit(1000),
      client.from("publishing_queue").select("id,status,created_at,video_id,video_kind")
        .eq("owner_id", owner).eq("tiktok_account_id", accountId)
        .order("created_at", { ascending: false }).limit(5),
      client.from("generation_jobs").select("creative_project_id").eq("owner_id", owner)
        .eq("status", "FAILED").gte("created_at", dayStart).lt("created_at", dayEnd).limit(1000),
      run ? client.from("auto_checkpoints").select("checkpoint_version,state_json,created_at")
        .eq("owner_id", owner).eq("auto_run_id", run.id).eq("tiktok_account_id", accountId)
        .order("checkpoint_version", { ascending: false }).limit(1).maybeSingle() : Promise.resolve(null),
      run ? client.from("auto_run_steps").select("id,step,state,created_at,completed_at,input_json,output_json")
        .eq("owner_id", owner).eq("auto_run_id", run.id).eq("tiktok_account_id", accountId)
        .order("created_at", { ascending: false }).limit(100) : Promise.resolve(null),
    ]) : [null, null, null, null, null, null];
  for (const result of [healthResult, budgetResult, recentResult, failedJobsResult, latestCheckpointResult, recentStepsResult]) {
    if (result?.error) throw new Error("operator_control_center_read_failed");
  }
  const failedJobs = failedJobsResult?.data ?? [];
  if (failedJobs.length === 1000) throw new Error("operator_failed_jobs_limit");
  const failedProjectIds = [...new Set(failedJobs.map((row) => row.creative_project_id).filter((id): id is string => Boolean(id)))];
  const failedProjects = failedProjectIds.length ? await client.from("creative_projects")
    .select("id,tiktok_account_id").eq("owner_id", owner).in("id", failedProjectIds) : null;
  if (failedProjects?.error) throw new Error("operator_failed_projects_read_failed");
  const failedProjectAccount = new Map((failedProjects?.data ?? []).map((row) => [row.id, row.tiktok_account_id]));
  const failedGenerationCount = failedJobs.filter((row) => failedProjectAccount.get(row.creative_project_id) === accountId).length;

  const recentRows = (recentResult?.data ?? []) as QueueResult[];
  const masterIds = recentRows.filter((row) => row.video_kind === "MASTER" && row.video_id).map((row) => row.video_id as string);
  const variationIds = recentRows.filter((row) => row.video_kind === "VARIATION" && row.video_id).map((row) => row.video_id as string);
  const [masters, variations, analyticsResults] = await Promise.all([
    masterIds.length && accountId ? client.from("master_videos").select("id,product_id").eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("id", masterIds) : Promise.resolve(null),
    variationIds.length && accountId ? client.from("video_variations").select("id,product_id").eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).in("id", variationIds) : Promise.resolve(null),
    accountId ? Promise.all(recentRows.filter((row) => row.video_id).map((row) => client.from("video_analytics_snapshots")
      .select("video_id,video_kind,views,orders,source_snapshot_at,source").eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("video_id", row.video_id as string)
      .eq("video_kind", row.video_kind).order("source_snapshot_at", { ascending: false }).limit(1).maybeSingle())) : [],
  ]);
  if (masters?.error || variations?.error || analyticsResults.some((result) => result.error)) throw new Error("operator_recent_results_read_failed");
  const videoById = new Map<string, VideoRow>([...(masters?.data ?? []), ...(variations?.data ?? [])]
    .map((row) => [row.id, row] as const));
  const recentProductIds = [...new Set([...videoById.values()].map((row) => row.product_id).filter((id): id is string => Boolean(id)))];
  const recentProducts = recentProductIds.length ? await client.from("products")
    .select("id,title").eq("owner_id", owner).in("id", recentProductIds) : null;
  if (recentProducts?.error) throw new Error("operator_recent_products_read_failed");
  const recentProductById = new Map((recentProducts?.data ?? []).map((row) => [row.id, row.title]));
  const latestAnalytics = new Map((analyticsResults.flatMap((result) => result.data ? [result.data] : []) as AnalyticsRow[])
    .map((row) => [`${row.video_kind}:${row.video_id}`, row]));

  const accountSteps = (recentStepsResult?.data ?? []).map(stepEvidence)
    .filter((row): row is ControlCenterStepEvidence => Boolean(row));
  const rawLatestCheckpoint = record(latestCheckpointResult?.data?.state_json);
  const latestItemIndex = positiveInteger(rawLatestCheckpoint?.itemIndex) ?? 1;
  const itemIndex = current?.current_step === "COMPLETE" && latestItemIndex > 1 ? latestItemIndex - 1 : latestItemIndex;
  const priorItemCheckpoint = (detail?.checkpoints ?? []).filter((row) => record(row)?.tiktok_account_id === accountId)
    .map((row) => record(row)?.state_json).map(record)
    .find((state) => positiveInteger(state?.itemIndex) === itemIndex);
  const checkpoint = itemIndex === latestItemIndex ? rawLatestCheckpoint : priorItemCheckpoint ?? null;
  const itemSteps = accountSteps.filter((row) => positiveInteger(row.input_json?.itemIndex) === itemIndex);
  const evidence = (key: string) => string(checkpoint?.[key])
    ?? itemSteps.map((row) => string(row.output_json?.[key])).find(Boolean) ?? null;
  const productId = evidence("productId");
  const projectId = evidence("projectId");
  const scriptId = evidence("scriptId");
  const videoId = evidence("videoId");
  const [productResult, projectResult, videoResult] = await Promise.all([
    productId ? client.from("products").select("id,title,image_url").eq("owner_id", owner).eq("id", productId).maybeSingle() : Promise.resolve(null),
    projectId && accountId ? client.from("creative_projects").select("id").eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("id", projectId).maybeSingle() : Promise.resolve(null),
    videoId && accountId ? client.from("master_videos").select("id,storage_path").eq("owner_id", owner)
      .eq("tiktok_account_id", accountId).eq("id", videoId).maybeSingle() : Promise.resolve(null),
  ]);
  if (productResult?.error || projectResult?.error || videoResult?.error) throw new Error("operator_current_job_read_failed");
  const scriptResult = scriptId && projectResult?.data ? await client.from("scripts")
    .select("id,hook_text,voice_script,caption").eq("owner_id", owner)
    .eq("creative_project_id", projectResult.data.id).eq("id", scriptId).maybeSingle() : null;
  if (scriptResult?.error) throw new Error("operator_script_read_failed");
  const signedVideo = videoResult?.data?.storage_path ? await client.storage.from(VIDEO_BUCKET)
    .createSignedUrl(videoResult.data.storage_path, 900) : null;
  const videoUrl = signedVideo?.data?.signedUrl ?? null;
  const product = productResult?.data;
  const script = scriptResult?.data;
  const job = run && current && !["COMPLETED", "STOPPED", "FAILED"].includes(run.state)
    && !["COMPLETED", "STOPPED", "FAILED"].includes(current.state) ? current : null;
  const stages = mapControlCenterStages({ steps: accountSteps, currentStep: current?.current_step,
    currentState: current?.state, checkpoint, itemIndex });
  const customerStages = mapCustomerStages(stages);
  const activity = mapControlCenterActivity({ steps: accountSteps, limit: 8 });
  const completeCount = customerStages.filter((stage) => stage.state === "completed").length;

  const reservations = (budgetResult?.data ?? []) as Reservation[];
  const spent = reservations.filter((row) => row.state === "SETTLED")
    .reduce((sum, row) => sum + Number(row.actual_usd ?? 0), 0);
  const reserved = reservations.filter((row) => row.state === "RESERVED")
    .reduce((sum, row) => sum + Number(row.reserved_usd), 0);
  const accountBudget = Number((selectedAccount as typeof selectedAccount & { daily_video_budget_usd?: number | string } | undefined)?.daily_video_budget_usd ?? 0);
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
  const accountHealthy = Boolean(health && ["READY", "GOOD", "HEALTHY"].includes(health));
  const publishedToday = current?.published_today ?? 0;
  const target = current?.desired_daily_posts ?? 0;
  const progress = target > 0 ? Math.min(100, (publishedToday / target) * 100) : 0;
  const blockers = current?.blockers_json ?? run?.blockers_json ?? [];
  const knownBlocker = blockers.map((code) => blockerCopy[code]).find(Boolean);
  const setupCopy = setup === "affiliate" ? "บัญชีนี้ยังไม่พร้อมใช้ Affiliate กรุณาตรวจสิทธิ์ร้านค้า"
    : setup === "budget" ? "เป้าหมายหรืองบเกินขีดจำกัดของบัญชี กรุณาปรับค่าแล้วลองใหม่"
      : setup ? "ตรวจข้อมูลบัญชีแล้วลองอีกครั้ง" : null;
  const actionRequired = !selectedAccount
    ? { text: "เพิ่มหรือเชื่อมต่อบัญชี TikTok เพื่อเริ่มแผน", href: "/accounts" }
    : setupCopy ? { text: setupCopy, href: setup === "budget" ? null : "/accounts" }
      : current?.state === "WAITING_FOR_APPROVAL" ? { text: "ตรวจวิดีโอและยืนยันการเผยแพร่เพื่อให้งานไปต่อ", href: "/publishing" }
        : knownBlocker ? knownBlocker
          : current?.state === "FAILED" || current?.state === "BLOCKED"
            ? { text: "งานนี้ยังทำต่อไม่ได้ กรุณาตรวจบัญชีหรือติดต่อผู้ดูแล", href: "/accounts" }
            : !overview.activeRun && (selectedAccount.account_status !== "active" || selectedAccount.authorization_status !== "authorized")
              ? { text: "บัญชียังไม่พร้อมเริ่มแผน กรุณาตรวจการเชื่อมต่อ", href: `/accounts/${selectedAccount.id}` }
              : !overview.activeRun && !selectedAccount.is_mock && !selectedAccount.granted_scopes?.includes("video.publish")
                ? { text: "บัญชียังไม่มีสิทธิ์เผยแพร่วิดีโอ", href: `/accounts/${selectedAccount.id}` }
                : !overview.activeRun && !selectedAccount.is_mock && !providerReady
                  ? { text: "การสร้างวิดีโอยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง", href: null }
                  : !overview.activeRun && !selectedAccount.is_mock && accountBudget <= spent + reserved
                    ? { text: "งบสร้างวิดีโอวันนี้ไม่เพียงพอ", href: null }
                    : !overview.activeRun && !selectedAccount.is_mock && !tiktokReady
                      ? { text: "สิทธิ์เผยแพร่ TikTok สำหรับใช้งานจริงยังไม่พร้อม", href: `/accounts/${selectedAccount.id}` }
              : null;
  const metricCards: Array<{ label: string; value: number | null; tone: string }> = [
    { label: "สร้างแล้ว", value: stat(0), tone: "violet" },
    { label: "โพสต์แล้ว", value: stat(4), tone: "teal" },
    { label: "รอดำเนินการ", value: stat(3), tone: "blue" },
    { label: "ผ่านการตรวจ", value: stat(1), tone: "teal" },
    { label: "ปัญหา", value: accountId ? (stat(2) ?? 0) + (stat(5) ?? 0) + failedGenerationCount : null, tone: "rose" },
  ];
  const latestRealPerformance = recentRows.map((row) => latestAnalytics.get(`${row.video_kind}:${row.video_id}`))
    .find((snapshot) => snapshot && snapshot.source !== "MOCK" && (snapshot.views !== null || snapshot.orders !== null));
  if (latestRealPerformance?.views != null) {
    metricCards.push({ label: "ยอดดูคลิปล่าสุด", value: latestRealPerformance.views, tone: "blue" });
  }
  if (latestRealPerformance?.orders != null) {
    metricCards.push({ label: "คำสั่งซื้อคลิปล่าสุด", value: latestRealPerformance.orders, tone: "teal" });
  }

  return <div className="operator-page">
    <AutoRefresh/>
    <header className="operator-hero">
      <div className="operator-brand-mark" aria-hidden="true">V</div>
      <div className="operator-hero-copy"><p className="operator-overline">VIRALFLOW AI</p>
        <h1>Home</h1><p>เริ่มงานและดูผลลัพธ์ของคุณในหน้าเดียว</p></div>
      <span className={`operator-state ${status.tone}`}><span aria-hidden="true">●</span>{customerStatus}</span>
    </header>
    <section className="operator-command-card" aria-label="ควบคุมการทำงานอัตโนมัติ">
      <div className="operator-card-head"><div><h2>เริ่มงาน</h2></div>
        <span className="operator-date">{today}</span></div>
      <div className="operator-control-row">
        {accounts.length ? <OperatorStartForm requestKey={randomUUID()} disabled={!canStartOperatorRun(overview.activeRun)}
          selectedAccountId={selectedAccount?.id}
          accounts={accounts.map((account) => ({
            id: account.id, name: account.display_name, status: account.account_status,
            authorization: account.authorization_status, effectiveMode: account.effective_mode,
            target: account.daily_post_target, hardLimit: account.daily_post_hard_limit,
            budget: Number((account as typeof account & { daily_video_budget_usd?: number | string }).daily_video_budget_usd ?? 0),
          }))}/> : <div className="operator-empty"><strong>ยังไม่มีบัญชี TikTok</strong>
          <p>เพิ่มหรือเชื่อมต่อบัญชีเพื่อเริ่มแผนแรก</p><Link href="/accounts">เพิ่มบัญชี →</Link></div>}
        {run && <OperatorRunControls runId={run.id} state={run.state}/>}
      </div>
    </section>
    {actionRequired && <section className="operator-action-required" aria-label="ต้องดำเนินการ" role="alert">
      <div><h2>ต้องดำเนินการ</h2><p>{actionRequired.text}</p></div>
      {actionRequired.href && <Link href={actionRequired.href}>ไปตรวจสอบ ↗</Link>}
    </section>}
    <section className="operator-live" aria-label="สถานะปัจจุบัน" aria-live="polite">
      <div className="operator-live-head"><div><p className="operator-overline">กำลังทำอะไรอยู่</p>
        <h2>{customerStatus}</h2><p className="operator-live-summary">{job ? customerStepCopy(customerStages.find((stage) => stage.state === "active")?.label) : "ดูงานและผลลัพธ์ของคุณด้านล่าง"}</p></div>
        <span className={`operator-health-chip ${accountHealthy ? "good" : "attention"}`}>
          <span aria-hidden="true">●</span>{accountHealthy ? "บัญชีพร้อม" : "รอตรวจบัญชี"}
        </span></div>
      <dl className="operator-live-facts">
        <div><dt>บัญชี</dt><dd>{selectedAccount?.display_name ?? "—"}</dd></div>
        <div><dt>โหมด</dt><dd>{modeLabel(current?.effective_mode ?? selectedAccount?.effective_mode)}</dd></div>
        <div><dt>สินค้าที่กำลังทำ</dt><dd>{job ? product?.title ?? (job.current_step === "FIND_OPPORTUNITY" ? "กำลังเลือกสินค้า" : "ยังไม่มีข้อมูลสินค้า") : "—"}</dd></div>
        <div><dt>ขั้นตอน</dt><dd>{current ? current.current_step === "COMPLETE" ? "เสร็จแล้ว" : customerStepCopy(customerStages.find((stage) => stage.state === "active")?.label) : "ยังไม่เริ่ม"}</dd></div>
        <div><dt>เริ่มเมื่อ</dt><dd>{dateTime(run?.started_at)}</dd></div>
        <div><dt>อัปเดตล่าสุด</dt><dd>{dateTime(run?.updated_at)}</dd></div>
      </dl>
      <div className="operator-daily-progress"><div><span>เผยแพร่ตามเป้าหมายวันนี้</span>
        <strong>{current ? `${publishedToday} / ${target} คลิป` : "ยังไม่มีแผนวันนี้"}</strong></div>
        <div className="operator-progress-track" role="progressbar" aria-valuenow={Math.min(publishedToday, Math.max(1, target))}
          aria-valuemin={0} aria-valuemax={Math.max(1, target)} aria-label="จำนวนคลิปที่เผยแพร่ตามเป้าหมายวันนี้">
          <span style={{ width: `${progress}%` }}/></div></div>
      <div className="operator-pipeline-head"><div><h3>ความคืบหน้า</h3></div>
        <span>{run && current ? `${completeCount} / ${customerStages.length} ขั้น` : "ยังไม่มีงาน"}</span></div>
      <ol className="operator-pipeline operator-stage-list">
        {customerStages.map((stage) => <li className={`operator-stage ${stage.state}`} key={stage.id}
          aria-label={`${stage.label}: ${stage.state}`}>
          <span className="operator-stage-symbol" aria-hidden="true">{stage.state === "completed" ? "✓" : stage.state === "active" ? "●" : stage.state === "failed" ? "!" : "○"}</span>
          <span>{stage.label}</span></li>)}
      </ol>
    </section>
    <h2 className="operator-section-heading">วันนี้</h2><section className="operator-metrics" aria-label="ผลลัพธ์ของบัญชีวันนี้">
      {metricCards.map(({ label, value, tone }) => <article key={label} className={`operator-metric ${tone}`}>
        <span>{label}</span><strong>{number(value)}</strong></article>)}
    </section>
    <section className="operator-bottom-grid" aria-label="งานและกิจกรรมล่าสุด">
      <article className="operator-surface operator-current-job"><div className="operator-card-head"><h2>งานปัจจุบัน</h2></div>
        {job ? <>
          <div className="operator-job-layout">
            {product && <Image className="operator-job-image" src={product.image_url ?? "/product-placeholder.svg"}
              alt={product.image_url ? product.title : "ยังไม่มีภาพสินค้า"} width={96} height={112} unoptimized/>}
            <div><span className={`operator-mini-state ${status.tone}`}>{customerStatus}</span>
              <h3>{product?.title ?? (job.current_step === "FIND_OPPORTUNITY" ? "กำลังเลือกสินค้า" : "ยังไม่มีข้อมูลสินค้า")}</h3>
              <p>{customerStepCopy(customerStages.find((stage) => stage.state === "active")?.label)} · {modeLabel(job.effective_mode)}</p></div>
          </div>
          {script && <div className="operator-job-script"><strong>สคริปต์ที่เลือก</strong>
            <p>{script.hook_text}</p><p>{script.voice_script}</p></div>}
          {videoUrl && <div className="operator-job-preview"><video controls playsInline preload="metadata" src={videoUrl}
            aria-label="ตัวอย่างวิดีโอของงานปัจจุบัน"/></div>}
          {videoResult?.data && !videoUrl && <p className="operator-job-meta">มีรายการวิดีโอแล้ว แต่ยังไม่มีไฟล์ให้แสดงตัวอย่าง</p>}
        </> : <p className="operator-empty-copy">ไม่มีงานที่กำลังทำในขณะนี้</p>}
      </article>
      <article className="operator-surface operator-activity"><div className="operator-card-head"><h2>กิจกรรมล่าสุด</h2>
        <span>จากบันทึกขั้นตอนจริง</span></div>
        {activity.length ? <ol className="operator-activity-list">
          {activity.map((item) => <li className={`operator-activity-item ${item.state}`} key={item.id}>
            <span>{item.title}</span><time dateTime={item.occurredAt}>{dateTime(item.occurredAt)}</time>
          </li>)}
        </ol> : <p className="operator-empty-copy">ยังไม่มีขั้นตอนที่บันทึกไว้</p>}
      </article>
    </section>
    <section className="operator-surface operator-recent" aria-label="ผลลัพธ์ล่าสุด">
      <div className="operator-card-head"><h2>ผลลัพธ์ล่าสุด</h2></div>
      {recentRows.length ? <ul>{recentRows.map((row) => {
        const productId = videoById.get(row.video_id ?? "")?.product_id;
        const title = (productId && recentProductById.get(productId)) || "วิดีโอของบัญชีนี้";
        const state = queueState[row.status] ?? { label: "กำลังดำเนินการ", tone: "pending" };
        const analytics = latestAnalytics.get(`${row.video_kind}:${row.video_id}`);
        return <li key={row.id}><div className="operator-result-link">
          <span className="operator-result-icon" aria-hidden="true">▶</span>
          <span className="operator-result-copy"><strong>{title}</strong><small>{dateTime(row.created_at)}</small>
            {analytics && (analytics.views !== null || analytics.orders !== null) && <small className="operator-result-metrics">
              {analytics.views !== null ? `${number(analytics.views)} ครั้งที่ดู` : ""}
              {analytics.views !== null && analytics.orders !== null ? " · " : ""}
              {analytics.orders !== null ? `${number(analytics.orders)} คำสั่งซื้อ` : ""}
              {` · อัปเดต ${dateTime(analytics.source_snapshot_at)}`}
              {analytics.source === "MOCK" ? " · ข้อมูลจำลอง" : ""}
            </small>}</span>
          <span className={`operator-result-status ${state.tone}`}>{state.label}</span>
        </div></li>;
      })}</ul> : <p className="operator-empty-copy">ยังไม่มีผลลัพธ์จากบัญชีนี้</p>}
    </section>
  </div>;
}
