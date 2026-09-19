import Link from "next/link";
import {redirect} from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import {createClient} from "@/lib/supabase/server";
import {listVideoFactory} from "@/features/video/services";
import {createVideoCostPlan} from "@/features/video/provider-routing";
import {serverEnv} from "@/lib/server-env";
const money=(n:number|string)=>new Intl.NumberFormat("th-TH",{style:"currency",currency:"USD",minimumFractionDigits:4}).format(Number(n));
const range=(values:[number,number])=>`${money(values[0])}–${money(values[1])}`;
export default async function VideoFactoryPage(){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  const masters=await listVideoFactory(client,data.user.id),plans=[createVideoCostPlan("CURRENT_3_ACCOUNTS"),createVideoCostPlan("FUTURE_10_ACCOUNTS")];
  return <><PageHeading eyebrow="MASTER → VARIATIONS" title="Video Factory" description="วิดีโอ commerce แนวตั้ง 8 วินาทีจาก Creative Brain ด้วยเส้นทางต้นทุนต่ำสุด"/>
    <section className="detail-summary-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">PRIMARY PROVIDER CANDIDATE</p><h2>fal Wan 2.2 Turbo</h2></div><span className={`status-badge ${serverEnv.falWanProviderState==="PRODUCTION_APPROVED"&&serverEnv.falKey?"ready":"blocked"}`}>{serverEnv.falWanProviderState}</span></div><dl className="detail-list"><div><dt>Model</dt><dd>fal-ai/wan/v2.2-a14b/image-to-video/turbo</dd></div><div><dt>720p estimate</dt><dd>{money(.10)} / master</dd></div><div><dt>Benchmark quality</dt><dd>รอ 3 real samples และ owner review</dd></div><div><dt>Observed success rate</dt><dd>ยังไม่มีข้อมูลจริง</dd></div><div><dt>Retry-adjusted estimate</dt><dd>{money(.10/.85)} ที่ planning assumption 85%</dd></div><div><dt>Auto Mode</dt><dd>{serverEnv.falWanProviderState==="PRODUCTION_APPROVED"&&serverEnv.falKey?"READY":"WAITING_FOR_PROVIDER"}</dd></div></dl></article><article className="panel"><div className="panel-heading"><div><p className="eyebrow">DISABLED PREMIUM FALLBACK</p><h2>Google Veo 3.1 Lite</h2></div><span className="phase-chip">FALLBACK_DISABLED</span></div><p>เก็บ integration เดิมไว้ แต่ไม่ถูกเรียกก่อน fal และไม่เปิดใช้งานโดยไม่มี benchmark/approval</p><dl className="detail-list"><div><dt>Estimate</dt><dd>{money(.4)} / 8-second master</dd></div><div><dt>Configuration</dt><dd>{serverEnv.googleGenAIApiKey?"KEY CONFIGURED":"KEY NOT CONFIGURED"}</dd></div></dl></article></section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">COST DASHBOARD</p><h2>AI masters → controlled variations</h2></div><span className="phase-chip">85% planning success assumption</span></div><div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>Scale</th><th>Provider</th><th>Masters/day</th><th>Final/day</th><th>AI generations/month</th><th>Nominal/month</th><th>Retry-adjusted/month</th><th>Cost/final</th></tr></thead><tbody>{plans.flatMap(plan=>plan.providers.filter(item=>item.provider!=="google-veo-standard").map(item=><tr key={`${plan.scale}-${item.provider}`}><td>{plan.accounts} accounts</td><td>{item.label}</td><td>{plan.mastersPerDay.join("–")}</td><td>{plan.finalsPerDay.join("–")}</td><td>{plan.aiGenerationsPerMonth.join("–")}</td><td>{range(item.nominalMonthlyUsd)}</td><td>{range(item.retryAdjustedMonthlyUsd)}</td><td>{range(item.retryAdjustedCostPerFinalUsd)}</td></tr>))}</tbody></table></div><small>ตัวเลขเป็น forecast จากราคาสาธารณะและสมมติฐานสำเร็จ 85% ไม่ใช่ค่าใช้จ่ายจริง ระบบยังไม่เปิด paid mode</small></section>
    {masters.length?<section className="video-factory-grid">{masters.map(master=><Link className="panel video-master-card" href={`/video-factory/${master.id}`} key={master.id}>
      <div className="panel-heading"><div><span className="phase-chip">{master.render_strategy}</span><h2>{master.product_title}</h2></div><span className={`quality-badge ${String(master.quality_status).toLowerCase()}`}>{master.quality_status??"PENDING"}</span></div>
      <p>{master.account_name} · {master.requested_mode} → {master.effective_mode} · {master.width}×{master.height} · {Number(master.duration_seconds).toFixed(2)}s</p>
      <dl className="detail-list">
        <div><dt>Quality</dt><dd>{master.quality_score??"—"} · {master.quality_status??"PENDING"}</dd></div>
        <div><dt>Compliance / Claims</dt><dd>{master.compliance?.overall_status??"—"} / {master.compliance?.claim_status??"—"}</dd></div>
        <div><dt>Originality</dt><dd>{master.originality?.originality_status??"—"} · {Number(master.originality?.overall_similarity??0).toFixed(2)}</dd></div>
        <div><dt>AIGC</dt><dd>{master.compliance?.aigc_status??"—"}</dd></div>
        <div><dt>Account Health</dt><dd>{master.publish_health?.health_status??"—"}</dd></div>
        <div><dt>Effective Publish Cap</dt><dd>{master.publish_health?.effective_publish_cap??"—"}</dd></div>
        <div><dt>Used / Remaining Slots</dt><dd>{master.publish_health?`${master.publish_health.posts_today} / ${Math.max(0,master.publish_health.effective_publish_cap-master.publish_health.posts_today)}`:"—"}</dd></div>
        <div><dt>Eligibility</dt><dd>{master.publish_status}</dd></div>
        <div><dt>Blockers</dt><dd>{(master.eligibility?.blockers_json as string[]|undefined)?.join(", ")||"ไม่มี"}</dd></div>
        <div><dt>Cost</dt><dd>{money(master.estimated_cost_usd)}</dd></div>
      </dl>
    </Link>)}</section>:<section className="empty-state"><span>VF</span><h2>ยังไม่มี Master Video</h2><p>เลือกแนวคิดใน Creative Studio แล้วกด CREATE VIDEO เพื่อสร้าง MP4 ด้วย FFmpeg</p><Link className="primary-action" href="/creative-studio">ไปที่ Creative Studio</Link></section>}
  </>;
}

