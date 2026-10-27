import {readAdDirectorView} from "@/features/creative/ad-director-service";
import {createClient} from "@/lib/supabase/server";
import {CRITIC_CRITERIA} from "@/features/creative/ad-director";

const CRITERION_TH:Record<(typeof CRITIC_CRITERIA)[number],string>={hook:"Hook",clarity:"ความชัด",novelty:"ความใหม่",productFit:"เหมาะกับสินค้า",visualFeasibility:"ทำภาพได้จริง",
  claimAccuracy:"ข้อกล่าวอ้าง",durationFit:"ความยาว",freshness:"ไม่ซ้ำคลิปเก่า",costRisk:"ต้นทุน/ความเสี่ยง",accountFit:"เหมาะกับบัญชี"};

/** What the AI Creative Director is thinking for this project, in Thai. Read-only and zero-cost. */
export async function AdDirectorPanel({owner,projectId}:{owner:string;projectId:string}){
  const client=await createClient();
  let view;try{view=await readAdDirectorView(client,owner,projectId)}catch(error){
    return <section className="panel"><h2>AI Creative Director</h2><p className="muted">ยังแสดงแผนไม่ได้: {error instanceof Error?error.message:String(error)}</p></section>}
  const {ranking,plan,storyboard,storyboardIssues,flow,evidence}=view,product=ranking.items[0];
  const critique=new Map(plan.critiques.map(c=>[c.conceptId,c]));
  return <section className="panel ad-director">
    <h2>AI Creative Director</h2>
    <p className="muted">โหมด: <strong>{plan.mode==="INTELLIGENT_LLM"?"INTELLIGENT (ใช้โมเดลภาษา)":"Director แบบ Playbook + หลักฐาน"}</strong> · {plan.modeReason}</p>
    <h3>สินค้าและเหตุผล</h3>
    <p>{ranking.headline}</p>
    {product&&<ul><li>คะแนนโอกาสทางตลาด: {product.opportunity.score??"UNKNOWN (ไม่ใช่ศูนย์)"}</li><li>ศักยภาพครีเอทีฟ: {product.creativePotential.score}/100</li>
      <li>ความมั่นใจของข้อมูล: {product.dataConfidence.label} ({product.dataConfidence.reasons.join(" · ")})</li>
      <li>สิทธิ์ผลิต: {product.eligibility.eligible?"ผ่าน":`ไม่ผ่าน — ${product.eligibility.blockers.join(" / ")}`}{product.eligibility.warnings.length?` · ข้อควรระวัง: ${product.eligibility.warnings.join(" / ")}`:""}</li></ul>}
    <p className="muted">หลักฐานที่ใช้ได้: ข้อเท็จจริง {evidence.facts} ข้อ · สื่อที่ผ่านสิทธิ์ {evidence.clearedAssets} ชิ้น</p>
    <h3>กลุ่มผู้ชมและ Insight</h3>
    <ul>{plan.insight.audience.map(a=><li key={a.text}>{a.text} <span className="muted">({a.status})</span></li>)}
      {plan.insight.differentiators.map(d=><li key={d.text}>จุดต่างที่ยืนยันได้: {d.text} <span className="muted">(EVIDENCED)</span></li>)}</ul>
    <p className="muted">ห้ามกล่าวอ้าง: {plan.insight.doNotClaim.join(" · ")}</p>
    <h3>แนวคิดโฆษณา ({plan.concepts.length} ทางเลือก)</h3>
    <p className="muted">{plan.scoreMeaning}</p>
    <div className="table-wrap"><table><thead><tr><th>แนวคิด</th><th>Hook</th><th>ข้อความหลัก</th><th>CTA</th><th>คะแนน</th><th>ผล</th></tr></thead><tbody>
      {plan.concepts.map(c=>{const r=critique.get(c.id);return <tr key={c.id} className={c.id===plan.selectedConceptId?"selected":undefined}>
        <td>{c.id===plan.selectedConceptId?"★ ":""}{c.formatLabel}<br/><span className="muted">{c.angle}</span></td><td>{c.hook.text}</td><td>{c.message}</td><td>{c.cta}</td>
        <td title={r?CRITIC_CRITERIA.map(k=>`${CRITERION_TH[k]} ${r.scores[k]}/10`).join(" · "):""}>{r?.total??"-"}</td><td>{r?.reasons.join(" · ")}</td></tr>})}
    </tbody></table></div>
    {storyboard&&<><h3>Storyboard ({storyboard.durationSeconds} วินาที · {storyboard.scenes.length} ฉาก)</h3>
      {storyboardIssues.length?<p className="error-text">ต้องแก้ก่อนผลิต: {storyboardIssues.map(i=>i.detail).join(" / ")}</p>:<p className="muted">ผ่านการตรวจโครงสร้าง หลักฐาน และสิทธิ์สื่อ</p>}
      <div className="table-wrap"><table><thead><tr><th>เวลา</th><th>บทบาท</th><th>ภาพ</th><th>กล้อง</th><th>ข้อความบนจอ</th><th>เสียง</th><th>หลักฐาน</th></tr></thead><tbody>
        {storyboard.scenes.map(s=><tr key={s.id}><td>{s.start.toFixed(1)}–{s.end.toFixed(1)}s</td><td>{s.role}</td><td>{s.shot}<br/><span className="muted">{s.background.kind==="AI_SCENE"?"ฉากบริบทจาก Flow (ไม่มีสินค้า)":"กราฟิกในเครื่อง"}{s.product?" + ภาพสินค้าจริง":""}</span></td>
          <td>{s.camera}</td><td>{[s.onScreen.badge,s.onScreen.headline,s.onScreen.sub,...(s.onScreen.checklist??[])].filter(Boolean).join(" · ")}</td><td>{s.sound}</td><td>{s.evidenceIds.join(", ")||"-"}</td></tr>)}
      </tbody></table></div></>}
    {flow&&<><h3>คำสั่งที่จะส่งให้ Google Flow</h3>
      <p>{flow.notes.join(" · ")}{flow.estimatedCredits!==null?` · ประมาณ ${flow.estimatedCredits} เครดิต (จากราคาที่เห็นใน UI ล่าสุด ไม่ใช่ราคาคงที่)`:""}</p>
      {flow.requests.map(r=><details key={r.sceneId}><summary>ฉาก {r.sceneId} ({r.role}) — ต้องได้รับอนุมัติเครดิตก่อน Generate</summary><pre className="prompt-preview">{r.prompt}</pre></details>)}</>}
    <p className="muted">ระบบนี้ไม่กด Generate และไม่ใช้บริการเสียเงินเอง: ต้นทุนเครดิตต้องได้รับอนุมัติจากเจ้าของทุกครั้ง</p>
  </section>;
}
