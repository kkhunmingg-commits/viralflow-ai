"use client";

/* The picture is a base64 JPEG sent by the owner's PC, not a file Next can optimise. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PraewProduct } from "@/features/ai-live/live-director";
import type { PraewCommand, PraewDesired, PraewReport } from "@/features/praew-live/contract";

type Status = { online: boolean; report: PraewReport | null; settings: PraewDesired["settings"]; pending: number; snapshot: { jpeg: string; at: string } | null };

const LOCAL_STREAM = "http://127.0.0.1:8776/stream.mjpg";
const QUICK = [
  { label: "👋 ทักทาย", text: "สวัสดีค่า ยินดีต้อนรับเข้าไลฟ์แพรวนะคะ คุยกับแพรวได้เลยค่ะ" },
  { label: "➕ ชวนกดติดตาม", text: "ใครยังไม่ได้กดติดตาม กดติดตามแพรวไว้นะคะ จะได้ไม่พลาดไลฟ์ต่อไปค่ะ" },
  { label: "💬 ชวนคอมเมนต์", text: "พิมพ์คอมเมนต์มาคุยกับแพรวได้เลยนะคะ อยากรู้อะไรถามได้ค่ะ" },
  { label: "🙏 ขอบคุณ", text: "ขอบคุณทุกคนที่แวะมาดูนะคะ แพรวดีใจมากเลยค่ะ" },
];
const VOICES = [
  { name: "vachana-f2", label: "C · ใส ชัดสุด" },
  { name: "vachana-f2-jane", label: "E · โทนเสียงเจนเดิม" },
  { name: "vachana-f1", label: "B · นุ่ม" },
  { name: "vachana-f1-jane", label: "D · นุ่ม โทนเจน" },
  { name: "edge-premwadee", label: "Premwadee (ตอนนี้ใช้ไม่ได้)" },
  { name: "test-voice", label: "เสียงทดสอบ" },
] as const;
const ENGINES = [
  { name: "pro", label: "Pro", hint: "ขยับเนียน · ต้องการการ์ดจอแรง" },
  { name: "lite", label: "Lite", hint: "ขยับวนลูป · คอมสเปคต่ำก็ไลฟ์ได้" },
] as const;
const PARTS: Record<string, string> = { engine: "ภาพ", llm: "สมองตอบ", tts: "เสียง", tiktok: "TikTok", obs: "ภาพออก OBS", bridge: "ตัวเชื่อม" };
const STATE_TEXT: Record<string, { title: string; tone: string }> = {
  running: { title: "แพรวกำลังออนแอร์", tone: "live" },
  starting: { title: "กำลังเปิดระบบ…", tone: "busy" },
  stopping: { title: "กำลังปิดระบบ…", tone: "busy" },
  stopped: { title: "ปิดอยู่ พร้อมเริ่ม", tone: "idle" },
  error: { title: "มีปัญหา", tone: "bad" },
};
const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s} วิที่แล้ว` : s < 3600 ? `${Math.round(s / 60)} นาทีที่แล้ว` : `${Math.round(s / 3600)} ชม.ที่แล้ว`;
};
const fmt = (n: number | null | undefined, unit: string, digits = 0) => (n === null || n === undefined ? "–" : `${n.toFixed(digits)}${unit}`);

export function PraewControl({ products, postedCount }: { products: PraewProduct[]; postedCount: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [tiktok, setTiktok] = useState<string | null>(null);
  const [followers, setFollowers] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The bridge's picture is only a preview: fetch it every 30 s (every 10th poll), the status every 3 s.
  const polls = useRef(0);
  // On the home PC the page shows the engine's own 25 fps stream straight from 127.0.0.1 (no internet data);
  // elsewhere, or if Chrome blocks it, the preview picture stays.
  const [stream, setStream] = useState<"trying" | "ok" | "failed">("trying");
  const [streamKey, setStreamKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const picture = polls.current++ % 10 === 0;
      const response = await fetch(`/api/praew-live${picture ? "" : "?picture=0"}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next = await response.json() as Status;
      setStatus(previous => picture ? next : { ...next, snapshot: previous?.snapshot ?? null });
      setLoadError(false);
    } catch { setLoadError(true); }
  }, []);

  useEffect(() => {
    let stopped = false;
    const loop = async () => {
      if (!document.hidden) await refresh();
      if (!stopped) timer.current = setTimeout(loop, 3000);
    };
    void loop();
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  const send = useCallback(async (command: PraewCommand, done: string) => {
    setBusy(command.type);
    try {
      const response = await fetch("/api/praew-live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      if (!response.ok) throw new Error();
      setToast(done);
      void refresh();
      return true;
    } catch {
      setToast("ส่งคำสั่งไม่สำเร็จ ลองใหม่อีกครั้ง");
      return false;
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 3500);
    }
  }, [refresh]);

  const report = status?.report ?? null;
  const settings = status?.settings;
  const online = status?.online ?? false;
  const state = online ? (report?.state ?? "stopped") : "offline";
  const look = online ? STATE_TEXT[state] ?? STATE_TEXT.stopped : { title: "คอมยังไม่ได้เชื่อม", tone: "off" };
  const running = online && (state === "running" || state === "starting");
  const muted = report?.muted ?? settings?.muted ?? false;
  const chatter = report?.chatter ?? settings?.chatter ?? true;
  const overlay = report?.overlay ?? settings?.overlay ?? true;
  const talkProducts = settings?.products ?? true;
  // The PC reports the engine it is actually running; until then show what the page asked for.
  const engine = report?.engine ?? settings?.engine ?? "pro";
  const asked = settings?.engine ?? "pro";
  const litePacks = report?.litePacks ?? [];
  const litePresenter = report?.litePresenter ?? settings?.litePresenter ?? "";
  const testVoice = /test/i.test(report?.voice ?? "");
  const engineUp = online && state === "running";
  // The engine just came up (or came back): try the local stream again.
  const [wasUp, setWasUp] = useState(false);
  if (engineUp !== wasUp) {
    setWasUp(engineUp);
    if (engineUp) { setStream("trying"); setStreamKey(k => k + 1); }
  }

  const say = async () => {
    if (!text.trim()) return;
    if (await send({ type: "say", text: text.trim() }, "ส่งให้แพรวพูดแล้ว")) setText("");
  };

  return <section id="praew-live" className="praew" aria-label="ควบคุมไลฟ์แพรว">
    <div className="praew-top">
      <div className={`praew-screen tone-${look.tone}`}>
        {status?.snapshot && online
          ? <img src={`data:image/jpeg;base64,${status.snapshot.jpeg}`} alt="ภาพไลฟ์แพรวล่าสุด" />
          : <div className="praew-screen-empty"><span>แพรว</span><p>{online ? "รอภาพจากคอม…" : "เปิดคอมที่บ้านแล้วภาพจะขึ้นตรงนี้"}</p></div>}
        {engineUp && stream !== "failed"
          ? <img key={streamKey} className={`praew-stream${stream === "ok" ? " on" : ""}`} src={LOCAL_STREAM} alt="ภาพไลฟ์แพรวสด"
              onLoad={() => setStream("ok")} onError={() => setStream("failed")} />
          : null}
        <b className="praew-badge">{state === "running" ? "● ออนแอร์" : online ? "คอมออนไลน์" : "ออฟไลน์"}</b>
        {engineUp && stream === "ok" ? <small className="praew-shot-age">ภาพสด 25 เฟรม/วิ</small>
          : status?.snapshot && online ? <small className="praew-shot-age">ภาพตัวอย่าง · {ago(status.snapshot.at)}</small> : null}
      </div>

      <div className="praew-main">
        <p className="praew-eyebrow">ไลฟ์ AI · แพรว</p>
        <h2 className={`praew-state tone-${look.tone}`}>{look.title}</h2>
        <p className="praew-sub">
          {!status ? (loadError ? "โหลดสถานะไม่ได้ กำลังลองใหม่…" : "กำลังโหลด…")
            : !online ? (report ? `คอมส่งข่าวล่าสุด ${ago(report.receivedAt)} ตรวจว่าคอมเปิดอยู่และต่อเน็ต` : "ยังไม่เคยเชื่อมกับคอม ต้องติดตั้งตัวเชื่อมบนคอมก่อน (ทำครั้งเดียว)")
            : report?.detail ?? (report?.speaking ? `กำลังพูด: “${report.speaking}”` : "พร้อมรับคำสั่ง")}
        </p>
        {status && status.pending > 0 && online ? <p className="praew-pending">มีคำสั่งรอคอมทำ {status.pending} รายการ</p> : null}

        <div className="praew-big">
          {running
            ? <button type="button" className="praew-btn stop" disabled={!!busy} onClick={() => send({ type: "stop" }, "สั่งปิดไลฟ์แล้ว")}>■ ปิดระบบไลฟ์</button>
            : <button type="button" className="praew-btn go" disabled={!!busy || !online} onClick={() => send({ type: "start" }, "สั่งเปิดระบบแล้ว รอประมาณ 1 นาที")}>▶ เริ่มไลฟ์แพรว</button>}
          <button type="button" className="praew-btn panic" disabled={!!busy || !online} title="หยุดพูดทันที ยิ้มนิ่ง ไม่ตอบอะไร" onClick={() => send({ type: "idle" }, "หยุดพูดทันทีแล้ว")}>✋ หยุดพูดทันที</button>
        </div>

        <div className="praew-toggles">
          <Toggle label="ปิดเสียง" hint="เงียบ แต่ภาพยังขยับ" on={muted} disabled={!online || !!busy} onChange={on => send({ type: "mute", on }, on ? "ปิดเสียงแล้ว" : "เปิดเสียงแล้ว")} />
          <Toggle label="ชวนคุยเอง" hint="ไม่มีคอมเมนต์ แพรวจะชวนคุยเอง" on={chatter} disabled={!online || !!busy} onChange={on => send({ type: "chatter", on }, on ? "เปิดชวนคุยเองแล้ว" : "ปิดชวนคุยเองแล้ว")} />
          <Toggle label="คอมเมนต์บนจอ" hint="กล่องแชทบนภาพ" on={overlay} disabled={!online || !!busy} onChange={on => send({ type: "overlay", on }, on ? "แสดงคอมเมนต์บนจอแล้ว" : "ซ่อนคอมเมนต์บนจอแล้ว")} />
        </div>

        <div className="praew-engine" role="radiogroup" aria-label="ตัวสร้างภาพ">
          <span className="praew-engine-label">ตัวสร้างภาพ</span>
          {ENGINES.map(option => <button key={option.name} type="button" role="radio" aria-checked={asked === option.name}
            className={`praew-engine-option${asked === option.name ? " on" : ""}`} disabled={!!busy}
            onClick={() => asked !== option.name && send({ type: "engine", name: option.name }, running ? `สลับเป็น ${option.label} แล้ว ภาพจะเปลี่ยนภายในไม่กี่วินาที` : `เลือก ${option.label} แล้ว`)}>
            <b>{option.label}</b><small>{option.hint}</small>
          </button>)}
          {online && report?.engine && report.engine !== asked ? <small className="praew-engine-wait">คอมกำลังสลับตัวสร้างภาพ…</small> : null}
        </div>
        {engine === "lite" || asked === "lite" ? <div className="praew-field praew-lite-pack">
          <label htmlFor="praew-lite-pack">พรีเซนเตอร์ Lite</label>
          <div><select id="praew-lite-pack" value={litePresenter} disabled={!online || !!busy || !litePacks.length}
            onChange={e => { const pack = litePacks.find(p => p.folder === e.target.value); if (pack) void send({ type: "litePresenter", folder: pack.folder }, `ใช้พรีเซนเตอร์ ${pack.name} แล้ว`); }}>
            {!litePacks.some(p => p.folder === litePresenter) ? <option value="">{litePacks.length ? "เลือกพรีเซนเตอร์" : online ? "คอมยังไม่ส่งรายชื่อพรีเซนเตอร์" : "เปิดคอมก่อน"}</option> : null}
            {litePacks.map(p => <option key={p.folder} value={p.folder}>{p.name}</option>)}
          </select></div>
          <small>ใช้ปุ่ม สินค้า เสียง คอมเมนต์ และ OBS ชุดเดียวกับ Pro ทั้งหมด · <Link href="/ai-live/lite">สร้างพรีเซนเตอร์ Lite จากรูปของคุณ</Link></small>
        </div> : null}

        <ul className="praew-chips" aria-label="สุขภาพระบบ">
          {Object.entries(report?.parts ?? {}).map(([key, value]) => <li key={key} className={`chip-${value}`}>{PARTS[key] ?? key}</li>)}
          {report?.voice ? <li className={testVoice ? "chip-warn" : "chip-ok"} title={report.voice}>{testVoice ? "เสียงทดสอบ (ยังไม่ใช่เสียงจริง)" : `เสียง ${report.voice}`}</li> : null}
          {report?.gpu ? <li className={(report.gpu.tempC ?? 0) >= 83 ? "chip-down" : "chip-ok"}>GPU {fmt(report.gpu.tempC, "°C")} · {fmt(report.gpu.powerW, " W")}</li> : null}
          {report?.disk ? <li className={(report.disk.cFreeGb ?? 99) < 10 ? "chip-down" : "chip-ok"}>C: ว่าง {fmt(report.disk.cFreeGb, " GB", 1)} · D: {fmt(report.disk.dFreeGb, " GB")}</li> : null}
        </ul>
      </div>
    </div>

    <div className="praew-grid">
      <div className="praew-card praew-say">
        <h3>พิมพ์ให้แพรวพูด</h3>
        <p className="praew-note">แพรวจะพูดตามที่พิมพ์ทุกคำ ไม่ผ่าน AI</p>
        <form onSubmit={e => { e.preventDefault(); void say(); }}>
          <textarea value={text} maxLength={300} rows={3} placeholder="เช่น วันนี้มีของแจกด้วยนะคะ อยู่ดูกันยาวๆ เลยค่ะ" onChange={e => setText(e.target.value)} />
          <div className="praew-say-row">
            <small>{text.length}/300</small>
            <button type="submit" className="praew-btn go small" disabled={!online || !text.trim() || !!busy}>พูดเลย</button>
          </div>
        </form>
        <div className="praew-quick">
          {QUICK.map(q => <button key={q.label} type="button" disabled={!online || !!busy} title={q.text} onClick={() => send({ type: "say", text: q.text }, `ส่ง “${q.label.slice(2).trim()}” แล้ว`)}>{q.label}</button>)}
        </div>
        <div className="praew-quick muted">
          <button type="button" disabled={!online || !!busy} onClick={() => send({ type: "skip" }, "ข้ามประโยคนี้แล้ว")}>⏭ ข้ามประโยคนี้</button>
          <button type="button" disabled={!online || !!busy} onClick={() => send({ type: "clear" }, "ล้างคิวแล้ว")}>🧹 ล้างคิวที่รอพูด</button>
        </div>
      </div>

      <div className="praew-card">
        <h3>ตอนนี้แพรวทำอะไรอยู่</h3>
        <dl className="praew-now">
          <div><dt>กำลังพูด</dt><dd>{report?.speaking ? `“${report.speaking}”` : "เงียบอยู่"}</dd></div>
          <div><dt>รอพูดต่อ</dt><dd>{report?.queue.length ? `${report.queue.length} ประโยค` : "ไม่มี"}</dd></div>
        </dl>
        {report?.queue.length ? <ol className="praew-list queue">{report.queue.slice(0, 5).map((q, i) => <li key={i}>{q}</li>)}</ol> : null}
        <h4>พูดไปล่าสุด</h4>
        {report?.recent.length
          ? <ol className="praew-list">{report.recent.slice().reverse().slice(0, 6).map((r, i) => <li key={i}><span>{r.text}</span>{r.source ? <em>{r.source}</em> : null}</li>)}</ol>
          : <p className="praew-note">ยังไม่มี</p>}
      </div>

      <div className="praew-card">
        <h3>คอมเมนต์จากคนดู</h3>
        <p className="praew-note">อ่านจาก TikTok อย่างเดียว ไม่โพสต์อะไร คอมเมนต์สแปม/ลิงก์ถูกคัดออกให้อัตโนมัติ</p>
        {report?.comments.length
          ? <ol className="praew-list comments">{report.comments.slice().reverse().slice(0, 8).map((c, i) => <li key={i} className={c.verdict && c.verdict !== "ok" && c.verdict !== "answer" ? "dropped" : ""}><b>{c.user}</b><span>{c.text}</span>{c.verdict ? <em>{c.verdict}</em> : null}</li>)}</ol>
          : <p className="praew-empty">ยังไม่มีคอมเมนต์{report?.tiktok?.connected ? "" : " (ยังไม่ได้ต่อ TikTok)"}</p>}
      </div>

      <div className="praew-card praew-products">
        <h3>สินค้าที่แพรวพูดถึง</h3>
        <Toggle label="พูดถึงสินค้า" hint="ส่งรายการด้านล่างให้แพรว ปิด = คุยเล่นอย่างเดียว" on={talkProducts} disabled={!!busy}
          onChange={on => send({ type: "products", on }, on ? "ส่งรายการสินค้าให้แพรวแล้ว ใช้ได้ภายใน 1 นาที" : "แพรวเลิกพูดถึงสินค้าแล้ว")} />
        <p className="praew-note">ดึงจากระบบเอง: สินค้าที่ขายได้จริงจากคลิป TikTok ก่อน ตามด้วยสินค้าที่โพสต์แล้วทั้ง TikTok Shop และคลิปลิงก์ Shopee/Lazada เรียงตามสถิติจริง (ออเดอร์ ยอดวิว คอมเมนต์ แชร์) ถ้ามีไม่ถึง 6 ตัวก็ใส่ทั้งหมด แพรวพูดได้เฉพาะข้อมูลที่เก็บไว้ ไม่พูดราคา Shopee/Lazada อย่าลืมปักสินค้า TikTok เข้าตะกร้าไลฟ์ในแอป TikTok ด้วย</p>
        {products.length
          ? <ol className="praew-list">{products.map(p => <li key={p.name}><span><b>{p.name}</b> · ข้อมูล {p.facts.length} ข้อ{p.price ? ` · ${p.price}` : ""}</span><em>{p.source === "TIKTOK_SALES" ? "ขายได้จริง" : p.source === "POSTED_TIKTOK" ? "โพสต์ TikTok แล้ว" : "โพสต์ขายแล้ว"}</em></li>)}</ol>
          : <p className="praew-empty">{postedCount ? "สินค้าที่โพสต์ไว้ยังไม่มีข้อมูลสินค้าให้แพรวพูด" : "ยังไม่มีสินค้าที่โพสต์ขาย ทำคลิปสินค้าจากลิงก์แล้วกด “ผ่าน · โพสต์” ก่อน"}</p>}
      </div>

      <div className="praew-card">
        <h3>ตั้งค่าไลฟ์</h3>
        <form className="praew-field" onSubmit={e => { e.preventDefault(); void send({ type: "tiktok", username: (tiktok ?? settings?.tiktok ?? "").trim().replace(/^@/, "") }, "บันทึกช่อง TikTok แล้ว"); setTiktok(null); }}>
          <label htmlFor="praew-tiktok">ช่อง TikTok ที่ให้แพรวอ่านคอมเมนต์</label>
          <div><span>@</span><input id="praew-tiktok" value={tiktok ?? settings?.tiktok ?? ""} placeholder="ชื่อช่องของคุณ" pattern="[A-Za-z0-9._]{0,24}" onChange={e => setTiktok(e.target.value.replace(/^@/, ""))} />
            <button type="submit" className="praew-btn small" disabled={!!busy}>บันทึก</button></div>
          <small>{report?.tiktok ? (report.tiktok.connected ? `เชื่อมแล้ว${report.tiktok.viewers != null ? ` · คนดู ${report.tiktok.viewers}` : ""}` : "ยังไม่เชื่อม (ต้องเปิดไลฟ์ในแอป TikTok ก่อน)") : "เว้นว่าง = ไม่อ่านคอมเมนต์"}</small>
        </form>
        <form className="praew-field" onSubmit={e => { e.preventDefault(); const n = Number(followers ?? settings?.followers ?? 0); if (Number.isInteger(n) && n >= 0) void send({ type: "followers", count: n }, "บันทึกยอดผู้ติดตามแล้ว"); setFollowers(null); }}>
          <label htmlFor="praew-followers">ผู้ติดตามตอนนี้</label>
          <div><input id="praew-followers" type="number" min={0} inputMode="numeric" value={followers ?? (settings?.followers ?? "")} placeholder="เช่น 12" onChange={e => setFollowers(e.target.value)} />
            <button type="submit" className="praew-btn small" disabled={!!busy}>บันทึก</button></div>
          <small>แพรวใช้ตัวเลขนี้ตอนชวนกดติดตามให้ถึง 50 คน</small>
        </form>
        <div className="praew-field">
          <label htmlFor="praew-voice">เสียงของแพรว</label>
          <div><select id="praew-voice" value={report?.voice ?? settings?.voice ?? ""} disabled={!online || !!busy}
            onChange={e => { const v = VOICES.find(x => x.name === e.target.value); if (v) void send({ type: "voice", name: v.name }, `เปลี่ยนเป็นเสียง ${v.label} แล้ว`); }}>
            {!VOICES.some(v => v.name === (report?.voice ?? settings?.voice)) ? <option value="">{report?.voice ?? "เลือกเสียง"}</option> : null}
            {VOICES.map(v => <option key={v.name} value={v.name}>{v.label}</option>)}
          </select></div>
          <small>เสียงฟรีทั้งหมด รันในคอมเอง สลับได้ทันทีไม่ต้องปิดแพรว</small>
        </div>
        <details className="praew-help">
          <summary>ใช้งานยังไง</summary>
          <ol>
            <li>เปิดคอมที่บ้าน ตัวเชื่อมจะเปิดเองตอนล็อกอิน ป้ายบนภาพจะเปลี่ยนเป็น “คอมออนไลน์”</li>
            <li>กด <b>เริ่มไลฟ์แพรว</b> รอประมาณ 1 นาทีจนขึ้น “ออนแอร์”</li>
            <li>ใน OBS เพิ่มภาพจาก <code>http://127.0.0.1:8776/view</code> แล้วไลฟ์เข้า TikTok ตามปกติ</li>
            <li>พิมพ์ให้แพรวพูด หรือปล่อยให้แพรวตอบคอมเมนต์เอง ถ้ามีอะไรผิดปกติ กด <b>หยุดพูดทันที</b></li>
          </ol>
        </details>
      </div>
    </div>
    {toast ? <p className="praew-toast" role="status">{toast}</p> : null}
  </section>;
}

function Toggle({ label, hint, on, disabled, onChange }: { label: string; hint: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} className={`praew-toggle${on ? " on" : ""}`} disabled={disabled} title={hint} onClick={() => onChange(!on)}>
    <i aria-hidden="true" /><span>{label}<small>{hint}</small></span>
  </button>;
}
