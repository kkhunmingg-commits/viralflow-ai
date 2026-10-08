import type {AccountSafetySummary} from "@/features/compliance-brain/presentation";
import {customerComplianceStatus,unavailableAccountSafety} from "@/features/compliance-brain/presentation";
import "./account-safety.css";
export function AccountSafetyCard({summary=unavailableAccountSafety()}:{summary?:AccountSafetySummary}) {
  const status=summary.latestStatus?customerComplianceStatus(summary.latestStatus,summary.latestRewritten):null;
  const date=summary.recentPolicyUpdate&&Number.isFinite(Date.parse(summary.recentPolicyUpdate))
    ?new Intl.DateTimeFormat("th-TH",{day:"numeric",month:"short",timeZone:"Asia/Bangkok"}).format(new Date(summary.recentPolicyUpdate)):null;
  return <section className="account-safety" aria-label="ความปลอดภัยบัญชี">
    <div className="account-safety-heading"><h3>Account Safety</h3>
      {status?<span className={`account-safety-status ${status.tone}`}>{status.label}</span>:null}</div>
    {summary.state==="READY"?<><dl className="account-safety-metrics">
      <div><dt>เนื้อหาที่ผ่านการตรวจ</dt><dd>{summary.safePercent}%</dd></div>
      <div><dt>ป้องกันโพสต์เสี่ยง</dt><dd>{summary.preventedRiskyPosts}</dd></div>
      <div><dt>ควรตรวจสอบ</dt><dd>{summary.reviewRequired}</dd></div>
      <div><dt>อัปเดตการป้องกันล่าสุด</dt><dd>{date??"ยังไม่มีข้อมูล"}</dd></div>
    </dl><p className="account-safety-note">จากผลตรวจที่บันทึกไว้ก่อนโพสต์และก่อนพูด LIVE {summary.checkedContent} รายการใน 30 วันที่ผ่านมา</p></>
      :<p className="account-safety-empty">{summary.state==="EMPTY"?"ยังไม่มีผลตรวจเนื้อหาก่อนโพสต์หรือก่อนพูด LIVE":"ข้อมูลการตรวจยังไม่พร้อม"}</p>}
    <p className="account-safety-note">ผลตรวจช่วยลดความเสี่ยง แต่แพลตฟอร์มอาจพิจารณาแตกต่างกัน</p>
  </section>;
}
