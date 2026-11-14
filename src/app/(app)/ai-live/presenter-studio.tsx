import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { presenterStatusLabels, progressOf, TALK_LINES, totalCredits } from "@/features/ai-live/presenter-plan";
import { faceUrl, listPresenters, presentersAvailable, takeLabel } from "@/features/ai-live/presenter-service";
import { createPresenterAction, deletePresenterAction, retryPresenterAction } from "./actions";

/**
 * "สร้างพรีเซนเตอร์ AI": the owner names a presenter and the Google Flow accounts already linked for clips make it,
 * step by step (face → 12 talking takes → 2 idle takes). The finished takes are turned into the CPU lip-sync
 * presenter on the owner's computer.
 */
export async function PresenterStudio({ owner, accounts, message }: { owner: string; accounts: Array<{ id: string; label: string }>; message?: string }) {
  const client = await createClient();
  const [available, presenters] = await Promise.all([presentersAvailable(client), listPresenters(client, owner)]);
  const admin = createAdminClient();
  const faces = await Promise.all(presenters.map(p => faceUrl(admin, p).catch(() => null)));
  const busy = presenters.some(p => p.status === "FACE" || p.status === "CLIPS");

  return <section id="presenter-studio" className="ai-live-panel presenter-studio" aria-label="สร้างพรีเซนเตอร์ AI">
    <div className="ai-live-panel-title">
      <div><h2>สร้างพรีเซนเตอร์ AI อัตโนมัติ</h2>
        <p className="ai-live-context-note">ใช้บัญชี Google ที่เชื่อมไว้ในระบบคลิป สร้างหน้า 1 คลิป → คลิปพูด {TALK_LINES.length} คลิป → คลิปนิ่ง 2 คลิป ทุกคลิปเริ่มจากหน้าเดียวกัน จึงเป็นคนเดิมทุกคลิป</p></div>
      <span className="phase-chip">ประมาณ {totalCredits()} เครดิต</span>
    </div>
    {message && <p className="library-message" role="status">{message.slice(0, 300)}</p>}
    {!available && <p className="ai-live-warning" role="status">ฐานข้อมูลยังไม่ได้เพิ่มตารางพรีเซนเตอร์</p>}

    <form action={createPresenterAction} className="presenter-form">
      <div className="ai-live-context-grid">
        <label className="ai-live-field">ชื่อพรีเซนเตอร์
          <input name="name" required maxLength={60} placeholder="เช่น น้องมายด์" />
        </label>
        <label className="ai-live-field">บัญชี TikTok (ใช้ผูกคิวคลิป)
          <select name="tiktokAccountId" required defaultValue={accounts[0]?.id ?? ""}>
            {accounts.length ? accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>) : <option value="">ยังไม่มีบัญชีที่เชื่อมต่อ</option>}
          </select>
        </label>
      </div>
      <label className="ai-live-field">ลักษณะหน้าตา (ภาษาอังกฤษ ไม่ใส่ก็ได้)
        <input name="look" maxLength={300} placeholder="a friendly Thai woman, about 27, long black hair, white blouse" />
        <small>ไม่ใส่ = ผู้หญิงไทยอายุประมาณ 27 ปี แต่งตัวสุภาพ ห้ามใส่ชื่อหรือหน้าตาของคนจริง</small>
      </label>
      <label className="presenter-check"><input type="checkbox" name="credits" required /> ยืนยันใช้เครดิต Flow ประมาณ {totalCredits()} เครดิต (15 คลิป × 10)</label>
      <div className="ai-live-actions">
        <button className="primary-action" type="submit" disabled={!available || !accounts.length || busy}>{busy ? "กำลังสร้างพรีเซนเตอร์อยู่" : "สร้างพรีเซนเตอร์"}</button>
      </div>
    </form>

    {presenters.length > 0 && <ul className="presenter-list">
      {presenters.map((p, i) => {
        const progress = progressOf(p.takes);
        const waiting = p.takes.filter(t => t.status === "QUEUED").map(takeLabel);
        return <li key={p.id} className={`presenter-item status-${p.status.toLowerCase()}`}>
          <div className="presenter-face">{faces[i] ? <img src={faces[i]!} alt={`หน้าของ ${p.name}`} /> : <span>รอหน้า</span>}</div>
          <div className="presenter-body">
            <strong>{p.name}</strong>
            <span className="phase-chip">{presenterStatusLabels[p.status]}</span>
            <progress max={progress.total} value={progress.done} aria-label="ความคืบหน้า" />
            <small>เสร็จ {progress.done}/{progress.total} คลิป{waiting.length ? ` · กำลังรอ: ${waiting.slice(0, 4).join(", ")}${waiting.length > 4 ? " …" : ""}` : ""}</small>
            {p.error && <small className="ai-live-error">{p.error}</small>}
            {p.status === "READY" && <small>พร้อมแล้ว เปิดโปรแกรม AI LIVE ในเครื่อง แล้วสั่ง <code>python -m loop_presenter.from_portal {p.id}</code> เพื่อทำเป็นพรีเซนเตอร์ไลฟ์</small>}
            <div className="presenter-actions">
              {p.status === "FAILED" && <form action={retryPresenterAction}><input type="hidden" name="id" value={p.id} /><button className="secondary-action" type="submit">สร้างต่อ</button></form>}
              <form action={deletePresenterAction}><input type="hidden" name="id" value={p.id} /><button className="danger-action" type="submit">ลบ</button></form>
            </div>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
