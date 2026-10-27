import type {VideoCritique} from "@/features/video/creative-critic";
import {critiqueMasterAction} from "../actions";

const STATUS_TH={PASS:"ผ่าน",FAIL:"ไม่ผ่าน",UNKNOWN:"ไม่ทราบ"} as const;
/** Technical and creative verdicts side by side, so a valid file is never mistaken for a good advert. */
export function CreativeCriticPanel({masterId,explanation}:{masterId:string;explanation:Record<string,unknown>|null}){
  const critic=(explanation?.creativeCritic??null) as (VideoCritique&{checkedAt?:string})|null;
  return <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">AI VIDEO QUALITY CRITIC</p>
    <h2>{critic?`${critic.technical.status} · ${critic.creative.status}`:"ยังไม่ได้ตรวจเชิงสร้างสรรค์"}</h2></div>
    <form action={critiqueMasterAction}><input type="hidden" name="masterId" value={masterId}/><button className="secondary-action">{critic?"ตรวจอีกครั้ง":"ตรวจคุณภาพเชิงสร้างสรรค์"}</button></form></div>
    {critic?<>
      <p>{critic.decision==="READY_FOR_OWNER_REVIEW"?"ผ่านเกณฑ์อัตโนมัติ — รอเจ้าของตรวจความถูกต้องของสินค้าและข้อความ":"ไม่ผ่าน — "+critic.nextAction}</p>
      <dl className="detail-list"><div><dt>Technical</dt><dd>{critic.technical.score}/100</dd></div><div><dt>Visual</dt><dd>{critic.visual.score}/100</dd></div>
        <div><dt>Creative</dt><dd>{critic.creative.score}/100</dd></div><div><dt>Semantic (Vision)</dt><dd>{critic.semantic.status} · {critic.semantic.detail}</dd></div>
        <div><dt>ตรวจเมื่อ</dt><dd>{critic.checkedAt??"-"}</dd></div></dl>
      <div className="table-wrap"><table><thead><tr><th>กลุ่ม</th><th>ข้อ</th><th>ผล</th><th>รายละเอียด</th></tr></thead><tbody>
        {([["Technical",critic.technical.checks],["Visual",critic.visual.checks],["Creative",critic.creative.checks]] as const).flatMap(([group,checks])=>checks.map(c=>
          <tr key={`${group}-${c.key}`}><td>{group}</td><td>{c.key}</td><td>{STATUS_TH[c.status]}</td><td>{c.detail}</td></tr>))}
      </tbody></table></div>
      <small>คะแนนเป็นเกณฑ์ตรวจของระบบ ไม่ใช่การทำนายยอดวิว · ผลนี้ไม่เปลี่ยนสถานะ Quality/Approval/Publishing เดิม</small>
    </>:<p className="muted">ระบบจะตรวจ Hook, โครงเรื่อง, ความหลากหลายของภาพ, จังหวะ, เสียง/ความดัง และความซ้ำกับคลิปเก่า แยกจากการตรวจไฟล์ทางเทคนิค</p>}
  </section>;
}
