import { CTA_VARIANTS, type GroupResult } from "@/features/flow-farm/learning";
import { after } from "next/server";
import { loadLearning, statsScopeGranted, syncStaleAccounts, type LearningView } from "@/features/flow-farm/learning-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveClipStatsAction, syncClipStatsAction } from "./flow-actions";

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const n = (value: number | null | undefined) => value === null || value === undefined ? "–" : new Intl.NumberFormat("th-TH").format(value);
const ctaLabel = Object.fromEntries(CTA_VARIANTS.map(v => [v.id, v.label])) as Record<string, string>;

function verdict(group: GroupResult) {
  if (!group.posted) return "ยังไม่มีผล · จะลองทำ";
  if (group.weight >= 1.3) return "ได้ผลดี · ทำเพิ่ม";
  if (group.weight <= 0.7) return "ได้ผลน้อย · ทำน้อยลง";
  return "พอใช้ · ทดสอบต่อ";
}

/** Step 4: what the posted clips taught, and where the owner adds numbers TikTok's API does not give (new followers). */
export async function LearningPanel({ owner, accountId, scopes }: { owner: string; accountId: string; scopes: unknown }) {
  let view: LearningView | null = null;
  const admin = createAdminClient();
  try { view = await loadLearning(admin, owner, accountId); } catch { view = null; }
  // Fresh numbers for the next visit, without making this one wait.
  after(() => syncStaleAccounts(admin, owner).catch(() => {}));
  const back = <input type="hidden" name="back" value={accountId} />;
  const canSync = statsScopeGranted(scopes);
  const posted = (view?.clips ?? []).filter(c => c.status === "POSTED" && c.kind === "GROWTH")
    .toSorted((a, b) => (b.postedAt ?? b.createdAt).localeCompare(a.postedAt ?? a.createdAt)).slice(0, 15);
  const report = view?.report;
  const followers = view?.followers ?? [];
  const followerGain = followers.length >= 2 ? followers.at(-1)!.count - followers[0].count : null;

  return <section className="manual-panel" aria-labelledby="learn-title">
    <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 4 · เรียนรู้จากผลจริง</p>
      <h2 id="learn-title">ระบบเรียนรู้ว่าคลิปแบบไหนคนชอบ</h2></div>
      {report && <span className="manual-private">{report.status === "NO_DATA" ? "ยังไม่มีผลคลิป" : `เรียนรู้จาก ${report.sampleSize} คลิป`}</span>}</div>
    <p className="manual-muted">ทุกครั้งที่กดสร้างคลิป ระบบดูยอดวิว ไลก์ คอมเมนต์ แชร์ และผู้ติดตามใหม่ของคลิปที่โพสต์ไปแล้ว
      แล้วทำซีรีส์ที่คนชอบบ่อยขึ้น ต่อเป็นตอน (EP) ให้คนกดติดตามรอตอนใหม่ เลือกคำชวนติดตามที่ได้ผลที่สุด
      และเพิ่มคำสั่งให้ Flow ทำภาพเนียนขึ้นในซีรีส์ที่คุณกดทิ้งบ่อย ยังคงลองแบบใหม่ ๆ ด้วยเสมอ เพื่อหาสิ่งที่ดีกว่าเดิม</p>

    <div className="library-start">
      {canSync ? <form action={syncClipStatsAction}><input type="hidden" name="accountId" value={accountId} />{back}
        <button className="manual-primary" type="submit">ดึงยอดวิวล่าสุดจาก TikTok</button></form>
        : <a className="manual-primary" href="/auth/tiktok/start?inbox=1&stats=1&new_account=1">อนุญาตให้ระบบอ่านยอดวิว (ครั้งเดียว)</a>}
      <p className="manual-muted">{view?.syncedAt ? `ดึงยอดล่าสุด ${bangkokTime(view.syncedAt)}${view.lastVideos !== null ? ` (พบวิดีโอสาธารณะ ${view.lastVideos} · จับคู่กับคลังได้ ${view.lastMatched ?? 0})` : ""} · ` : ""}
        {canSync ? "ระบบดึงยอดวิว ไลก์ คอมเมนต์ แชร์ และยอดผู้ติดตามเองทุกชั่วโมง ไม่ต้องกรอกอะไร ผู้ติดตามต่อคลิปเป็นค่าประมาณจากยอดผู้ติดตามที่เพิ่มขึ้นหลังคลิปนั้นโพสต์"
          : "กดอนุญาตครั้งเดียว แล้วระบบจะดึงทุกอย่างเองทุกชั่วโมง"}
        {followerGain !== null ? ` · ผู้ติดตามเพิ่ม ${n(followerGain)} คนตั้งแต่เริ่มวัด` : ""}</p>
    </div>
    {view?.syncedAt && view.lastVideos === 0 && <p className="manual-warning">TikTok ส่งเฉพาะโพสต์ที่เป็นสาธารณะ คลิปที่ยังตั้งเป็น “เฉพาะฉัน” จะยังไม่ถูกนับ เปลี่ยนเป็นสาธารณะในแอป TikTok แล้วระบบจะดึงเองภายในชั่วโมง</p>}
    {view?.lastError && <p className="manual-warning">ดึงยอดครั้งล่าสุดไม่สำเร็จ ({view.lastError}) กดดึงใหม่ หรือกรอกยอดเองด้านล่าง</p>}
    {!view && <p className="manual-warning">ยังอ่านผลคลิปไม่ได้ตอนนี้ ลองรีเฟรชหน้าอีกครั้ง</p>}

    {report && report.series.length > 0 && <div className="learning-tables">
      <table className="learning-table"><caption>ซีรีส์ไหนคนชอบ</caption>
        <thead><tr><th>ซีรีส์</th><th>โพสต์</th><th>วิวเฉลี่ย</th><th>ติดตาม/1,000 วิว</th><th>คะแนน</th><th>ระบบจะ</th></tr></thead>
        <tbody>{report.series.map(g => <tr key={g.key}><td>{g.key}{g.discarded ? <small> · ทิ้ง {g.discarded}</small> : null}</td><td>{g.posted}</td>
          <td>{n(g.avgViews)}</td><td>{g.followsPer1k ?? "–"}</td><td>{g.posted ? g.score.toFixed(2) : "–"}</td><td>{verdict(g)}</td></tr>)}</tbody></table>
      <table className="learning-table"><caption>คำชวนติดตามแบบไหนได้ผล</caption>
        <thead><tr><th>คำชวน</th><th>โพสต์</th><th>ติดตาม/1,000 วิว</th><th>คะแนน</th><th>ระบบจะ</th></tr></thead>
        <tbody>{report.ctas.map(g => <tr key={g.key}><td>{ctaLabel[g.key] ?? g.key}</td><td>{g.posted}</td><td>{g.followsPer1k ?? "–"}</td>
          <td>{g.posted ? g.score.toFixed(2) : "–"}</td><td>{verdict(g)}</td></tr>)}</tbody></table>
      {report.guide.strictSeries.length > 0 && <p className="manual-muted">ซีรีส์ที่ถูกทิ้งบ่อย ({report.guide.strictSeries.join(", ")}) จะได้คำสั่งให้ Flow ขยับช้าลง เรียบขึ้น และรักษารูปทรงให้นิ่ง เพื่อให้ภาพเนียนขึ้น</p>}
      <p className="manual-muted">คะแนน 1.00 = คลิปปกติของช่องนี้ · ผู้ติดตามใหม่มีน้ำหนักมากที่สุด รองลงมาคือแชร์ คอมเมนต์ ไลก์ และวิว · ซีรีส์ที่มีผลน้อยกว่า 3 คลิปยังไม่ตัดสิน</p>
    </div>}

    <details className="library-today">
      <summary>ผลคลิปที่โพสต์แล้ว ({posted.length}) · แก้เองได้ถ้าต้องการ</summary>
      <p className="manual-muted">ไม่จำเป็นต้องกรอก ระบบดึงเอง ช่องนี้ไว้ใช้เมื่อยังไม่ได้กดอนุญาต หรืออยากใส่ “ผู้ติดตามใหม่” ตัวจริงจาก TikTok Studio แทนค่าประมาณ</p>
      {posted.length === 0 ? <p className="manual-muted">ยังไม่มีคลิปที่บันทึกว่าโพสต์แล้ว (กด “โพสต์แล้ว · ลบไฟล์” ในคลัง หรือโพสต์แบบส่วนตัวจากคลัง)</p>
        : <ol className="learning-posted">{posted.map(clip => {
          const s = view?.stats[clip.id];
          return <li key={clip.id}><div><strong>{clip.title}</strong>
            <small>{clip.postedAt ? bangkokTime(clip.postedAt) : ""}{s ? ` · ${s.source === "TIKTOK_API" ? "จาก TikTok" : "กรอกเอง"} ${bangkokTime(s.at)} · วิว ${n(s.views)} · ผู้ติดตาม ${s.follows === null ? "–" : `${s.followsEstimated ? "~" : ""}${n(s.follows)}`}` : " · ยังไม่มีผล"}</small></div>
            <form action={saveClipStatsAction} className="library-inline learning-form"><input type="hidden" name="id" value={clip.id} />{back}
              <label>วิว<input name="views" type="number" min={0} required defaultValue={s?.views ?? ""} /></label>
              <label>ไลก์<input name="likes" type="number" min={0} defaultValue={s?.likes ?? ""} /></label>
              <label>คอมเมนต์<input name="comments" type="number" min={0} defaultValue={s?.comments ?? ""} /></label>
              <label>แชร์<input name="shares" type="number" min={0} defaultValue={s?.shares ?? ""} /></label>
              <label>ผู้ติดตามใหม่<input name="follows" type="number" min={0} defaultValue={s && !s.followsEstimated ? s.follows ?? "" : ""} /></label>
              <button className="manual-secondary" type="submit">บันทึก</button></form></li>;
        })}</ol>}
    </details>
  </section>;
}
