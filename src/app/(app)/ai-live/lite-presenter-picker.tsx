"use client";

/* Thumbnails are browser Blob URLs read from the paired companion. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiteBackdrop, LitePhotoBuild, LitePresenterCatalog, LiteVoiceId, LocalLiveClient, LocalPresenterCard } from "@/features/ai-live/local-client";

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
        <span><strong>{pack.name}</strong><small>{pack.ownPhoto ? "รูปของฉัน" : "พิธีกร AI สังเคราะห์"}</small></span></label>)}
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

type Run = <T>(operation: (client: LocalLiveClient, signal: AbortSignal) => Promise<T>) => Promise<T>;
const POLL_MS = 15000;

/**
 * "สร้างพิธีกรจากรูปของฉัน": turn a photo the owner already saved (with likeness consent) in the
 * presenter library into a LIVE Lite presenter, built on the device. Lists only consented photos.
 */
export function LitePhotoPresenterBuilder({ run, voices, disabled = false, onReady }: {
  run: Run; voices: LitePresenterCatalog["voices"]; disabled?: boolean; onReady: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<LocalPresenterCard[] | null>(null);
  const [photoId, setPhotoId] = useState("");
  const [voice, setVoice] = useState<LiteVoiceId | "">("");
  const [builds, setBuilds] = useState<LitePhotoBuild[]>([]);
  const [backdrops, setBackdrops] = useState<{ backdrops: LiteBackdrop[]; matteReady: boolean } | null>(null);
  const [backdrop, setBackdrop] = useState("");
  const [backdropThumbs, setBackdropThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readyRef = useRef<Set<string> | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  const refreshBuilds = useCallback(async () => {
    const next = await run((client, signal) => client.litePhotoBuilds(signal));
    const ready = new Set(next.filter((build) => build.state === "READY").map((build) => build.buildId));
    if (readyRef.current && [...ready].some((id) => !readyRef.current?.has(id))) onReadyRef.current();
    readyRef.current = ready;
    setBuilds(next);
  }, [run]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    run((client, signal) => client.listPresenters(signal)).then((cards) => {
      if (cancelled) return;
      const usable = cards.filter((card) => card.hasReference && card.consentConfirmed);
      setPhotos(usable);
      setPhotoId((current) => current || usable[0]?.id || "");
    }).catch(() => { if (!cancelled) setPhotos([]); });
    const urls: string[] = [];
    run((client, signal) => client.liteBackdrops(signal)).then(async (found) => {
      if (cancelled) return;
      setBackdrops(found);
      setBackdrop((current) => current || found.backdrops[0]?.id || "");
      for (const item of found.backdrops) {
        const file = await run((client, signal) => client.liteBackdropThumbnail(item.id, signal)).catch(() => null);
        if (cancelled || !file) continue;
        const url = URL.createObjectURL(file);
        urls.push(url);
        setBackdropThumbs((current) => ({ ...current, [item.id]: url }));
      }
    }).catch(() => { if (!cancelled) setBackdrops({ backdrops: [], matteReady: false }); });
    void Promise.resolve().then(refreshBuilds).catch(() => undefined);
    return () => { cancelled = true; for (const url of urls) URL.revokeObjectURL(url); };
  }, [open, run, refreshBuilds]);

  const running = builds.some((build) => build.state === "RUNNING");
  useEffect(() => {
    if (!open || !running) return;
    const timer = window.setInterval(() => { refreshBuilds().catch(() => undefined); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, running, refreshBuilds]);

  const chosenVoice = voice || voices[0]?.id || "";
  // The person is always cut out of their photo and placed on a selling backdrop.
  const backdropReady = !!backdrops?.matteReady && !!backdrop;
  async function build() {
    if (!photoId || !chosenVoice || !backdropReady || busy) return;
    setBusy(true); setError(null);
    try {
      const started = await run((client, signal) => client.buildLitePresenterFromPhoto(photoId, chosenVoice, backdrop, signal));
      setBuilds((current) => [started, ...current.filter((item) => item.buildId !== started.buildId)]);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "เริ่มสร้างพิธีกรจากรูปไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  if (!open) {
    return <button type="button" className="ai-live-secondary live-lite-photo-open" disabled={disabled} onClick={() => setOpen(true)}>
      สร้างพิธีกรจากรูปของฉัน</button>;
  }
  return <section className="live-lite-photo" aria-label="สร้างพิธีกรจากรูปของฉัน">
    <strong>สร้างพิธีกรจากรูปของฉัน</strong>
    <small>ใช้รูปที่บันทึกไว้ใน “พรีเซนเตอร์ของฉัน” พร้อมยืนยันสิทธิ์ใช้ใบหน้าแล้ว ระบบจะตัดเฉพาะตัวคนออกมาวางหน้าฉากที่เลือก
      รูปหน้าตรง คนเดียว เห็นไหล่ ไม่มีของบังตัว จะได้ผลดีที่สุด
      ระบบสร้างบนเครื่องของคุณ ใช้เวลาประมาณ 10-20 นาที ไม่มีค่าใช้จ่าย</small>
    {photos === null ? <small>กำลังโหลดรูป...</small>
      : !photos.length ? <p className="ai-live-help">ยังไม่มีรูปที่ยืนยันสิทธิ์แล้ว เพิ่มรูปใน “พรีเซนเตอร์ของฉัน” ก่อน</p>
      : <>
        <label className="ai-live-field">รูป
          <select value={photoId} disabled={disabled || busy} onChange={(event) => setPhotoId(event.target.value)}>
            {photos.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>
        <label className="ai-live-field">เสียง
          <select value={chosenVoice} disabled={disabled || busy} onChange={(event) => {
            const chosen = voices.find((item) => item.id === event.target.value);
            if (chosen) setVoice(chosen.id);
          }}>{voices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <fieldset className="live-lite-presenter-cards live-lite-backdrops" disabled={disabled || busy}><legend>ฉากหลัง</legend>
          {backdrops === null ? <small>กำลังโหลดฉาก...</small>
            : !backdrops.matteReady ? <p className="ai-live-help">เครื่องนี้ยังไม่มีตัวแยกคนออกจากฉาก ติดตั้งตามคู่มือ docs/AI_LIVE_LITE_AUTO.md ก่อน</p>
            : !backdrops.backdrops.length ? <p className="ai-live-help">ยังไม่มีฉากหลังบนเครื่องนี้ (โกดัง ร้านค้า ชั้นวางของ)</p>
            : backdrops.backdrops.map((item) => <label key={item.id} className={backdrop === item.id ? "selected" : ""}>
              <input type="radio" name="lite-backdrop" value={item.id} checked={backdrop === item.id} onChange={() => setBackdrop(item.id)} />
              {backdropThumbs[item.id] ? <img src={backdropThumbs[item.id]} alt="" width={56} height={56} />
                : <span className="live-lite-presenter-avatar" aria-hidden="true">{item.name.slice(0, 1)}</span>}
              <span><strong>{item.name}</strong></span></label>)}
        </fieldset>
        <button type="button" className="primary-action" disabled={disabled || busy || running || !photoId || !chosenVoice || !backdropReady}
          onClick={() => void build()}>{busy ? "กำลังเริ่ม..." : running ? "กำลังสร้างอยู่..." : "สร้างพิธีกร"}</button>
      </>}
    {error && <p className="ai-live-error" role="alert">{error}</p>}
    {!!builds.length && <ul className="live-lite-photo-builds" aria-live="polite">
      {builds.slice(0, 3).map((item) => <li key={item.buildId} className={item.state.toLowerCase()}>
        <strong>{item.name}</strong>{" "}
        {item.state === "RUNNING" ? `กำลังสร้าง${item.progress !== null ? ` ${Math.round(item.progress * 100)}%` : "..."}`
          : item.state === "READY" ? "พร้อมใช้แล้ว เลือกได้ในรายการพิธีกรด้านบน" : item.message ?? "สร้างไม่สำเร็จ"}
      </li>)}</ul>}
    <button type="button" className="ai-live-secondary" onClick={() => setOpen(false)}>ปิด</button>
  </section>;
}
