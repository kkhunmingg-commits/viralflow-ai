"use client";

/* The owner-selected reference stays a temporary local Blob URL. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { LocalPresenterCard, SaveLocalPresenter } from "@/features/ai-live/local-client";
import type { PresenterConsoleHandle } from "./presenter-console";
import { inspectPresenterReference, type PresenterReferenceCheck } from "./presenter-reference-check";

const steps = ["ภาพอ้างอิง", "ตรวจภาพ", "เสียง", "การเคลื่อนไหว", "ดูตัวอย่าง", "บันทึก"];
type Account = { id: string; label: string };

export function PresenterPreparationStatus() {
  return <div className="presenter-preparation-status" role="status"><strong>พร้อมบันทึกการตั้งค่า</strong>
    <p>ภาพและตัวเลือกจะเก็บไว้บนเครื่องของคุณ การพูดและการเคลื่อนไหวยังรอการประมวลผลบนเครื่องที่รองรับ</p>
    <span className="live-soft-badge">ยังไม่ยืนยันความพร้อม LIVE</span></div>;
}

export function PresenterWizard({ presenter, accounts, bridge, authorized, busy, onSave, onCancel }: {
  presenter: LocalPresenterCard | "new"; accounts: Account[];
  bridge: RefObject<PresenterConsoleHandle | null>; authorized: boolean; busy: boolean;
  onSave: (input: SaveLocalPresenter) => Promise<void>; onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(presenter === "new" ? "" : presenter.name);
  const [voice, setVoice] = useState(presenter === "new" ? "" : presenter.voiceLabel);
  const [assignments, setAssignments] = useState(presenter === "new" ? [] : presenter.assignedAccountIds);
  const [consent, setConsent] = useState(presenter === "new" ? false : presenter.consentConfirmed);
  const [reference, setReference] = useState<File | null>(null);
  const [check, setCheck] = useState<PresenterReferenceCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const current = ++latest.current;
    const timer = window.setTimeout(() => {
      const inspect = async () => {
        setCheck(null); setChecking(true); setError(null); setImageUrl(null);
        try {
          const file = reference ?? (presenter !== "new" && presenter.hasReference && authorized
            ? await bridge.current?.presenterReference(presenter.id) : null);
          if (!file) return;
          const result = await inspectPresenterReference(file);
          if (cancelled || current !== latest.current) return;
          url = URL.createObjectURL(file); setImageUrl(url); setCheck(result);
        } catch {
          if (!cancelled && current === latest.current) setError("ยังเปิดหรือตรวจภาพไม่ได้ กรุณาเลือกภาพที่อ่านได้แล้วลองอีกครั้ง");
        } finally { if (!cancelled && current === latest.current) setChecking(false); }
      };
      if (authorized) void inspect();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); latest.current += 1; if (url) URL.revokeObjectURL(url); };
  }, [reference, presenter, bridge, authorized]);

  const hasReference = !!reference || (presenter !== "new" && presenter.hasReference);
  const canContinue = authorized && !busy && !checking && (step === 0 ? !!name.trim() && hasReference && consent
    : step === 1 ? !!check : true);
  const canSave = authorized && !busy && !!name.trim() && hasReference && consent && !!check;
  return <form className="live-studio-form presenter-wizard" onSubmit={(event) => {
    event.preventDefault();
    if (step !== 5 || !canSave) return;
    void onSave({ ...(presenter === "new" ? {} : { id: presenter.id }), name: name.trim(), voiceLabel: voice.trim(),
      assignedAccountIds: assignments, consentConfirmed: consent, ...(reference ? { reference } : {}) });
  }}>
    <header className="live-section-heading"><div><p className="live-kicker">ขั้นที่ {step + 1} จาก 6</p><h3>{presenter === "new" ? "สร้างคน LIVE" : "แก้ไขคน LIVE"}</h3></div>
      <button type="button" className="ai-live-secondary" disabled={busy} onClick={onCancel}>ปิด</button></header>
    <ol className="presenter-wizard-steps" aria-label="เตรียมคน LIVE">{steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}
      className={index === step ? "current" : index < step && index !== 3 ? "visited" : ""}>
      <span aria-hidden="true">{index + 1}</span><span>{label}{index === 3 && <small>รอเครื่องที่รองรับ</small>}</span></li>)}</ol>
    <section className="presenter-wizard-body" aria-label={steps[step]}>
      {step === 0 && <><h4>เริ่มจากภาพที่คุณมีสิทธิ์ใช้</h4><div className="live-form-grid">
        <label className="ai-live-field">ชื่อคน LIVE<input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อที่คุณจำได้ง่าย" /></label>
        <label className="ai-live-field">ภาพอ้างอิง<input type="file" accept="image/jpeg,image/png" onChange={(event) => { setReference(event.target.files?.[0] ?? null); setConsent(false); }} /><small>JPEG หรือ PNG ขนาดไม่เกิน 4 MB{presenter !== "new" && " · คงภาพเดิมได้"}</small></label>
      </div><button type="button" className="ai-live-secondary" disabled>บันทึกภาพใหม่ · ยังไม่พร้อมใช้งาน</button>
        <label className="live-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />ฉันมีสิทธิ์ใช้ภาพและได้รับอนุญาตจากเจ้าของภาพ ไม่ใช้เพื่อแอบอ้างบุคคลอื่น</label></>}
      {step === 1 && <><h4>ตรวจไฟล์ภาพ</h4>{checking ? <p role="status">กำลังเปิดและตรวจภาพ...</p> : check ? <>
        <div className="presenter-image-check"><span aria-hidden="true">✓</span><div><strong>เปิดไฟล์ภาพได้</strong><p>{check.width} × {check.height} px</p></div></div>
        <p>{check.recommendation}</p><p className="live-empty-note">ขั้นนี้ตรวจว่าไฟล์อ่านได้และวัดขนาดภาพจริง ยังไม่ได้ตรวจความเหมือนใบหน้าหรือคุณภาพการขยับปาก</p></>
        : <p>เลือกภาพที่เปิดอ่านได้ก่อนดำเนินการต่อ</p>}</>}
      {step === 2 && <><h4>เตรียมตัวเลือกเสียง</h4><label className="ai-live-field">ชื่อเสียงที่ต้องการใช้<input maxLength={80} value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="เช่น เสียงสุภาพ" /></label>
        <p className="live-empty-note">บันทึกเป็นตัวเลือกของคุณ ยังไม่มีการสร้างเสียงหรือยืนยันว่าเสียงพร้อมใช้งาน</p></>}
      {step === 3 && <><h4>การเคลื่อนไหวและท่าทาง</h4><div className="presenter-preparation-status"><strong>รอการประมวลผลบนเครื่องที่รองรับ</strong>
        <p>คุณบันทึกภาพและตัวเลือกไว้ก่อนได้ ขั้นนี้ยังไม่ผ่านการเตรียมหรือทดสอบการเคลื่อนไหวจริง</p></div>
        <button type="button" className="ai-live-secondary" disabled>เตรียมการเคลื่อนไหว</button></>}
      {step === 4 && <><h4>ดูภาพอ้างอิง</h4><div className="presenter-wizard-preview">{imageUrl && authorized ? <img src={imageUrl} alt={`ภาพอ้างอิงของ ${name || "คน LIVE"}`} /> : <p>ยังไม่มีภาพที่เปิดอ่านได้</p>}</div>
        <p className="live-empty-note">ภาพอ้างอิง · ยังไม่ใช่ภาพ LIVE หรือผลทดสอบการพูด</p></>}
      {step === 5 && <><PresenterPreparationStatus /><dl className="live-room-metrics"><div><dt>ชื่อ</dt><dd>{name}</dd></div><div><dt>ตัวเลือกเสียง</dt><dd>{voice || "ยังไม่ได้เลือก"}</dd></div></dl>
        <fieldset className="live-assignment"><legend>ใช้กับบัญชี</legend>{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={assignments.includes(account.id)} onChange={(event) => setAssignments((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} />{account.label}</label>)}</fieldset></>}
      {error && <p className="ai-live-error" role="alert">{error}</p>}
    </section>
    <footer className="live-card-actions presenter-wizard-actions"><button type="button" disabled={busy || step === 0} onClick={() => setStep((current) => current - 1)}>ย้อนกลับ</button>
      {step < 5 ? <button type="button" className="primary-action" disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>{step === 3 ? "เก็บการตั้งค่าไว้ก่อน →" : "ถัดไป →"}</button>
        : <button type="submit" className="primary-action" disabled={!canSave}>{busy ? "กำลังบันทึก..." : "บันทึกคน LIVE"}</button>}</footer>
  </form>;
}
