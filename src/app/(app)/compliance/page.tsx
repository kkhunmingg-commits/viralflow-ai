import Link from "next/link";
import {redirect} from "next/navigation";
import {z} from "zod";
import {PageHeading} from "@/components/page-heading";
import {listComplianceDashboard} from "@/features/compliance/services";
import {createClient} from "@/lib/supabase/server";

const filterSchema=z.object({status:z.enum(["READY","REVIEW","HOLD","REJECT","ACCOUNT_BLOCKED"]).optional()});
function group(status:string){if(status.startsWith("READY"))return "READY";if(status==="HOLD"||status==="REGENERATE"||status==="QUEUED_NEXT_DAY")return "HOLD";if(status==="REJECT")return "REJECT";if(status==="ACCOUNT_BLOCKED")return "ACCOUNT_BLOCKED";return "REVIEW"}
export default async function CompliancePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");const filter=filterSchema.parse(await searchParams),dashboard=await listComplianceDashboard(client,data.user.id),items=filter.status?dashboard.items.filter(i=>group(i.final_status)===filter.status):dashboard.items;
  return <><PageHeading eyebrow="PRE-PUBLISH GATE" title="Compliance & Originality" description="ตรวจคำกล่าวอ้าง ความจริงของสินค้า ความซ้ำ คุณภาพ และสุขภาพบัญชีก่อนขออนุมัติเผยแพร่"/>
    <form className="panel radar-filters"><label>สถานะ<select name="status" defaultValue={filter.status??""}><option value="">ALL</option>{["READY","REVIEW","HOLD","REJECT","ACCOUNT_BLOCKED"].map(v=><option value={v} key={v}>{v}</option>)}</select></label><button className="secondary-action">FILTER</button></form>
    <section className="stats-grid compact-stats"><article className="stat-card green"><p>Ready</p><strong>{dashboard.items.filter(i=>group(i.final_status)==="READY").length}</strong><small>รอเจ้าของอนุมัติ</small></article><article className="stat-card amber"><p>Hold / review</p><strong>{dashboard.items.filter(i=>["HOLD","REVIEW"].includes(group(i.final_status))).length}</strong><small>ต้องแก้หรือตรวจเพิ่ม</small></article><article className="stat-card blue"><p>Accounts</p><strong>{dashboard.health.length}</strong><small>มีข้อมูล publish health</small></article><article className="stat-card violet"><p>Approval</p><strong>REQUIRED</strong><small>ไม่มี silent publish</small></article></section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">LATEST EVIDENCE</p><h2>{items.length} รายการ</h2></div></div>{items.length?<div className="data-list">{items.map(item=><div key={item.id}>
      <strong>{item.product_title} · {item.account_name}</strong><span className={`status-badge ${group(item.final_status).toLowerCase()}`}>{item.final_status}</span>
      <small>Mode {item.requested_mode} → {item.effective_mode} · Quality {item.quality_pass?"PASS":"HOLD"}</small>
      <small>Compliance {item.compliance?.overall_status??"—"} · Claims {item.compliance?.claim_status??"—"} · Product Truth {item.compliance?.product_truth_status??"—"} · AIGC {item.compliance?.aigc_status??"—"}</small>
      <small>Originality {item.originality?.originality_status??"—"} · overall {Number(item.originality?.overall_similarity??0).toFixed(2)} · cross-account {Number(item.originality?.cross_account_similarity??0).toFixed(2)}</small>
      <small>Blockers {(item.blockers_json as string[]).join(", ")||"ไม่มี"} · Human approval {item.user_approved?"APPROVED":"REQUIRED"}</small>
      <Link href={`/video-factory/${item.video_link_id}`}>ดูวิดีโอ →</Link>
    </div>)}</div>:<p className="muted">ยังไม่มีผลตรวจ กด APPROVE ที่ Video Factory เพื่อรัน gate</p>}</section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">ACCOUNT PUBLISH HEALTH</p><h2>{dashboard.health.length} บัญชี</h2></div></div>{dashboard.health.length?<div className="data-list">{dashboard.health.map(item=><div key={item.id}>
      <strong>{item.account_name} · {item.health_status}</strong>
      <small>Mode {item.requested_mode} → {item.effective_mode} · Effective Publish Cap {item.effective_publish_cap}</small>
      <small>Used Slots {item.posts_today} · Remaining Slots {Math.max(0,item.effective_publish_cap-item.posts_today)} · Failed {item.failed_posts_today}</small>
      <small>Blockers {(item.blockers_json as string[]).join(", ")||"ไม่มี"}</small>
    </div>)}</div>:<p className="muted">ยังไม่มีข้อมูล account publish health</p>}</section>
  </>;
}
