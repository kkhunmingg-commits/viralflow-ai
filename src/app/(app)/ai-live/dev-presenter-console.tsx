"use client";

/* Generated JPEGs and reference images are browser Blob URLs, never optimized/cached. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { BoundedAudioSender, DEV_AUDIO_CHUNK_SAMPLES, DEV_AUDIO_RATE, encodeMonoPcm16, inspectDevPcmWave } from "@/features/ai-live/dev-audio";
import { openDevMicrophone } from "@/features/ai-live/dev-microphone";
import { readGeneratedFrame } from "@/features/ai-live/dev-preview";
import { waitForDevRelease } from "@/features/ai-live/dev-session";

type Metrics = {
  status?: string; backend?: string; error?: string | null; fps?: number; average_fps?: number;
  frames_generated?: number; p50_latency_ms?: number; p95_latency_ms?: number; cpu_percent?: number;
  ram_mb?: number; queue_depth?: number; audio_queue_depth?: number; audio_queue_delay_ms?: number;
  frame_drops?: number; audio_receiving?: boolean; inference_active?: boolean; preview_status?: string;
  encoder?: unknown; resources_released?: boolean;
};
type Props = { accounts: { id: string; label: string }[]; products: { id: string; title: string }[]; transportBase?: string };

function measurement(value: number | undefined, unit = "") { return Number.isFinite(value) ? `${value!.toFixed(1)}${unit}` : "—"; }
function cancelledWait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Stopped", "AbortError")); return; }
    const abort = () => { window.clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); };
    const timer = window.setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function DevPresenterConsole({ accounts, products, transportBase = "/api/ai-live/dev" }: Props) {
  const [reference, setReference] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("ยังไม่ได้ตรวจ backend");
  const [audioStatus, setAudioStatus] = useState("ยังไม่ได้ส่งเสียง");
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [microphone, setMicrophone] = useState(false);
  const [clientDrops, setClientDrops] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [fps, setFps] = useState(2);
  const sessionRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const microphoneRef = useRef<{ close: () => Promise<void> } | null>(null);
  const senderRef = useRef<BoundedAudioSender | null>(null);
  const frameRef = useRef<{ url: string | null; count: number }>({ url: null, count: 0 });
  const referenceUrlRef = useRef<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${transportBase}/${path}`, { ...options, cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; detail?: string };
      throw new Error(body.error || body.detail || `Worker HTTP ${response.status}`);
    }
    return response;
  }

  function chooseReference(file: File | null) {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    referenceUrlRef.current = url; setReference(file); setReferenceUrl(url);
  }
  function chooseAudioFile(file: File | null) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    audioUrlRef.current = url; setAudioFile(file); setAudioUrl(url);
  }
  useEffect(() => () => {
    controllerRef.current?.abort(); senderRef.current?.stop();
    void microphoneRef.current?.close().catch(() => {});
    if (frameRef.current.url) URL.revokeObjectURL(frameRef.current.url);
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const current = sessionRef.current;
    if (current) void fetch(`${transportBase}/sessions/${current}/stop`, { method: "POST", keepalive: true }).catch(() => {});
  }, [transportBase]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll() {
      try {
        const response = await fetch(`${transportBase}/sessions/${session}/metrics`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`Metrics HTTP ${response.status}`);
        const result = await response.json() as Metrics;
        setMetrics(result);
        if (result.status === "RUNNING") setAudioStatus((current) => current.startsWith("กำลังเตรียม presenter") ? "พร้อมรับเสียงจริง" : current);
        if (result.error) setError(result.error);
        setClientDrops(senderRef.current?.droppedChunks ?? 0);
        if (senderRef.current?.error) { setError(senderRef.current.error.message); setAudioStatus("ส่งเสียงล้มเหลว"); }
        if ((result.frames_generated ?? 0) > frameRef.current.count) {
          const frame = await fetch(`${transportBase}/sessions/${session}/frame`, { cache: "no-store", signal: controller.signal });
          const generated = await readGeneratedFrame(frame, frameRef.current.count);
          if (generated) {
              const url = URL.createObjectURL(generated.blob);
              if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
              const previous = frameRef.current.url;
              frameRef.current = { url, count: generated.count };
              setFrameUrl(url);
              if (previous) URL.revokeObjectURL(previous);
          }
        }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Preview transport failed"); }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(() => { void poll(); }, 800); }
    }
    void poll();
    return () => { controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [session, transportBase]);

  async function check() {
    setAction("check"); setError(null);
    try {
      const result = await (await request("health")).json() as { ready?: boolean; reason?: string; error?: string; backend?: string };
      setHealth(result.ready ? `พร้อม · ${result.backend ?? "real DEV backend"}` : result.reason || result.error || "Backend ยังไม่พร้อม ดู worker diagnostics");
    } catch (cause) { setError(String(cause)); }
    finally { setAction(null); }
  }

  async function start() {
    if (!reference || session || action) return;
    setAction("start"); setError(null); setMetrics(null); setPreviewLoaded(false);
    try {
      if (reference.size > 4 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(reference.type)) throw new Error("เลือก JPEG/PNG ขนาดไม่เกิน 4 MB");
      const stored = await (await request("references", { method: "POST", body: reference, headers: { "Content-Type": reference.type } })).json() as { reference_id: string };
      const created = await (await request("sessions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_id: stored.reference_id, target_fps: fps }) })).json() as { session_id: string };
      sessionRef.current = created.session_id; controllerRef.current = new AbortController();
      senderRef.current = null;
      if (frameRef.current.url) URL.revokeObjectURL(frameRef.current.url);
      frameRef.current = { url: null, count: 0 }; setFrameUrl(null); setClientDrops(0);
      setSession(created.session_id); setAudioStatus("กำลังเตรียม presenter · รอสถานะ RUNNING ก่อนส่งเสียง");
    } catch (cause) { setError(String(cause)); }
    finally { setAction(null); }
  }

  async function sendChunk(current: string, chunk: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
    for (;;) {
      signal.throwIfAborted();
      const response = await fetch(`${transportBase}/sessions/${current}/audio`, { method: "POST", body: chunk.buffer,
        headers: { "Content-Type": "application/octet-stream" }, signal });
      if (response.status === 429) { await cancelledWait(500, signal); continue; }
      if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
      const acknowledgement = await response.json() as { accepted?: boolean };
      if (!acknowledgement.accepted) throw new Error("Worker did not acknowledge real audio");
      return;
    }
  }

  async function loadAudio() {
    const current = sessionRef.current; const signal = controllerRef.current?.signal;
    if (!current || !signal || !audioFile || action || microphone || metrics?.status !== "RUNNING") return;
    setAction("audio"); setError(null); setAudioStatus("กำลังถอดรหัสไฟล์เสียง");
    let decode: AudioContext | null = null;
    try {
      if (audioFile.size > 64 * 1024 * 1024) throw new Error("DEV audio file จำกัด 64 MB");
      const audioBytes = await audioFile.arrayBuffer();
      inspectDevPcmWave(audioBytes);
      signal.throwIfAborted();
      decode = new AudioContext();
      const decoded = await decode.decodeAudioData(audioBytes);
      if (decoded.duration > 600) throw new Error("DEV audio file จำกัด 10 นาทีเพื่อควบคุมหน่วยความจำ");
      signal.throwIfAborted();
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * DEV_AUDIO_RATE), DEV_AUDIO_RATE);
      const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      const mono = (await offline.startRendering()).getChannelData(0);
      for (let offset = 0; offset < mono.length; offset += DEV_AUDIO_CHUNK_SAMPLES) {
        signal.throwIfAborted();
        const response = await request(`sessions/${current}/metrics`, { signal });
        let status = await response.json() as Metrics;
        while ((status.audio_queue_depth ?? status.queue_depth ?? 0) >= 2) {
          if (status.error || status.status === "ERROR") throw new Error(status.error || "Presenter stopped");
          await cancelledWait(500, signal);
          status = await (await request(`sessions/${current}/metrics`, { signal })).json() as Metrics;
        }
        await sendChunk(current, encodeMonoPcm16(mono.subarray(offset, offset + DEV_AUDIO_CHUNK_SAMPLES)), signal);
        setAudioStatus(`รับเสียงแล้ว ${Math.min(mono.length, offset + DEV_AUDIO_CHUNK_SAMPLES) / DEV_AUDIO_RATE} / ${decoded.duration.toFixed(1)} วินาที`);
      }
      setAudioStatus("ส่งไฟล์เสียงครบแล้ว · รอ inference/queue จบ");
    } catch (cause) { if (!signal.aborted) { setError(String(cause)); setAudioStatus("ส่งไฟล์เสียงล้มเหลว"); } }
    finally {
      try { if (decode && decode.state !== "closed") await decode.close(); }
      finally { setAction((previous) => previous === "audio" ? null : previous); }
    }
  }

  async function startMicrophone() {
    const current = sessionRef.current; const signal = controllerRef.current?.signal;
    if (!current || !signal || action || microphone || metrics?.status !== "RUNNING") return;
    setAction("microphone"); setError(null);
    try {
      const sender = new BoundedAudioSender((chunk) => sendChunk(current, chunk, signal)); senderRef.current = sender;
      const capture = await openDevMicrophone(sender);
      if (signal.aborted) { await capture.close(); return; }
      microphoneRef.current = capture; setMicrophone(true); setAudioStatus("กำลังรับ microphone PCM chunks");
    } catch (cause) { senderRef.current?.stop(); setError(String(cause)); }
    finally { setAction((previous) => previous === "microphone" ? null : previous); }
  }

  async function stopMicrophone() {
    const capture = microphoneRef.current;
    microphoneRef.current = null;
    try { await capture?.close(); }
    finally { setMicrophone(false); setAudioStatus("หยุดไมโครโฟนแล้ว · queue ที่ worker กำลังประมวลผล"); }
  }

  async function stop() {
    const current = sessionRef.current;
    if (!current) return;
    setAction("stop"); controllerRef.current?.abort(); senderRef.current?.stop();
    try {
      let captureError: unknown;
      try { await stopMicrophone(); } catch (cause) { captureError = cause; }
      const acknowledgement = await (await request(`sessions/${current}/stop`, { method: "POST" })).json() as Metrics;
      setAudioStatus("กำลังหยุด inference และรอคืนทรัพยากร");
      const final = await waitForDevRelease(acknowledgement, async () => {
        const actual = await (await request(`sessions/${current}/metrics`)).json() as Metrics;
        setMetrics(actual);
        return actual;
      });
      setMetrics(final);
      sessionRef.current = null; setSession(null); setAudioStatus("หยุด session และคืนทรัพยากรแล้ว");
      if (captureError) setError(`Worker หยุดแล้ว แต่ microphone cleanup มีข้อผิดพลาด: ${String(captureError)}`);
    } catch (cause) { setError(String(cause)); }
    finally { setAction(null); }
  }

  return <section className="ai-live-dev ai-live-panel" aria-label="Developer Diagnostics">
    <div className="ai-live-panel-title"><div><p className="eyebrow">DEV / PROOF OF FLOW</p><h2>Developer Diagnostics</h2></div><span className="ai-live-state blocked">CPU proof · ยังไม่ผ่าน production</span></div>
    <p className="ai-live-context-note">เสียงจริง → inference → JPEG ที่สร้างจริง · ผลวัดนี้ใช้ตรวจ flow เท่านั้น</p>
    <div className="ai-live-grid">
      <div>
        <label className="ai-live-field">ภาพ reference<input type="file" accept="image/png,image/jpeg" disabled={!!session || !!action} onChange={(event) => chooseReference(event.target.files?.[0] ?? null)} /></label>
        {referenceUrl && <img className="ai-live-dev-reference" src={referenceUrl} alt="Reference เท่านั้น ยังไม่ใช่ generated preview" />}
        <div className="ai-live-dev-choices">
          <label className="ai-live-field">บัญชีในระบบ<select value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)} disabled={!!session}><option value="">Local proof session</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>
          <label className="ai-live-field">สินค้าเดิม<select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)} disabled={!!session}><option value="">เลือก context สินค้า</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}</select></label>
        </div>
        <p className="ai-live-context-note">บัญชีและสินค้าแสดงข้อมูลเดิมในระบบ การทดสอบเสียงด้านล่างส่งเข้า presenter โดยตรง</p>
        <label className="ai-live-field">Target FPS<select value={fps} onChange={(event) => setFps(Number(event.target.value))} disabled={!!session}>{[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <div className="ai-live-live-actions"><button type="button" className="ai-live-secondary" disabled={!!action} onClick={() => void check()}>ตรวจ DEV backend</button><button type="button" className="ai-live-secondary" disabled={!reference || !!session || !!action} onClick={() => void start()}>Start proof session</button></div>
        <p className="ai-live-help" role="status">{health}</p>
        <label className="ai-live-field">Local audio file<input type="file" accept="audio/wav,.wav" disabled={!!action || microphone} onChange={(event) => chooseAudioFile(event.target.files?.[0] ?? null)} /></label>
        <p className="ai-live-context-note">เลือก WAV PCM16 mono/stereo 16–48 kHz ไม่เกิน 64 MB และ 10 นาที</p>
        {audioUrl && <audio controls src={audioUrl} aria-label="เล่นไฟล์เสียงจริงที่เลือก" />}
        <div className="ai-live-dev-actions"><button type="button" className="ai-live-secondary" disabled={!session || !audioFile || !!action || microphone || metrics?.status !== "RUNNING"} onClick={() => void loadAudio()}>ส่งไฟล์เสียง → Presenter</button><button type="button" className="ai-live-secondary" disabled={!microphone && (!session || !!action || metrics?.status !== "RUNNING")} onClick={() => { if (microphone) void stopMicrophone().catch((cause) => setError(String(cause))); else void startMicrophone(); }}>{microphone ? "หยุดไมโครโฟน" : "เริ่ม microphone chunks"}</button><button type="button" className="ai-live-secondary" disabled={!session || action === "stop"} onClick={() => void stop()}>Stop / release</button></div>
      </div>
      <div>
        <div className="ai-live-stage" aria-label="Generated frame preview">{frameUrl ? <img src={frameUrl} alt="Generated lip-sync frame จากเสียงที่ส่งเข้า presenter" onLoad={() => setPreviewLoaded(true)} onError={() => { setPreviewLoaded(false); setError("Generated JPEG could not be displayed"); }} /> : <div className="ai-live-stage-empty"><strong>รอ generated frame จริง</strong><p>ภาพจะปรากฏเมื่อ inference ผลิต JPEG สำเร็จ</p></div>}</div>
        <dl className="ai-live-delivery-status"><div><dt>Audio receiving</dt><dd>{audioStatus}</dd></div><div><dt>Inference active</dt><dd>{metrics?.inference_active ? "active" : metrics?.status ?? "idle"}</dd></div><div><dt>Frames generated</dt><dd>{metrics?.frames_generated ?? 0}</dd></div><div><dt>Preview</dt><dd>{previewLoaded ? `แสดง frame ${frameRef.current.count}` : metrics?.preview_status ?? "waiting"}</dd></div></dl>
      </div>
    </div>
    <dl className="ai-live-dev-metrics"><div><dt>Presenter backend</dt><dd>{metrics?.backend ?? "—"}</dd></div><div><dt>Average FPS</dt><dd>{measurement(metrics?.average_fps)}</dd></div><div><dt>p50 / p95 latency</dt><dd>{measurement(metrics?.p50_latency_ms, " ms")} / {measurement(metrics?.p95_latency_ms, " ms")}</dd></div><div><dt>CPU / RAM</dt><dd>{measurement(metrics?.cpu_percent, "%")} / {measurement(metrics?.ram_mb, " MB")}</dd></div><div><dt>Audio queue / delay</dt><dd>{metrics?.audio_queue_depth ?? metrics?.queue_depth ?? "—"} / {measurement(metrics?.audio_queue_delay_ms, " ms")}</dd></div><div><dt>Frame drops / browser audio drops</dt><dd>{metrics?.frame_drops ?? "—"} / {clientDrops}</dd></div><div><dt>Session health</dt><dd>{metrics?.status ?? "idle"}</dd></div><div><dt>Encoder/output</dt><dd>{metrics?.encoder ? JSON.stringify(metrics.encoder) : "—"}</dd></div></dl>
    {error && <p className="ai-live-error" role="alert">{error}</p>}
  </section>;
}
