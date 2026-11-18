"use client";

/* The live picture is an MJPEG stream from this PC; Next image optimization cannot proxy it. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";

/**
 * Praew AI Live runs on the owner's own PC (it needs the local GPU). This panel talks to that PC's
 * supervisor on http://localhost:8760 straight from the browser, so it works when ViralFlow is opened on
 * the same computer and nothing on the PC is exposed to the internet.
 */
const SUPERVISOR = "http://localhost:8760";
const STREAM = "http://127.0.0.1:8766/stream.mjpg";

type Line = { t: string; kind: string; user?: string; comment?: string; line?: string; latency_s?: number | null };
type QueueItem = { user: string; text: string; age_s: number };
type Recent = { what: string; why: string; user: string; text: string };
type Engine = {
  tts?: string; tts_test_only?: boolean; muted?: boolean; overlay?: boolean; idle_only?: boolean;
  followers_now?: number; follower_goal?: number; speaking?: { line: string } | null; last_lines?: Line[];
  gpu?: number[] | null; brain?: { queue?: QueueItem[]; recent?: Recent[]; stats?: Record<string, number> };
};
type Status = {
  parts: Record<string, { state: string; restarts_last_hour: number }>;
  engine: Engine; tiktok_username: string; disk_free_gb: { C: number; D: number };
};

const KIND: Record<string, string> = { reply: "ตอบ", thanks: "ขอบคุณ", greet: "ทักทาย", quiet: "ชวนคุย", say: "พิมพ์เอง" };
const PART: Record<string, string> = { running: "ทำงาน", starting: "กำลังเปิด", stopped: "ปิดอยู่", failed: "ล่ม", disabled: "ไม่ได้ตั้ง" };

export function PraewLivePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const [say, setSay] = useState("");
  const [comment, setComment] = useState("");
  const [username, setUsername] = useState("");
  const [streamKey, setStreamKey] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${SUPERVISOR}/api/status`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setStatus(await response.json() as Status);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 1500);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);

  async function post(path: string, body: Record<string, unknown> = {}) {
    setNotice(null);
    try {
      const response = await fetch(`${SUPERVISOR}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) setNotice("คำสั่งไม่สำเร็จ (ระบบแพรวอาจยังเปิดไม่เสร็จ)");
    } catch {
      setNotice("ติดต่อระบบแพรวในเครื่องไม่ได้");
    }
    void refresh();
  }
  const control = (action: string, extra: Record<string, unknown> = {}) => post("/api/control", { action, ...extra });

  const engine = status?.engine ?? {};
  const engineOn = status?.parts?.engine?.state === "running";
  const brain = engine.brain ?? {};
  const dropped = Object.entries(brain.stats ?? {}).filter(([key]) => key.startsWith("drop_"));

  return <section className="ai-live-page praew-live" aria-label="แพรว AI Live">
    <header className="ai-live-hero">
      <div>
        <p className="eyebrow">AI LIVE · เครื่องนี้</p>
        <h2>แพรว พิธีกร AI</h2>
        <p>แพรวตอบคอมเมนต์ ขอบคุณคนกดติดตาม และชวนคุยเองตอนแชทเงียบ ภาพและเสียงทำบนการ์ดจอของคอมเครื่องนี้ จึงใช้หน้านี้ได้เมื่อเปิด ViralFlow บนเครื่องเดียวกัน</p>
      </div>
      <span className={`ai-live-state ${engineOn ? "ready" : "blocked"}`}>
        {offline ? "ระบบแพรวยังไม่เปิด" : engineOn ? "แพรวพร้อม" : `กำลังเปิด / ${PART[status?.parts?.engine?.state ?? ""] ?? "ปิดอยู่"}`}
      </span>
    </header>

    {offline && <div className="ai-live-warning praew-offline" role="status">
      <p><strong>ยังติดต่อระบบแพรวในเครื่องนี้ไม่ได้</strong> เปิดด้วยคำสั่งนี้ใน PowerShell หนึ่งครั้ง แล้วรอ 2–3 นาที:</p>
      <code>powershell -ExecutionPolicy Bypass -File D:\ViralFlowAI\workspace\presenter-lab\live\start_live.ps1 -Tts test-voice</code>
      <p>ถ้า Chrome ถามว่าจะอนุญาตให้เว็บนี้เข้าถึงอุปกรณ์ในเครือข่ายภายในหรือไม่ ให้กดอนุญาต (คือการคุยกับโปรแกรมแพรวในเครื่องนี้)</p>
    </div>}

    <div className="ai-live-grid">
      <section className="ai-live-panel ai-live-preview" aria-label="ภาพแพรว">
        <div className="ai-live-panel-title">
          <div><h2>ภาพสด</h2></div>
          <span className={`phase-chip ${engine.tts_test_only ? "praew-test" : ""}`}>เสียง: {engine.tts ?? "-"}{engine.tts_test_only ? " · TEST ONLY" : ""}</span>
        </div>
        <div className="ai-live-stage praew-stage">
          {engineOn && !streamError
            ? <img key={streamKey} src={`${STREAM}?k=${streamKey}`} alt="ภาพแพรวแบบสด" onError={() => setStreamError(true)} />
            : <div className="ai-live-stage-empty"><span>LIVE</span><strong>{engineOn ? "ภาพสดขัดข้อง" : "ยังไม่มีภาพ"}</strong>
              {engineOn && <button type="button" className="secondary-action" onClick={() => { setStreamError(false); setStreamKey((k) => k + 1); }}>โหลดภาพใหม่</button>}</div>}
        </div>
        <p className="ai-live-context-note" role="status">{engine.idle_only ? "โหมดภาพนิ่ง แพรวไม่พูด" : engine.speaking ? `กำลังพูด: ${engine.speaking.line}` : "รอคอมเมนต์ / ชวนคุยเองเมื่อแชทเงียบ"}</p>
        <p className="ai-live-context-note">OBS: Media Source → {STREAM} (รูปแบบ mpjpeg) · ภาพเต็ม 720x1280</p>
      </section>

      <section className="ai-live-panel" aria-label="ควบคุมแพรว">
        <div className="ai-live-panel-title"><div><h2>ควบคุม</h2></div>
          <span className="phase-chip">{engine.gpu ? `GPU ${Math.round(engine.gpu[0])} W · ${Math.round(engine.gpu[1])} °C` : "GPU -"}</span></div>
        <div className="ai-live-actions praew-actions">
          <button type="button" className="primary-action" disabled={offline} onClick={() => void post("/api/start")}>เริ่มทั้งหมด</button>
          <button type="button" className="secondary-action" disabled={offline} onClick={() => { if (confirm("ปิดระบบแพรวทั้งหมด?")) void post("/api/stop"); }}>หยุดทั้งหมด</button>
          <button type="button" className="danger-action" disabled={!engineOn} onClick={() => void control(engine.idle_only ? "idle_only_off" : "idle_only_on")}>{engine.idle_only ? "กลับมาพูดต่อ" : "หยุดพูด (ภาพนิ่ง)"}</button>
          <button type="button" className="secondary-action" disabled={!engineOn} onClick={() => void control(engine.muted ? "unmute" : "mute")}>{engine.muted ? "เปิดเสียง" : "ปิดเสียง"}</button>
          <button type="button" className="secondary-action" disabled={!engineOn} onClick={() => void control(engine.overlay ? "overlay_off" : "overlay_on")}>{engine.overlay ? "ซ่อนแชทบนจอ" : "แสดงแชทบนจอ"}</button>
          <button type="button" className="secondary-action" disabled={!engineOn} onClick={() => void control("skip")}>ข้ามประโยค</button>
          <button type="button" className="secondary-action" disabled={!engineOn} onClick={() => void control("clear")}>ล้างคิว</button>
        </div>
        <form className="praew-row" onSubmit={(event) => { event.preventDefault(); if (say.trim()) { void control("say", { text: say.trim() }); setSay(""); } }}>
          <label className="ai-live-field">ให้แพรวพูดตามนี้
            <input value={say} maxLength={200} onChange={(event) => setSay(event.target.value)} placeholder="พิมพ์ประโยค แพรวพูดตามเป๊ะ" disabled={!engineOn} />
          </label>
          <button type="submit" className="secondary-action" disabled={!engineOn || !say.trim()}>พูด</button>
        </form>
        <form className="praew-row" onSubmit={(event) => { event.preventDefault(); if (comment.trim()) { void post("/api/comment", { user: "บอส", text: comment.trim() }); setComment(""); } }}>
          <label className="ai-live-field">ลองคอมเมนต์แบบคนดู
            <input value={comment} maxLength={200} onChange={(event) => setComment(event.target.value)} placeholder="เช่น แพรวกินข้าวยังคะ" disabled={!engineOn} />
          </label>
          <button type="submit" className="secondary-action" disabled={!engineOn || !comment.trim()}>ส่ง</button>
        </form>
        <form className="praew-row" onSubmit={(event) => { event.preventDefault(); void post("/api/username", { username: username.trim() }); }}>
          <label className="ai-live-field">ช่อง TikTok ที่จะอ่านคอมเมนต์ (อ่านอย่างเดียว)
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={status?.tiktok_username || "@ชื่อช่อง"} disabled={offline} />
          </label>
          <button type="submit" className="secondary-action" disabled={offline || !username.trim()}>บันทึก</button>
        </form>
        <form className="praew-row" onSubmit={(event) => { event.preventDefault(); const value = Number(new FormData(event.currentTarget).get("followers")); if (Number.isFinite(value)) void control("followers", { value }); }}>
          <label className="ai-live-field">ผู้ติดตามตอนนี้ (เป้าหมาย {engine.follower_goal ?? 50})
            <input name="followers" type="number" min={0} defaultValue={engine.followers_now ?? 0} key={engine.followers_now ?? "f"} disabled={!engineOn} />
          </label>
          <button type="submit" className="secondary-action" disabled={!engineOn}>ตั้งค่า</button>
        </form>
        {notice && <p className="ai-live-error" role="alert">{notice}</p>}
        <p className="ai-live-context-note">
          {status ? Object.entries(status.parts).map(([name, part]) => `${name}: ${PART[part.state] ?? part.state}`).join(" · ") : ""}
          {status ? ` · C: ${status.disk_free_gb.C} GB` : ""}
          {status?.tiktok_username ? ` · TikTok: ${status.tiktok_username}` : " · ยังไม่ได้ตั้งช่อง TikTok"}
        </p>
      </section>
    </div>

    <div className="ai-live-grid praew-lists">
      <section className="ai-live-panel" aria-label="ประโยคล่าสุด">
        <div className="ai-live-panel-title"><div><h2>แพรวพูดล่าสุด</h2></div></div>
        <div className="data-list">{(engine.last_lines ?? []).slice().reverse().map((line, index) => <div key={`${line.t}-${index}`}>
          <strong>{line.t} · {KIND[line.kind] ?? line.kind}{line.user ? ` ${line.user}` : ""}</strong>
          {line.comment && <small>คอมเมนต์: {line.comment}</small>}
          <span>{line.line}</span>
        </div>)}</div>
      </section>
      <section className="ai-live-panel" aria-label="คิวคอมเมนต์">
        <div className="ai-live-panel-title"><div><h2>คิวคอมเมนต์</h2></div><span className="phase-chip">{(brain.queue ?? []).length} รอตอบ</span></div>
        <div className="data-list">{(brain.queue ?? []).map((item, index) => <div key={`${item.user}-${index}`}><strong>{item.user}</strong><span>{item.text}</span><small>รอ {item.age_s} วิ</small></div>)}</div>
        <h3>คัดออกล่าสุด</h3>
        <div className="data-list">{(brain.recent ?? []).filter((r) => r.what === "drop").slice(-6).reverse().map((r, index) => <div key={index}><strong>{r.user}</strong><span>{r.text}</span><small>{r.why}</small></div>)}</div>
        {dropped.length > 0 && <p className="ai-live-context-note">รวมที่คัดออก: {dropped.map(([key, n]) => `${key.slice(5)} ${n}`).join(", ")}</p>}
      </section>
    </div>
  </section>;
}
