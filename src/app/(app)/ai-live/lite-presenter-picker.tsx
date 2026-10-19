"use client";

/* Thumbnails are browser Blob URLs read from the paired companion. */
/* eslint-disable @next/next/no-img-element */

import type { LitePresenterCatalog, LiteVoiceId } from "@/features/ai-live/local-client";

const numbers = new Intl.NumberFormat("th-TH");

/** Speech key status only; the key is entered on the device, never on this page. */
export function LiteSpeechKeyStatus({ catalog }: { catalog: LitePresenterCatalog | null }) {
  if (!catalog) return null;
  if (catalog.speechKey.configured) {
    return <p className="live-lite-key ready" role="status">Azure Speech (Free F0): ตั้งค่าแล้ว
      {catalog.freeTier ? ` · ใช้ไป ${numbers.format(catalog.freeTier.usedThisMonth)} / ${numbers.format(catalog.freeTier.monthlyCapCharacters)} ตัวอักษรเดือนนี้` : ""}</p>;
  }
  return <div className="live-lite-key" role="status"><p>Azure Speech (Free F0): ยังไม่ได้ตั้งค่า</p>
    <ol>
      <li>สร้าง Azure Speech resource และเลือกแพ็กเกจ Free F0 (ไม่มีค่าใช้จ่าย)</li>
      <li>บนเครื่องนี้ เปิดโฟลเดอร์ส่วนเสริมแล้วรัน <code>python lite_speech_key.py set --region &lt;region&gt;</code> แล้ววางคีย์ในช่องที่ซ่อนตัวอักษร</li>
      <li>ดูขั้นตอนเพิ่มเติมในคู่มือ docs/AI_LIVE_LITE_AUTO.md</li>
    </ol>
    <small>ไม่ต้องกรอกคีย์ในหน้านี้ ระบบเก็บคีย์ไว้บนเครื่องของคุณเท่านั้น</small></div>;
}

/** LIVE Lite Auto: choose an installed fictional AI presenter ("หน้า") and a Thai voice ("เสียง"). */
export function LitePresenterPicker({ catalog, selected, voice, thumbnails, disabled = false, onSelect, onVoiceChange }: {
  catalog: LitePresenterCatalog | null; selected: string | null; voice: LiteVoiceId | null;
  thumbnails: Record<string, string>; disabled?: boolean;
  onSelect: (folder: string) => void; onVoiceChange: (voice: LiteVoiceId) => void;
}) {
  if (!catalog) {
    return <div className="ai-live-field"><span>พิธีกร AI</span>
      <small>เชื่อมต่อและอนุญาตเครื่องเพื่อดูพิธีกร AI ที่ติดตั้งไว้</small></div>;
  }
  return <div className="live-lite-presenter">
    <fieldset className="live-lite-presenter-cards" disabled={disabled}><legend>หน้า · พิธีกร AI</legend>
      {!catalog.presenters.length && <p className="ai-live-help">ยังไม่มีพิธีกร AI บนเครื่องนี้ ติดตั้งชุดพิธีกรในโฟลเดอร์ที่ตั้งค่าไว้ก่อน</p>}
      {catalog.presenters.map((pack) => <label key={pack.folder} className={selected === pack.folder ? "selected" : ""}>
        <input type="radio" name="lite-presenter" value={pack.folder} checked={selected === pack.folder} onChange={() => onSelect(pack.folder)} />
        {thumbnails[pack.folder] ? <img src={thumbnails[pack.folder]} alt="" width={56} height={56} />
          : <span className="live-lite-presenter-avatar" aria-hidden="true">{pack.name.slice(0, 1)}</span>}
        <span><strong>{pack.name}</strong><small>พิธีกร AI สังเคราะห์</small></span></label>)}
    </fieldset>
    {!!catalog.presenters.length && <label className="ai-live-field">เสียง
      <select value={voice ?? ""} disabled={disabled || !selected} onChange={(event) => {
        const chosen = catalog.voices.find((item) => item.id === event.target.value);
        if (chosen) onVoiceChange(chosen.id);
      }}>{catalog.voices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <small>เสียงภาษาไทยของ Azure Speech เลือกได้เฉพาะเสียงที่รองรับ</small></label>}
    <LiteSpeechKeyStatus catalog={catalog} />
  </div>;
}
