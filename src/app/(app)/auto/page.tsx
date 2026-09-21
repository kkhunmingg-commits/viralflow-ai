import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoControls } from "@/components/auto-controls";
import { PageHeading } from "@/components/page-heading";
import { getAutoOverview } from "@/features/auto/services";
import { createVideoCostPlan, falAutoModeAvailability } from "@/features/video/provider-routing";
import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

export default async function AutoPage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  const overview = await getAutoOverview(client, data.user.id);
  const summary = overview.summary;
  const pilot = createVideoCostPlan("CURRENT_3_ACCOUNTS");
  const fal = pilot.providers.find((provider) => provider.provider === "fal-wan-2.2-turbo")!;
  const providerGate = falAutoModeAvailability({
    keyPresent: Boolean(serverEnv.falKey),
    state: serverEnv.falWanProviderState,
  });

  return <>
    <PageHeading eyebrow="FULL AUTO MODE" title="Auto Orchestration" description="วางแผนทุกบัญชีแบบ checkpointed, approval-aware และ fail-closed โดยปิด real publishing และ paid provider ไว้" action={<AutoControls runId={overview.activeRun?.id} state={overview.activeRun?.state}/>}/>
    <section className="stats-grid">{[
      ["Running",summary.running],["Paused",summary.paused],["Blocked",summary.blocked],
      ["Waiting approval",summary.waitingApprovals],["Waiting slot",summary.waitingSlots],
      ["Cost today",`$${summary.costToday.toFixed(2)}`],["Generated",summary.generatedToday],["Published",summary.publishedToday],
    ].map(([key,value])=><article className="stat-card violet" key={key}><p>{key}</p><strong>{value}</strong><small>Phase 10 local/mock boundary</small></article>)}</section>
    <section className="detail-summary-grid">
      <article className="panel">
        <div className="panel-heading"><div><p className="eyebrow">PRIMARY VIDEO PROVIDER</p><h2>fal Wan 2.2 Turbo</h2></div><span className={`status-badge ${providerGate.providerAvailable?"ready":"blocked"}`}>{providerGate.state}</span></div>
        <dl className="detail-list">
          <div><dt>Production state</dt><dd>{serverEnv.falWanProviderState}</dd></div>
          <div><dt>Paid mode</dt><dd>DISABLED</dd></div>
          <div><dt>Gate reason</dt><dd>{providerGate.reason??"APPROVED"}</dd></div>
          <div><dt>Google fallback</dt><dd>FALLBACK_DISABLED</dd></div>
        </dl>
      </article>
      <article className="panel">
        <div className="panel-heading"><div><p className="eyebrow">3-ACCOUNT PLAN</p><h2>{pilot.mastersPerDay.join("–")} masters → {pilot.finalsPerDay.join("–")} finals/day</h2></div><span className="phase-chip">LOCAL VARIATIONS</span></div>
        <dl className="detail-list">
          <div><dt>fal nominal/month</dt><dd>${fal.nominalMonthlyUsd.join("–")}</dd></div>
          <div><dt>Retry-adjusted/month</dt><dd>${fal.retryAdjustedMonthlyUsd.join("–")}</dd></div>
          <div><dt>Manual Flow</dt><dd>REFERENCE ONLY</dd></div>
        </dl>
      </article>
    </section>
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">RUN HISTORY</p><h2>Durable runs</h2></div><span className="phase-chip">full-auto-mode-v1</span></div>
      {overview.runs.length?<div className="data-list">{overview.runs.map(run=><div key={run.id}><Link href={`/auto/runs/${run.id}`}><strong>{run.run_date} · {run.state}</strong></Link><span>${Number(run.spent_usd).toFixed(2)} / ${Number(run.budget_usd).toFixed(2)}</span><small>{run.current_step} · attempt {run.attempt} · {run.blockers_json.join(", ")||"ไม่มี blocker"}</small></div>)}</div>:<p className="muted">ยังไม่มี Auto run — START จะสร้างแผนและหยุดที่ approval โดยไม่ส่งงานจริงออกภายนอก</p>}
    </section>
  </>;
}
