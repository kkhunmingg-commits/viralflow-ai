import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {PageHeading} from "@/components/page-heading";
import {createClient} from "@/lib/supabase/server";
import {getVideoDetail} from "@/features/video/services";
import {getLatestVideoGate} from "@/features/compliance/services";
import {createVariationsAction,renderVariationAction,retryMasterAction,setVideoStatusAction} from "../actions";
import {queueVideoAction} from "../../publishing/actions";
const money=(n:number|string)=>new Intl.NumberFormat("th-TH",{style:"currency",currency:"USD",minimumFractionDigits:4}).format(Number(n));
export default async function VideoDetailPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params,client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  let detail;try{detail=await getVideoDetail(client,data.user.id,id)}catch{return notFound()}
  const {master,product,account,script,variations,jobs,costs,signedUrl}=detail,gate=await getLatestVideoGate(client,data.user.id,id);
  return <><PageHeading eyebrow="VIDEO MASTER" title={String(product?.title??"Video")} description={`${account?.display_name??"Account"} · ${master.render_strategy} · ${master.status}`} action={<Link className="secondary-action" href="/video-factory">← Video Factory</Link>}/>
    <section className="video-detail-grid"><article className="panel video-preview-panel">{signedUrl?<video controls playsInline src={signedUrl}/>:<div className="video-placeholder">ยังไม่มีไฟล์วิดีโอ</div>}<div className="form-actions">
      <form action={setVideoStatusAction}><input type="hidden" name="id" value={id}/><input type="hidden" name="masterId" value={id}/><input type="hidden" name="kind" value="master"/><input type="hidden" name="status" value="APPROVED"/><button className="primary-action" disabled={master.quality_status!=="PASS"}>APPROVE</button></form>
      <form action={setVideoStatusAction}><input type="hidden" name="id" value={id}/><input type="hidden" name="masterId" value={id}/><input type="hidden" name="kind" value="master"/><input type="hidden" name="status" value="REJECTED"/><button className="danger-action">REJECT</button></form>
      <form action={retryMasterAction}><input type="hidden" name="masterId" value={id}/><input type="hidden" name="projectId" value={String(master.creative_project_id)}/><button className="secondary-action">RETRY</button></form>
      <form action={queueVideoAction}><input type="hidden" name="account_id" value={String(master.tiktok_account_id)}/><input type="hidden" name="video_id" value={id}/><input type="hidden" name="video_kind" value="MASTER"/><select name="publish_mode" aria-label="Publish mode"><option value="DRAFT_UPLOAD">DRAFT UPLOAD</option><option value="DIRECT_POST">DIRECT POST</option></select><button className="secondary-action" disabled={master.quality_status!=="PASS"}>ADD TO PUBLISHING</button></form>
    </div></article>
    <article className="panel"><h2>Quality & cost</h2><dl className="detail-list"><div><dt>Quality</dt><dd>{String(master.quality_score??"—")} · {String(master.quality_status??"PENDING")}</dd></div><div><dt>Format</dt><dd>{String(master.width)}×{String(master.height)} · {Number(master.duration_seconds).toFixed(3)}s · {Number(master.fps).toFixed(2)}fps</dd></div><div><dt>Provider</dt><dd>{String(master.provider)} · {String(master.model)}</dd></div><div><dt>Cost</dt><dd>{money(Number(master.estimated_cost_usd))}</dd></div></dl><details><summary>Quality explanation</summary><pre className="metadata-json">{JSON.stringify(master.quality_explanation_json,null,2)}</pre></details></article></section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">PRE-PUBLISH GATE</p><h2>{gate.eligibility?.final_status??"NOT CHECKED"}</h2></div><Link href="/compliance">เปิด Compliance →</Link></div>
      <dl className="detail-list">
        <div><dt>Quality</dt><dd>{String(master.quality_score??"—")} · {String(master.quality_status??"PENDING")}</dd></div>
        <div><dt>Compliance</dt><dd>{gate.compliance?.overall_status??"—"}</dd></div>
        <div><dt>Claims / Product Truth</dt><dd>{gate.compliance?.claim_status??"—"} / {gate.compliance?.product_truth_status??"—"}</dd></div>
        <div><dt>AIGC</dt><dd>{gate.compliance?.aigc_status??"—"}</dd></div>
        <div><dt>Originality</dt><dd>{gate.originality?.originality_status??"—"} · {Number(gate.originality?.overall_similarity??0).toFixed(2)}</dd></div>
        <div><dt>Account Health</dt><dd>{String(gate.health?.health_status??"—")}</dd></div>
        <div><dt>Effective Publish Cap</dt><dd>{String(gate.health?.effective_publish_cap??"—")}</dd></div>
        <div><dt>Used / Remaining Slots</dt><dd>{gate.health?`${gate.health.posts_today} / ${Math.max(0,Number(gate.health.effective_publish_cap)-Number(gate.health.posts_today))}`:"—"}</dd></div>
        <div><dt>Eligibility</dt><dd>{gate.eligibility?.final_status??"NOT CHECKED"}</dd></div>
        <div><dt>Blockers</dt><dd>{(gate.eligibility?.blockers_json as string[]|undefined)?.join(", ")||"ไม่มี"}</dd></div>
      </dl><small>การเผยแพร่ต้องได้รับอนุมัติจากเจ้าของเสมอ และ Phase 6C ไม่เรียก TikTok API</small>
    </section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">CREATIVE TIMELINE</p><h2>Scene plan</h2></div><span className="phase-chip">8 SECONDS</span></div>{(script?.scene_plan_json as Array<{start:number;end:number;visual:string;motion:string}>??[]).map((scene,i)=><p key={i}>{scene.start}–{scene.end}s · {scene.visual} · {scene.motion}</p>)}</section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">CONTROLLED OUTPUT</p><h2>Variations</h2></div><form action={createVariationsAction}><input type="hidden" name="masterId" value={id}/><button className="primary-action">CREATE VARIATIONS</button></form></div>
      <div className="variation-list">{variations.map(v=><article className="variation-row" key={v.id}><div><span className="phase-chip">#{v.variation_index} {v.variation_type}</span><h3>{v.hook_variant}</h3><p>{v.cta_variant}</p><small>Similarity {Number(v.similarity_score).toFixed(2)} · Quality {v.quality_score??"—"} · {money(v.estimated_cost_usd)} · {v.status}</small></div>
        {v.signed_url?<video controls playsInline src={v.signed_url}/>:<div className="variation-placeholder">Queued</div>}<div className="video-actions">
          <form action={renderVariationAction}><input type="hidden" name="masterId" value={id}/><input type="hidden" name="variationId" value={v.id}/><button className="secondary-action">{v.status==="FAILED"?"RETRY":"RENDER"}</button></form>
          <form action={setVideoStatusAction}><input type="hidden" name="id" value={v.id}/><input type="hidden" name="masterId" value={id}/><input type="hidden" name="kind" value="variation"/><input type="hidden" name="status" value="APPROVED"/><button className="primary-action" disabled={v.quality_status!=="PASS"}>APPROVE</button></form>
          <form action={setVideoStatusAction}><input type="hidden" name="id" value={v.id}/><input type="hidden" name="masterId" value={id}/><input type="hidden" name="kind" value="variation"/><input type="hidden" name="status" value="REJECTED"/><button className="danger-action">REJECT</button></form>
          <form action={queueVideoAction}><input type="hidden" name="account_id" value={String(v.tiktok_account_id)}/><input type="hidden" name="video_id" value={v.id}/><input type="hidden" name="video_kind" value="VARIATION"/><input type="hidden" name="publish_mode" value="DRAFT_UPLOAD"/><button className="secondary-action" disabled={v.quality_status!=="PASS"}>QUEUE DRAFT</button></form>
        </div></article>)}</div>
    </section>
    <section className="video-detail-grid"><article className="panel"><h2>Generation history</h2>{jobs.map(job=><p key={job.id}>{job.job_type} · {job.provider} · attempt {job.attempt}/{job.max_attempts} · {job.status}</p>)}</article><article className="panel"><h2>Cost ledger</h2>{costs.length?costs.map(cost=><p key={cost.id}>{cost.provider} · {cost.quantity} {cost.unit} · {money(cost.total_cost_usd)}</p>):<p>ไม่มีค่าใช้จ่าย</p>}</article></section>
  </>;
}
