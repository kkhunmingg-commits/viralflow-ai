import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { remainingCapacity, type FlowAccountView } from "@/features/flow-farm/capacity";
import { flowLogins, listFlowAccounts, shareFlowAccounts, workerLastSeen } from "@/features/flow-farm/service";
import { CREDITS_PER_TAKE, IDLE_TAKES, presenterStatusLabels, progressOf, TALK_LINES, takesLeft, totalCredits, type PresenterTake } from "@/features/ai-live/presenter-plan";
import { faceUrl, listPresenters, presentersAvailable, takeLabel, type PresenterRow } from "@/features/ai-live/presenter-service";
import { createPresenterAction, deletePresenterAction, retryPresenterAction } from "./actions";

/**
 * "สร้างพรีเซนเตอร์ AI": the owner names a presenter and every Google Flow account in the shared clip pool makes it,
 * step by step (face → 12 talking takes → 2 idle takes). Each take is checked by the server before it is kept.
 */
const TOTAL_TAKES = 1 + TALK_LINES.length + IDLE_TAKES;

function googleState(f: FlowAccountView) {
  if (!f.active) return { tone: "wait", text: "พักไว้" };
  if (f.loginState !== "READY") return { tone: "wait", text: f.loginState === "FAILED" ? "ล็อกอินไม่สำเร็จ" : "รอล็อกอิน" };
  if (f.exhaustedToday || f.remainingEstimate === 0) return { tone: "empty", text: `เครดิตหมดวันนี้ (ใช้ ${f.clipsToday})` };
  return { tone: "ok", text: `เหลือ ~${f.remainingEstimate} คลิป` };
}
function takeTone(t: PresenterTake) {
  if (t.status === "DONE") return "pass";
  if (t.error?.startsWith("ตรวจไม่ผ่าน")) return "reject";
  if (t.status === "QUEUED") return "busy";
  return "todo";
}
function takeTitle(t: PresenterTake) {
  const what = t.line ? `${takeLabel(t)}: ${t.line}` : takeLabel(t);
  if (t.status === "DONE") return `${what} · ตรวจผ่าน (${t.check ?? "ok"})`;
  if (t.error) return `${what} · ${t.error} · กำลังสร้างใหม่`;
  return `${what} · ${t.status === "QUEUED" ? "กำลังสร้าง" : "รอคิว"}`;
}
/** The Flow worker polls every minute: seen in the last 3 minutes means it is running. */
function workerOnline(lastSeen: string | null) { return lastSeen !== null && Date.now() - Date.parse(lastSeen) < 3 * 60_000; }
const takeShort = (t: PresenterTake) => t.role === "FACE" ? "หน้า" : t.role === "TALK" ? `พ${t.key.split("-")[1]}` : `น${t.key.split("-")[1]}`;

export async function PresenterStudio({ owner, hasTikTok, message }: { owner: string; hasTikTok: boolean; message?: string }) {
  const client = await createClient();
  const admin = createAdminClient();
  await shareFlowAccounts(admin, owner).catch(() => {});
  const logins = await flowLogins(admin, owner).catch(() => ({}));
  const [available, presenters, google, lastSeen] = await Promise.all([
    presentersAvailable(client), listPresenters(client, owner),
    listFlowAccounts(client, owner, new Date(), logins).catch(() => [] as FlowAccountView[]), workerLastSeen(client, owner).catch(() => null),
  ]);
  const faces = await Promise.all(presenters.map(p => faceUrl(admin, p).catch(() => null)));
  const active = presenters.find(p => p.status === "FACE" || p.status === "CLIPS");
  const capacity = remainingCapacity(google);
  const needed = active ? takesLeft(active.takes) : TOTAL_TAKES;
  const online = workerOnline(lastSeen);
  const readyAccounts = google.filter(f => f.active && f.loginState === "READY").length;

  return <section id="presenter-studio" className="ai-live-panel pstudio" aria-label="สร้างพรีเซนเตอร์ AI">
    <header className="pstudio-head">
      <div>
        <p className="eyebrow">โหมดออโต้เจน</p>
        <h2>สร้างพรีเซนเตอร์ AI</h2>
        <p className="ai-live-context-note">ใช้บัญชี Google ทุกบัญชีในระบบคลิปร่วมกัน ทุกคลิปเริ่มจากหน้าเดียวกันจึงเป็นคนเดิม และระบบตรวจทุกคลิปก่อนเก็บ</p>
      </div>
      <span className={`pstudio-worker ${online ? "on" : "off"}`}>{online ? "● เครื่องสร้างคลิปออนไลน์" : "○ เครื่องสร้างคลิปออฟไลน์"}</span>
    </header>

    <ol className="pstudio-steps" aria-label="ขั้นตอน">
      <li><b>1</b><span>หน้าพรีเซนเตอร์</span><small>1 คลิป</small></li>
      <li><b>2</b><span>คลิปพูดภาษาไทย</span><small>{TALK_LINES.length} คลิป</small></li>
      <li><b>3</b><span>คลิปนิ่ง (ลูปตัว)</span><small>{IDLE_TAKES} คลิป</small></li>
      <li><b>✓</b><span>ตรวจทุกคลิป</span><small>ไม่ผ่าน = สร้างใหม่</small></li>
    </ol>

    {message && <p className="library-message" role="status">{message.slice(0, 300)}</p>}
    {!available && <p className="ai-live-warning" role="status">ฐานข้อมูลยังไม่ได้เพิ่มตารางพรีเซนเตอร์</p>}

    <div className="pstudio-grid">
      <form action={createPresenterAction} className="pstudio-card pstudio-form">
        <h3>พรีเซนเตอร์ใหม่</h3>
        <label className="ai-live-field">ชื่อพรีเซนเตอร์
          <input name="name" required maxLength={60} placeholder="เช่น น้องมายด์" />
        </label>
        <label className="ai-live-field">ลักษณะหน้าตา <span className="pstudio-optional">ไม่ใส่ก็ได้ · ภาษาอังกฤษ</span>
          <input name="look" maxLength={300} placeholder="a friendly Thai woman, about 27, long black hair, white blouse" />
          <small>ไม่ใส่ = ผู้หญิงไทยอายุประมาณ 27 ปี แต่งตัวสุภาพ ห้ามใส่ชื่อหรือหน้าตาของคนจริง</small>
        </label>
        <label className="pstudio-check"><input type="checkbox" name="credits" required />
          <span>ใช้เครดิต Flow ประมาณ <b>{totalCredits()}</b> เครดิต ({TOTAL_TAKES} คลิป × {CREDITS_PER_TAKE})</span></label>
        <button className="primary-action" type="submit" disabled={!available || !hasTikTok || !!active || !readyAccounts}>
          {active ? "กำลังสร้างอยู่ 1 คน" : "สร้างพรีเซนเตอร์"}</button>
        {!hasTikTok && <small className="ai-live-error">ต้องเชื่อมบัญชี TikTok อย่างน้อย 1 บัญชีก่อน</small>}
        {!readyAccounts && <small className="ai-live-error">ยังไม่มีบัญชี Google ที่ล็อกอินพร้อม ไปผูกที่หน้าคลิปก่อน</small>}
      </form>

      <div className="pstudio-card">
        <div className="pstudio-card-title"><h3>บัญชี Google ที่ใช้ร่วมกัน</h3>
          <span className={`pstudio-pill ${capacity >= needed ? "ok" : "warn"}`}>เหลือ ~{capacity} · ต้องใช้ {needed}</span></div>
        {google.length ? <ol className="pstudio-google">{google.map((f, i) => {
          const state = googleState(f);
          return <li key={f.id} className={state.tone}><span>{i + 1}. {f.label}</span><span>{state.text}</span></li>;
        })}</ol> : <p className="ai-live-context-note">ยังไม่ได้ผูกบัญชี Google ผูกได้ที่หน้าคลิป</p>}
        <small className="ai-live-context-note">ระบบใช้บัญชีบนสุดจนเครดิตหมดแล้วย้ายบัญชีถัดไปเอง{capacity < needed ? " · เครดิตวันนี้อาจไม่พอ ที่เหลือจะสร้างต่อพรุ่งนี้อัตโนมัติ" : ""}</small>
      </div>
    </div>

    {presenters.length > 0 && <ul className="pstudio-list">
      {presenters.map((p, i) => <PresenterCard key={p.id} presenter={p} face={faces[i]} />)}
    </ul>}
  </section>;
}

function PresenterCard({ presenter: p, face }: { presenter: PresenterRow; face: string | null }) {
  const progress = progressOf(p.takes);
  const percent = Math.round(progress.done / Math.max(1, progress.total) * 100);
  return <li className={`pstudio-card pstudio-item status-${p.status.toLowerCase()}`}>
    <div className="pstudio-face">{face ? <img src={face} alt={`หน้าของ ${p.name}`} /> : <span>รอหน้า</span>}</div>
    <div className="pstudio-body">
      <div className="pstudio-card-title"><h3>{p.name}</h3><span className={`pstudio-pill s-${p.status.toLowerCase()}`}>{presenterStatusLabels[p.status]}</span></div>
      <div className="pstudio-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
      <p className="pstudio-summary">
        <span className="pass">ตรวจผ่าน {progress.done}/{progress.total}</span>
        {progress.rejected > 0 && <span className="reject">ไม่ผ่าน กำลังสร้างใหม่ {progress.rejected}</span>}
      </p>
      <ul className="pstudio-takes" aria-label="ผลตรวจแต่ละคลิป">
        {p.takes.map(t => <li key={t.key} className={takeTone(t)} title={takeTitle(t)}>{takeShort(t)}</li>)}
      </ul>
      <p className="pstudio-legend"><i className="pass" />ผ่าน <i className="busy" />กำลังสร้าง <i className="reject" />ไม่ผ่าน <i className="todo" />รอคิว</p>
      {p.status !== "FAILED" && p.takes.filter(t => t.status !== "DONE" && t.error).slice(0, 3).map(t =>
        <small key={t.key} className="pstudio-retry">{takeLabel(t)} · ครั้งที่ {t.attempts}/3 · {t.error}</small>)}
      {p.error && <small className="ai-live-error">{p.error}</small>}
      {p.status === "READY" && <div className="pstudio-ready">ผ่านครบ {progress.total} คลิป พร้อมทำเป็นพรีเซนเตอร์ไลฟ์ ในโฟลเดอร์ ai-live-cpu สั่ง
        <code>python -m loop_presenter.from_portal {p.id}</code></div>}
      <div className="presenter-actions">
        {p.status === "FAILED" && <form action={retryPresenterAction}><input type="hidden" name="id" value={p.id} /><button className="secondary-action" type="submit">สร้างต่อ</button></form>}
        <form action={deletePresenterAction}><input type="hidden" name="id" value={p.id} /><button className="danger-action" type="submit">ลบ</button></form>
      </div>
    </div>
  </li>;
}
