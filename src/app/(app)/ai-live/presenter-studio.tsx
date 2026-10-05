"use client";

/* References are authenticated local files displayed through temporary Blob URLs. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { LocalPresenterCard } from "@/features/ai-live/local-client";
import type { PresenterConsoleHandle } from "./presenter-console";

type Account = { id: string; label: string };
function PresenterThumbnail({ bridge, presenter, authorized, enabled }: {
  bridge: RefObject<PresenterConsoleHandle | null>; presenter: LocalPresenterCard; authorized: boolean; enabled: boolean;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    if (!authorized || !enabled || !presenter.hasReference) return;
    const controller = new AbortController();
    let cancelled = false; let url: string | null = null; let started = false;
    const load = async () => {
      if (started || !bridge.current) return;
      started = true;
      try {
        const file = await bridge.current.presenterThumbnail(presenter.id, controller.signal);
        if (cancelled) return;
        url = URL.createObjectURL(file); setImage(url);
      } catch { /* The reference can still be retried explicitly with Preview. */ }
    };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); void load(); }
    }, { rootMargin: "100px" }) : null;
    if (observer && container.current) observer.observe(container.current); else void load();
    return () => { cancelled = true; controller.abort(); observer?.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [authorized, enabled, bridge, presenter.id, presenter.hasReference, presenter.updatedAt]);
  return <div ref={container} className="live-presenter-portrait">{image && authorized && enabled
    ? <img src={image} alt={`ภาพของ ${presenter.name}`} /> : <span aria-hidden="true">{presenter.name.slice(0, 1)}</span>}</div>;
}
export function PresenterStudio({ bridge, authorized, passiveImagesEnabled = false, accounts, onUse, onChanged }: {
  bridge: RefObject<PresenterConsoleHandle | null>; authorized: boolean; accounts: Account[];
  passiveImagesEnabled?: boolean;
  onUse: (presenter: LocalPresenterCard, reference: File) => void;
  onChanged?: (presenters: LocalPresenterCard[]) => void;
}) {
  const [presenters, setPresenters] = useState<LocalPresenterCard[]>([]);
  const [editing, setEditing] = useState<LocalPresenterCard | "new" | null>(null);
  const [name, setName] = useState("");
  const [voice, setVoice] = useState("");
  const [assignments, setAssignments] = useState<string[]>([]);
  const [reference, setReference] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const generation = useRef(0);
  const previewUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    const current = generation.current;
    if (!authorized || !bridge.current) return;
    try {
      const result = await bridge.current.listPresenters();
      if (generation.current !== current) return;
      setPresenters(result); onChanged?.(result);
    } catch { if (generation.current === current) setMessage("ยังโหลดคน LIVE ไม่สำเร็จ ตรวจสอบการเชื่อมต่อเครื่องแล้วลองอีกครั้ง"); }
  }, [authorized, bridge, onChanged]);

  useEffect(() => {
    generation.current += 1;
    const timer = authorized ? window.setTimeout(() => { void load(); }, 0) : null;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      generation.current += 1;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    };
  }, [authorized, load]);

  function beginEdit(presenter: LocalPresenterCard | "new") {
    setEditing(presenter); setName(presenter === "new" ? "" : presenter.name);
    setVoice(presenter === "new" ? "" : presenter.voiceLabel ?? "");
    setAssignments(presenter === "new" ? [] : presenter.assignedAccountIds);
    setReference(null); setConsent(presenter === "new" ? false : presenter.consentConfirmed); setMessage(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !bridge.current || busy || !authorized) return;
    if (!name.trim() || (editing === "new" && !reference) || (reference && !consent)) {
      setMessage("ใส่ชื่อ เลือกภาพ และยืนยันสิทธิ์ใช้ภาพก่อนบันทึก"); return;
    }
    const current = generation.current;
    setBusy(true); setMessage(null);
    try {
      await bridge.current.savePresenter({ ...(editing !== "new" ? { id: editing.id } : {}), name: name.trim(),
        voiceLabel: voice.trim(), assignedAccountIds: assignments, consentConfirmed: consent,
        ...(reference ? { reference } : {}) });
      if (generation.current !== current) return;
      setEditing(null); await load();
      if (generation.current === current) setMessage("บันทึกคน LIVE แล้ว");
    } catch { if (generation.current === current) setMessage("ยังบันทึกไม่สำเร็จ กรุณาตรวจสอบภาพและการเชื่อมต่อเครื่อง"); }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function openPreview(presenter: LocalPresenterCard, use = false) {
    if (!bridge.current || busy || !authorized || !presenter.hasReference) return;
    const current = generation.current;
    setBusy(true); setMessage(null);
    try {
      const file = await bridge.current.presenterReference(presenter.id);
      if (generation.current !== current) return;
      if (use) onUse(presenter, file);
      else {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        const url = URL.createObjectURL(file); previewUrl.current = url;
        setPreview({ name: presenter.name, url });
      }
    } catch { if (generation.current === current) setMessage("ยังเปิดภาพไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อเครื่อง"); }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function remove(presenter: LocalPresenterCard) {
    if (!bridge.current || busy || !authorized || !window.confirm(`ลบคน LIVE “${presenter.name}” หรือไม่? ประวัติการ LIVE จะยังอยู่`)) return;
    const current = generation.current;
    setBusy(true); setMessage(null);
    try { await bridge.current.deletePresenter(presenter.id);
      if (generation.current !== current) return;
      await load(); if (generation.current === current) setMessage("ลบคน LIVE แล้ว"); }
    catch { if (generation.current === current) setMessage("ยังลบไม่ได้ กรุณาหยุดห้องที่ใช้คน LIVE นี้ก่อนแล้วลองอีกครั้ง"); }
    finally { if (generation.current === current) setBusy(false); }
  }

  return <section className="live-studio" aria-labelledby="live-studio-title">
    <header className="live-section-heading"><div><p className="live-kicker">สำหรับห้องของคุณ</p><h2 id="live-studio-title">คน LIVE</h2></div>
      <button type="button" className="ai-live-secondary" disabled={!authorized || busy} onClick={() => beginEdit("new")}>+ เพิ่มคน LIVE</button></header>
    {!authorized && <p className="live-empty-note">เชื่อมต่อและอนุญาตส่วนเสริมบนเครื่องเพื่อจัดการคน LIVE ของคุณ</p>}
    {authorized && !presenters.length && <p className="live-empty-note">ยังไม่มีคน LIVE เพิ่มภาพที่คุณมีสิทธิ์ใช้งานเพื่อเตรียมห้องแรก</p>}
    {message && <p className="ai-live-notice" role="status">{message}</p>}
    <div className="live-presenter-grid">
      {authorized && presenters.map((presenter) => <article className="live-presenter-card" key={presenter.id}>
        <PresenterThumbnail bridge={bridge} presenter={presenter} authorized={authorized} enabled={passiveImagesEnabled} />
        <div className="live-presenter-info"><h3>{presenter.name}</h3><span className="live-soft-badge">{presenter.status === "READY" ? "ตั้งค่าแล้ว" : "ต้องตั้งค่า"}</span>
          <p>เสียง: {presenter.voiceLabel || "ยังไม่ได้เลือก"}</p>
          <p>{presenter.assignedAccountIds.map((id) => accounts.find((account) => account.id === id)?.label).filter(Boolean).join(" · ") || "ยังไม่ได้กำหนดบัญชี"}</p></div>
        <div className="live-card-actions"><button type="button" disabled={busy || !authorized || !presenter.hasReference} onClick={() => void openPreview(presenter)}>ดูภาพ</button>
          <button type="button" disabled={busy || !authorized} onClick={() => beginEdit(presenter)}>แก้ไข</button>
          <button type="button" disabled={busy || !authorized || !presenter.hasReference} onClick={() => void openPreview(presenter, true)}>ใช้ในห้องนี้</button>
          <button type="button" className="live-text-danger" disabled={busy || !authorized} onClick={() => void remove(presenter)}>ลบ</button></div>
      </article>)}
    </div>
    {editing && authorized && <form className="live-studio-form" onSubmit={(event) => void save(event)}>
      <h3>{editing === "new" ? "เพิ่มคน LIVE" : "แก้ไขคน LIVE"}</h3>
      <div className="live-form-grid"><label className="ai-live-field">ชื่อ<input maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="ai-live-field">ชื่อเสียงที่ต้องการใช้<input maxLength={80} value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="เช่น เสียงสุภาพ" /><small>บันทึกเป็นตัวเลือกของคุณ ยังไม่ยืนยันว่าเสียงพร้อมใช้งาน</small></label>
        <label className="ai-live-field">ภาพอ้างอิง<input type="file" accept="image/jpeg,image/png" onChange={(event) => { setReference(event.target.files?.[0] ?? null); setConsent(false); }} required={editing === "new"} /><small>JPEG หรือ PNG ขนาดไม่เกิน 4 MB</small></label></div>
      <fieldset className="live-assignment"><legend>ใช้กับบัญชี</legend>{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={assignments.includes(account.id)} onChange={(event) => setAssignments((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))} />{account.label}</label>)}</fieldset>
      <label className="live-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />ฉันมีสิทธิ์ใช้ภาพและได้รับอนุญาตจากเจ้าของภาพ ไม่ใช้เพื่อแอบอ้างบุคคลอื่น</label>
      <div className="live-card-actions"><button type="submit" className="primary-action" disabled={busy || !authorized}>{busy ? "กำลังบันทึก..." : "บันทึก"}</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</button></div>
    </form>}
    {preview && authorized && <div className="live-reference-preview"><div className="live-section-heading"><h3>{preview.name}</h3><button type="button" className="ai-live-secondary" onClick={() => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = null; setPreview(null); }}>ปิดภาพ</button></div>
      <img src={preview.url} alt={`ภาพอ้างอิงของ ${preview.name}`} /><p>ภาพอ้างอิง · ยังไม่ใช่ภาพ LIVE</p></div>}
  </section>;
}
