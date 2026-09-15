import Link from "next/link";
import { notFound,redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";
import { getCreativeProjectDetail } from "@/features/creative/services";
import { editCreativeAction,generateCreativeAction,rejectCreativeAction,selectCreativeAction } from "../actions";
const money=(n:number|string)=>new Intl.NumberFormat("th-TH",{style:"currency",currency:"USD",minimumFractionDigits:4}).format(Number(n));
export default async function CreativeProjectPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params,client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  let detail;try{detail=await getCreativeProjectDetail(client,data.user.id,id);}catch{return notFound();}
  const {context,angles,scripts,generations}=detail,scriptByAngle=new Map(scripts.map(s=>[s.creative_angle_id,s]));
  return <><PageHeading eyebrow="CREATIVE PROJECT" title={context.product.title} description={`${context.account.name} · ${context.account.mode} · Assignment ${context.assignment.score.toFixed(2)}`} action={<Link className="secondary-action" href="/creative-studio">← Creative Studio</Link>}/>
    <section className="panel creative-context"><div><strong>เหตุผลจาก Assignment</strong><p>{context.assignment.reason}</p></div><div><strong>Product / Category</strong><p>Momentum {context.product.momentum} · Category {context.category.momentum} · Commercial {context.category.commercialOpportunity}</p></div><div><strong>Account fit</strong><p>{context.signals.accountProductFit} · Final Opportunity {context.signals.finalViralOpportunity}</p></div></section>
    <form action={generateCreativeAction} className="creative-generate"><input type="hidden" name="projectId" value={id}/><button className="primary-action">{angles.length?"REGENERATE 5 CONCEPTS":"GENERATE 5 CREATIVES"}</button></form>
    <section className="creative-concepts">{angles.map(angle=>{const script=scriptByAngle.get(angle.id);if(!script)return null;return <article className={`panel creative-card ${angle.is_selected?"selected":""}`} key={angle.id}>
      <div className="panel-heading"><div><span className="phase-chip">{angle.angle_type}</span><h2>{angle.title}</h2></div><strong className="creative-score">{Number(angle.score).toFixed(1)}</strong></div>
      <h3>{angle.hook}</h3><p><strong>Voice:</strong> {script.voice_script}</p>
      <div><strong>Overlay</strong>{(script.overlay_text_json as Array<{start:number;end:number;text:string}>).map((o,i)=><p key={i}>{o.start}–{o.end}s · {o.text}</p>)}</div>
      <div><strong>Scene plan</strong>{(script.scene_plan_json as Array<{start:number;end:number;visual:string;motion:string}>).map((s,i)=><p key={i}>{s.start}–{s.end}s · {s.visual} · {s.motion}</p>)}</div>
      <p><strong>CTA:</strong> {script.cta_text}</p><p><strong>Caption:</strong> {script.caption}</p><p>{(script.hashtags_json as string[]).join(" ")}</p>
      <p><span className={`risk-badge risk-${String(angle.policy_status).toLowerCase()}`}>{angle.policy_status}</span> · {script.status}</p>
      <div className="form-actions"><form action={selectCreativeAction}><input type="hidden" name="projectId" value={id}/><input type="hidden" name="angleId" value={angle.id}/><input type="hidden" name="scriptId" value={script.id}/><button className="primary-action" disabled={angle.policy_status==="REJECT"}>SELECT</button></form>
      <form action={rejectCreativeAction}><input type="hidden" name="projectId" value={id}/><input type="hidden" name="scriptId" value={script.id}/><button className="danger-action">REJECT</button></form></div>
      <details className="creative-edit"><summary>EDIT</summary><form action={editCreativeAction}><input type="hidden" name="projectId" value={id}/><input type="hidden" name="scriptId" value={script.id}/><label>Voice<textarea name="voice_script" defaultValue={script.voice_script}/></label><label>CTA<input name="cta_text" defaultValue={script.cta_text}/></label><label>Caption<textarea name="caption" defaultValue={script.caption}/></label><button className="secondary-action">บันทึกการแก้ไข</button></form></details>
    </article>})}</section>
    <section className="panel radar-section"><h2>Generation metadata</h2>{generations.length?generations.map(g=><p key={g.id}>{g.provider} · {g.model} · {g.prompt_version} · {g.input_tokens}/{g.output_tokens} tokens · {money(g.estimated_cost)} · {g.status}</p>):<p className="muted">ยังไม่มี generation</p>}</section>
  </>;
}

