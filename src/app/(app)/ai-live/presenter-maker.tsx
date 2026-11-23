"use client";

/* Faces and photos are short signed Storage links, not files Next can optimise. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BACKGROUNDS, PRAEW_ID, QUALITIES, QUALITY_INFO, VOICES, autoBackground, backgroundLabel, defaultVoice, presenterStatus, resolveBackground,
  type BackgroundId, type BgChoice, type Gender, type JobReport, type Presenter, type Quality, type StudioReport, type VoiceId,
} from "@/features/presenter-studio/contract";

type Item = Presenter & { job: JobReport | null; pictures: { photo: string | null; face: string | null; voice: string | null; candidates: (string | null)[]; shop: string | null } };
type Previews = Partial<Record<BackgroundId, string>>;
type View = { presenters: Item[]; active: string; report: StudioReport | null; online: boolean; backgrounds?: Previews };
type Tone = "low" | "normal" | "high";

const STYLE_PRESETS = ["สุภาพ อบอุ่น เป็นกันเอง", "สนุก ร่าเริง ชวนคุยเก่ง", "มืออาชีพ น่าเชื่อถือ อธิบายสินค้าชัด", "ใจดี พูดช้า ฟังสบาย"];
const LOOK_PRESETS: Record<Gender, string[]> = {
  male: ["a friendly Thai man, about 30, short black hair, clean shaven, white polo shirt", "a smart Thai man, about 35, neat short hair, light blue shirt, warm smile"],
  female: ["a friendly Thai woman, about 27, long black hair, white blouse", "a cheerful Thai woman, about 25, shoulder-length brown hair, pastel top"],
};
const TONE_LABEL: Record<Tone, string> = { low: "ทุ้มลง", normal: "ปกติ", high: "สูงขึ้น" };
const voiceLabel = (id: string) => VOICES.find(v => v.id === id)?.label ?? id;

/** Downscales a phone photo to at most 1600 px (JPEG), keeping the face detail the PC needs. */
async function toJpeg(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob(b => b ? ok(b) : bad(new Error("encode")), "image/jpeg", 0.92));
  return { blob, w: bitmap.width, h: bitmap.height };
}

/** Uploads one picture (face or shop photo) straight to the owner's private storage; returns its path. */
async function uploadPicture(file: File) {
  const { blob, w, h } = await toJpeg(file);
  const ticket = await post({ action: "uploadUrl", type: "image/jpeg" }) as { path: string; token: string };
  const sent = await createClient().storage.from("video-assets").uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: "image/jpeg" });
  if (sent.error) throw sent.error;
  return { path: ticket.path, preview: URL.createObjectURL(blob), w, h };
}

async function post(body: unknown) {
  const r = await fetch("/api/presenter-studio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({})) as { message?: string } & Record<string, unknown>;
  if (!r.ok) throw new Error(data.message ?? "ทำรายการไม่สำเร็จ");
  return data;
}

export function PresenterMaker() {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4500); };

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/presenter-studio", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setView(await r.json() as View); setLoadError(false);
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => {
    let stop = false, t: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => { if (!document.hidden) await refresh(); if (!stop) t = setTimeout(loop, 8000); };
    void loop();
    return () => { stop = true; if (t) clearTimeout(t); };
  }, [refresh]);

  const act = async (key: string, body: unknown, done: string) => {
    setBusy(key);
    try { await post(body); say(done); await refresh(); } catch (e) { say(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ"); } finally { setBusy(null); }
  };

  const online = view?.online ?? false;
  const report = view?.report ?? null;
  const liveActive = report?.active ?? PRAEW_ID;
  const building = view?.presenters.some(p => { const s = p.job?.state; return s === "building" || s === "faces"; }) ?? false;

  return <section id="presenter-maker" className="praew-card pmk" aria-label="พรีเซนเตอร์ของฉัน">
    <header className="pmk-head">
      <div>
        <p className="eyebrow">PRESENTER STUDIO</p>
        <h3>พรีเซนเตอร์ของฉัน</h3>
        <p className="praew-note">สร้างพรีเซนเตอร์คนใหม่ได้เองจากหน้านี้ ระบบทำหน้า ท่าทาง และปากขยับให้อัตโนมัติบนคอมของคุณ ฟรี ไม่ใช้เครดิต</p>
      </div>
      <span className={`pmk-pc ${online ? "on" : "off"}`}>
        {online ? (report?.liveRunning ? "● คอมออนไลน์ · ไลฟ์อยู่ (งานสร้างรอปิดไลฟ์)" : building ? "● คอมกำลังสร้าง" : "● คอมพร้อมสร้าง") : "○ คอมออฟไลน์ · งานจะเริ่มเมื่อเปิดคอม"}
      </span>
    </header>
    {loadError && !view && <p className="praew-empty">โหลดรายการพรีเซนเตอร์ไม่ได้ ลองรีเฟรชหน้า</p>}
    {toast && <p className="pmk-toast" role="status">{toast}</p>}

    <ul className="pmk-list">
      <li className={`pmk-item${liveActive === PRAEW_ID ? " live" : ""}`}>
        <div className="pmk-face"><span>แพรว</span></div>
        <div className="pmk-body">
          <div className="pmk-title"><b>แพรว</b><small>ตัวหลัก · เสียง 6</small></div>
          <span className="pmk-pill ok">พร้อมใช้</span>
          <div className="pmk-actions">
            {liveActive === PRAEW_ID ? <span className="pmk-live">กำลังใช้ในไลฟ์</span>
              : view?.active === PRAEW_ID ? <span className="pmk-live wait">จะใช้เมื่อปิดไลฟ์</span>
                : <button type="button" className="pmk-btn" disabled={busy !== null} onClick={() => act("activate", { action: "activate", id: PRAEW_ID }, "ตั้งแพรวเป็นพรีเซนเตอร์ไลฟ์แล้ว")}>ใช้ในไลฟ์</button>}
          </div>
        </div>
      </li>
      {view?.presenters.map(p => <PresenterRow key={p.id} p={p} previews={view.backgrounds ?? {}} online={online} live={liveActive === p.id} wanted={view.active === p.id}
        busy={busy} liveRunning={!!report?.liveRunning} act={act} />)}
    </ul>

    {!open && <button type="button" className="pmk-new" onClick={() => setOpen(true)}>＋ สร้างพรีเซนเตอร์ใหม่</button>}
    {open && <Wizard faceGenerator={!!report?.faceGenerator} previews={view?.backgrounds ?? {}} onClose={() => setOpen(false)}
      onCreated={async name => { setOpen(false); say(`เข้าคิวสร้าง “${name}” แล้ว ดูความคืบหน้าได้ที่การ์ดด้านบน`); await refresh(); }} />}
  </section>;
}

function PresenterRow({ p, previews, online, live, wanted, busy, liveRunning, act }: {
  p: Item; previews: Previews; online: boolean; live: boolean; wanted: boolean; busy: string | null; liveRunning: boolean;
  act: (key: string, body: unknown, done: string) => Promise<void>;
}) {
  const status = presenterStatus(p, p.job ?? undefined, online);
  const face = p.pictures.face ?? p.pictures.photo;
  const pct = Math.round(p.job?.percent ?? 0);
  const busyHere = busy?.endsWith(p.id) ?? false;
  const picking = p.job?.state === "pick_face" && p.source.kind === "generate" && p.source.pick === undefined;
  const [scene, setScene] = useState<{ bg: BgChoice; shop: { path: string; preview: string } | null } | null>(null);
  const sceneNow = resolveBackground(p);
  return <li className={`pmk-item${live ? " live" : ""}`}>
    <div className="pmk-face">{face ? <img src={face} alt={`หน้าของ ${p.name}`} /> : <span>{p.name.slice(0, 4)}</span>}</div>
    <div className="pmk-body">
      <div className="pmk-title"><b>{p.name}</b><small>{p.gender === "male" ? "ชาย" : "หญิง"} · {voiceLabel(p.voice)}{p.tone !== "normal" ? ` (${TONE_LABEL[p.tone]})` : ""} · ฉาก{backgroundLabel(sceneNow)}</small></div>
      <span className={`pmk-pill ${status.tone}`}>{status.label}</span>
      {(status.tone === "busy" || p.job?.state === "ready_quick") && <div className="pmk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${Math.max(3, pct)}%` }} /></div>}
      {p.job?.message && <small className="pmk-msg">{p.job.message}{p.job.etaMin ? ` · เหลือประมาณ ${Math.ceil(p.job.etaMin)} นาที` : ""}</small>}
      {p.job?.state === "failed" && p.job.error && <small className="pmk-err">{p.job.error}</small>}
      {picking && <div className="pmk-pick">
        <small>เลือกหน้าที่ชอบ 1 แบบ แล้วระบบจะสร้างต่อเอง</small>
        <div>{p.pictures.candidates.map((src, i) => src && <button key={i} type="button" disabled={busy !== null} onClick={() => act(`pick${p.id}`, { action: "pickFace", id: p.id, pick: i }, `เลือกหน้าแบบที่ ${i + 1} แล้ว`)}>
          <img src={src} alt={`หน้าแบบที่ ${i + 1}`} /><span>แบบ {i + 1}</span></button>)}</div>
        <button type="button" className="pmk-link" disabled={busy !== null} onClick={() => act(`re${p.id}`, { action: "rebuild", id: p.id }, "กำลังสร้างหน้าใหม่อีก 4 แบบ")}>ไม่ชอบเลย สร้างหน้าใหม่</button>
      </div>}
      {p.pictures.voice && <audio className="pmk-audio" controls preload="none" src={p.pictures.voice}>ตัวอย่างเสียง</audio>}
      <div className="pmk-actions">
        {status.usable && (live ? <span className="pmk-live">กำลังใช้ในไลฟ์</span>
          : wanted ? <span className="pmk-live wait">{liveRunning ? "จะใช้เมื่อปิดไลฟ์" : "กำลังเปลี่ยน…"}</span>
            : <button type="button" className="pmk-btn" disabled={busy !== null} onClick={() => act(`act${p.id}`, { action: "activate", id: p.id }, `ตั้ง ${p.name} เป็นพรีเซนเตอร์ไลฟ์แล้ว${liveRunning ? " จะเปลี่ยนเมื่อปิดไลฟ์" : ""}`)}>ใช้ในไลฟ์</button>)}
        <button type="button" className="pmk-btn ghost" disabled={busy !== null} onClick={() => setScene(scene ? null : { bg: p.background ?? "auto", shop: null })}>เปลี่ยนฉาก</button>
        {p.job?.state === "failed" && <button type="button" className="pmk-btn ghost" disabled={busy !== null} onClick={() => act(`re${p.id}`, { action: "rebuild", id: p.id }, "เริ่มสร้างใหม่แล้ว")}>ลองสร้างใหม่</button>}
        <button type="button" className="pmk-btn danger" disabled={busy !== null || busyHere} onClick={() => {
          if (window.confirm(`ลบพรีเซนเตอร์ “${p.name}”?`)) void act(`del${p.id}`, { action: "delete", id: p.id }, `ลบ ${p.name} แล้ว`);
        }}>ลบ</button>
      </div>
      {scene && <div className="pmk-scene-edit">
        <BackgroundPicker value={scene.bg} gender={p.gender} previews={previews} shop={scene.shop?.preview ?? p.pictures.shop}
          onChange={bg => setScene({ ...scene, bg })} onShop={shop => setScene({ bg: "custom", shop })} />
        <small className="praew-note">ฉากอยู่ในทุกคลิปท่าทาง เปลี่ยนฉากแล้วเครื่องจะสร้างพรีเซนเตอร์คนนี้ใหม่ (แบบเร็ว ~5 นาที แบบเต็ม ~1.5 ชม.)</small>
        <div className="pmk-nav"><button type="button" className="pmk-btn ghost" onClick={() => setScene(null)}>ยกเลิก</button>
          <button type="button" className="pmk-btn" disabled={busy !== null || (scene.bg === "custom" && !scene.shop && !p.bgPath)}
            onClick={() => { void act(`bg${p.id}`, { action: "update", id: p.id, background: scene.bg, ...(scene.shop ? { bgPath: scene.shop.path } : {}) },
              `เปลี่ยนฉากของ ${p.name} เป็น${backgroundLabel(scene.bg === "auto" ? autoBackground(p.gender) : scene.bg)}แล้ว เครื่องจะสร้างใหม่ให้`).then(() => setScene(null)); }}>บันทึกฉากและสร้างใหม่</button></div>
      </div>}
    </div>
  </li>;
}

/** The shop set behind the presenter: auto (by gender), one of the sets the PC makes, or the owner's own shop photo. */
function BackgroundPicker({ value, gender, previews, shop, onChange, onShop }: {
  value: BgChoice; gender: Gender; previews: Previews; shop: string | null;
  onChange: (bg: BgChoice) => void; onShop: (shop: { path: string; preview: string }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const auto = autoBackground(gender);
  // the PC's own preview (signed link) when it sent one, else the sample shipped with the site (public/presenter-bg)
  const preview = (id: BackgroundId) => previews[id] ?? `/presenter-bg/${id}.jpg`;
  const tile = (id: BgChoice, label: string, hint: string, img: string | null | undefined) =>
    <button key={id} type="button" role="radio" aria-checked={value === id} className={`pmk-bg${value === id ? " on" : ""}`}
      onClick={() => id === "custom" && !shop ? fileRef.current?.click() : onChange(id)}>
      <span className={`pmk-bg-img bg-${id === "auto" ? auto : id}`}>{img ? <img src={img} alt="" loading="lazy" /> : <i>{id === "custom" ? "＋ รูปร้าน" : "รอเครื่องสร้าง"}</i>}</span>
      <b>{label}</b><small>{hint}</small>
    </button>;
  const pickShop = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setError(null);
    try { const up = await uploadPicture(file); onShop({ path: up.path, preview: up.preview }); }
    catch { setError("อัปโหลดรูปร้านไม่สำเร็จ ใช้รูป JPG หรือ PNG แล้วลองใหม่"); } finally { setUploading(false); }
  };
  return <div className="pmk-field">ฉากหลัง
    <div className="pmk-bgs" role="radiogroup" aria-label="ฉากหลัง">
      {tile("auto", "อัตโนมัติ", `ตามเพศ: ${backgroundLabel(auto)}`, preview(auto))}
      {BACKGROUNDS.map(b => tile(b.id, b.label, b.hint, preview(b.id)))}
      {tile("custom", "รูปร้านของฉัน", uploading ? "กำลังอัปโหลด…" : shop ? "แตะเพื่อเปลี่ยนรูป" : "อัปโหลดรูปร้านจริง", shop)}
    </div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={e => { void pickShop(e.target.files?.[0]); e.target.value = ""; }} />
    {value === "custom" && shop && <button type="button" className="pmk-link" disabled={uploading} onClick={() => fileRef.current?.click()}>เปลี่ยนรูปร้าน</button>}
    {value === "custom" && <small className="praew-note">รูปร้าน: ถ่ายแนวตั้ง ตรงหน้าชั้นวางหรือผนังร้าน ไม่มีคนในรูป ระบบจะเบลอฉากนิดๆ ให้คนเด่น</small>}
    {error && <small className="pmk-err">{error}</small>}
  </div>;
}

function Wizard({ faceGenerator, previews, onClose, onCreated }: { faceGenerator: boolean; previews: Previews; onClose: () => void; onCreated: (name: string) => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"photo" | "generate">("photo");
  const [photo, setPhoto] = useState<{ path: string; preview: string; warn: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [look, setLook] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("male");
  const [voice, setVoice] = useState<VoiceId>(defaultVoice("male"));
  const [tone, setTone] = useState<Tone>("normal");
  const [personality, setPersonality] = useState(STYLE_PRESETS[0]);
  const [quality, setQuality] = useState<Quality>("both");
  const [background, setBackground] = useState<BgChoice>("auto");
  const [shop, setShop] = useState<{ path: string; preview: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickGender = (g: Gender) => { setGender(g); setVoice(defaultVoice(g)); };
  const voices = useMemo(() => [...VOICES].sort((a, b) => Number(b.gender === gender) - Number(a.gender === gender)), [gender]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const { path, preview, w, h } = await uploadPicture(file);
      const warn = Math.min(w, h) < 700 ? "รูปค่อนข้างเล็ก ภาพในไลฟ์อาจไม่คม ใช้รูปที่ใหญ่กว่านี้จะดีกว่า" : w > h * 1.1 ? "รูปแนวนอน ระบบจะครอปเป็นแนวตั้งรอบหน้าให้เอง" : null;
      setPhoto({ path, preview, warn });
    } catch { setError("อัปโหลดรูปไม่สำเร็จ ใช้รูป JPG หรือ PNG แล้วลองใหม่"); } finally { setUploading(false); }
  };

  const faceOk = mode === "photo" ? !!photo : look.trim().length >= 3;
  const create = async () => {
    setSaving(true); setError(null);
    try {
      await post({ action: "create", presenter: {
        name: name.trim(), gender, voice, tone, personality: personality.trim(), quality, consent,
        background, ...(background === "custom" && shop ? { bgPath: shop.path } : {}),
        source: mode === "photo" ? { kind: "photo", path: photo!.path } : { kind: "generate", look: look.trim() },
      } });
      await onCreated(name.trim());
    } catch (e) { setError(e instanceof Error ? e.message : "สร้างไม่สำเร็จ"); } finally { setSaving(false); }
  };

  return <div className="pmk-wizard">
    <ol className="pmk-steps" aria-label="ขั้นตอน">
      {["หน้าตา", "ชื่อ เสียง นิสัย", "ยืนยัน"].map((t, i) => <li key={t} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}><b>{step > i + 1 ? "✓" : i + 1}</b>{t}</li>)}
    </ol>

    {step === 1 && <div className="pmk-pane">
      <div className="pmk-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "photo"} className={mode === "photo" ? "on" : ""} onClick={() => setMode("photo")}>📷 ใช้รูปที่มี</button>
        <button type="button" role="tab" aria-selected={mode === "generate"} className={mode === "generate" ? "on" : ""} onClick={() => setMode("generate")} disabled={!faceGenerator}>✨ ให้ AI สร้างหน้า</button>
      </div>
      {!faceGenerator && <small className="praew-note">ให้ AI สร้างหน้า: ต้องให้คอมออนไลน์และมีโมเดลสร้างหน้าก่อน ตอนนี้ใช้รูปที่มีไปก่อนได้</small>}
      {mode === "photo" ? <>
        <div className="pmk-drop" onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") fileRef.current?.click(); }}>
          {photo ? <img src={photo.preview} alt="รูปที่เลือก" /> : <span>{uploading ? "กำลังอัปโหลด…" : "แตะเพื่อเลือกรูป"}</span>}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {photo?.warn && <small className="pmk-warn">{photo.warn}</small>}
        <ul className="pmk-tips">
          <li>คนเดียว หันหน้าตรง เห็นหัวถึงไหล่หรือครึ่งตัว</li>
          <li>แสงสว่าง หน้าชัด ไม่ใส่แว่นดำหรือหน้ากาก ไม่มีมือบังหน้า</li>
          <li>ปากปิดหรือยิ้มปิดปาก มีที่ว่างเหนือหัวนิดหน่อย</li>
        </ul>
      </> : <>
        <label className="pmk-field">บอกลักษณะหน้าตา (ภาษาอังกฤษ)
          <textarea rows={3} maxLength={300} value={look} onChange={e => setLook(e.target.value)} placeholder="a friendly Thai man, about 30, short black hair, white polo shirt" />
        </label>
        <div className="praew-quick muted">{LOOK_PRESETS[gender].map(l => <button key={l} type="button" onClick={() => setLook(l)}>{l.split(",").slice(0, 2).join(",")}</button>)}</div>
        <small className="praew-note">AI จะสร้างหน้าให้เลือก 4 แบบ ห้ามใส่ชื่อหรือหน้าตาของคนจริง</small>
      </>}
      <div className="pmk-nav"><button type="button" className="pmk-btn ghost" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="pmk-btn" disabled={!faceOk || uploading} onClick={() => setStep(2)}>ถัดไป</button></div>
    </div>}

    {step === 2 && <div className="pmk-pane">
      <label className="pmk-field">ชื่อพรีเซนเตอร์ (ชื่อที่ใช้พูดในไลฟ์)
        <input value={name} maxLength={30} onChange={e => setName(e.target.value)} placeholder="เช่น พี่ต้น" />
      </label>
      <div className="pmk-field">เพศ (ใช้เลือกคำลงท้าย ครับ / ค่ะ)
        <div className="pmk-seg">{(["male", "female"] as const).map(g => <button key={g} type="button" className={gender === g ? "on" : ""} onClick={() => pickGender(g)}>{g === "male" ? "ชาย · ครับ" : "หญิง · ค่ะ"}</button>)}</div>
      </div>
      <div className="pmk-field">เสียง (ฟรีทั้งหมด)
        <div className="pmk-voices">{voices.map(v => <label key={v.id} className={voice === v.id ? "on" : ""}>
          <input type="radio" name="voice" checked={voice === v.id} onChange={() => setVoice(v.id)} />
          <b>{v.label}</b><small>{v.hint}</small></label>)}</div>
        {VOICES.find(v => v.id === voice)?.gender !== gender && <small className="pmk-warn">เสียงนี้ไม่ตรงกับเพศที่เลือก</small>}
      </div>
      <div className="pmk-field">โทนเสียง
        <div className="pmk-seg">{(["low", "normal", "high"] as const).map(t => <button key={t} type="button" className={tone === t ? "on" : ""} onClick={() => setTone(t)}>{TONE_LABEL[t]}</button>)}</div>
      </div>
      <label className="pmk-field">นิสัย / สไตล์การพูด
        <textarea rows={2} maxLength={300} value={personality} onChange={e => setPersonality(e.target.value)} />
      </label>
      <div className="praew-quick muted">{STYLE_PRESETS.map(s => <button key={s} type="button" onClick={() => setPersonality(s)}>{s}</button>)}</div>
      <div className="pmk-nav"><button type="button" className="pmk-btn ghost" onClick={() => setStep(1)}>ย้อนกลับ</button>
        <button type="button" className="pmk-btn" disabled={!name.trim()} onClick={() => setStep(3)}>ถัดไป</button></div>
    </div>}

    {step === 3 && <div className="pmk-pane">
      <div className="pmk-summary">
        {mode === "photo" && photo ? <img src={photo.preview} alt="" /> : <span className="pmk-face"><span>AI</span></span>}
        <div><b>{name}</b><small>{gender === "male" ? "ชาย" : "หญิง"} · {voiceLabel(voice)} · {TONE_LABEL[tone]}</small><small>{personality}</small></div>
      </div>
      <BackgroundPicker value={background} gender={gender} previews={previews} shop={shop?.preview ?? null}
        onChange={setBackground} onShop={s => { setShop(s); setBackground("custom"); }} />
      <div className="pmk-field">คุณภาพท่าทาง
        <div className="pmk-voices">{QUALITIES.map(q => <label key={q} className={quality === q ? "on" : ""}>
          <input type="radio" name="quality" checked={quality === q} onChange={() => setQuality(q)} />
          <b>{QUALITY_INFO[q].label}{q === "both" ? " (แนะนำ)" : ""}</b><small>{QUALITY_INFO[q].hint}</small></label>)}</div>
      </div>
      <label className="pmk-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>{mode === "photo" ? "ยืนยันว่าเป็นรูปของฉันเอง หรือเจ้าของรูปยินยอมให้ใช้ทำพรีเซนเตอร์ AI แล้ว" : "ยืนยันว่าจะไม่ใช้หน้าที่ AI สร้างเลียนแบบคนจริง"} และจะแจ้งผู้ชมว่าเป็นพิธีกร AI</span></label>
      <small className="praew-note">สร้างบนคอมของคุณตอนไม่ได้ไลฟ์ (ใช้การ์ดจอ) ไฟล์ทั้งหมดอยู่ไดรฟ์ D: ปิดหน้านี้ได้เลย ระบบทำต่อเอง</small>
      {error && <small className="pmk-err">{error}</small>}
      <div className="pmk-nav"><button type="button" className="pmk-btn ghost" onClick={() => setStep(2)}>ย้อนกลับ</button>
        <button type="button" className="pmk-btn" disabled={!consent || saving || (background === "custom" && !shop)} onClick={() => void create()}>{saving ? "กำลังส่ง…" : "สร้างพรีเซนเตอร์"}</button></div>
    </div>}
    {error && step !== 3 && <small className="pmk-err">{error}</small>}
  </div>;
}
