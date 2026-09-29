"use client";

/* MJPEG streams and local Blob reference URLs cannot use Next image optimization. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";

type Choice = { id: string; label: string };
type ProductChoice = { id: string; title: string };
type Health = {
  ready: boolean;
  blockers?: string[];
  python?: { version?: string };
  gpu?: { nvidia_name?: string | null; cuda_available?: boolean; cuda_device?: string | null };
  ffmpeg?: { available?: boolean; nvenc_usable?: boolean };
  musetalk?: { models_available?: boolean; streaming_backend_available?: boolean };
  liveportrait?: { optional_candidate_available?: boolean };
};
type Metrics = { status: string; fps: number; latency_ms: number | null; queue_depth: number; frames_generated: number };

function statusLabel(value: boolean | undefined) { return value === undefined ? "ยังไม่ทราบ" : value ? "พร้อม" : "ยังไม่พร้อม"; }

export function LivePresenterConsole({ accounts, products }: { accounts: Choice[]; products: ProductChoice[] }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [targetFps, setTargetFps] = useState(20);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const audioRef = useRef<{ stream: MediaStream; context?: AudioContext; node?: AudioWorkletNode } | null>(null);
  const sessionRef = useRef<string | null>(null);
  const audioPendingRef = useRef(0);
  const referenceUrlRef = useRef<string | null>(null);
  const activeRef = useRef(false);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/ai-live/health", { cache: "no-store" });
      setHealth(await response.json() as Health);
    } catch { setHealth({ ready: false, blockers: ["HEALTH_CHECK_UNREACHABLE"] }); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/ai-live/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: Health) => { if (mounted) setHealth(result); })
      .catch(() => { if (mounted) setHealth({ ready: false, blockers: ["HEALTH_CHECK_UNREACHABLE"] }); });
    return () => {
      mounted = false;
      if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    };
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const leave = () => {
      activeRef.current = false;
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        if (audio.node) {
          audio.node.port.onmessage = null;
          audio.node.disconnect();
        }
        audio.stream.getTracks().forEach((track) => track.stop());
        if (audio.context) void audio.context.close();
      }
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void fetch(`/api/ai-live/sessions/${id}/stop`, { method: "POST", keepalive: true }).catch(() => {});
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  function chooseReference(file: File | null) {
    if (file && (!(["image/jpeg", "image/png"].includes(file.type)) || file.size > 4 * 1024 * 1024)) {
      setError("กรุณาเลือกภาพ JPEG/PNG ขนาดไม่เกิน 4 MB");
      file = null;
    } else {
      setError(null);
    }
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    referenceUrlRef.current = url;
    setReference(file);
    setReferencePreview(url);
  }
  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/ai-live/sessions/${sessionId}/metrics`, { cache: "no-store" });
        if (response.ok && mounted) {
          const next = await response.json() as Metrics & { error?: string; stop_reason?: string };
          if (!mounted) return;
          setMetrics(next);
          if (next.status === "FAILED" || next.status === "STOPPED") {
            releaseAudio();
            sessionRef.current = null;
            setSessionId(null);
            setError(next.error ?? next.stop_reason ?? `Presenter ${next.status}`);
          }
        }
      } catch { /* The next poll may recover after a transient worker disconnect. */ }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 1000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    // Rotate the streaming request before a serverless function can hold it indefinitely.
    const timer = window.setInterval(() => {
      setPreviewError(false);
      setPreviewEpoch((value) => value + 1);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  function releaseAudio() {
    const current = audioRef.current;
    audioRef.current = null;
    if (!current) return;
    if (current.node) {
      current.node.port.onmessage = null;
      current.node.disconnect();
    }
    current.stream.getTracks().forEach((track) => track.stop());
    if (current.context) void current.context.close();
  }

  async function stopPresenter() {
    setBusy(true);
    const id = sessionRef.current;
    sessionRef.current = null;
    releaseAudio();
    try {
      if (id) {
        const response = await fetch(`/api/ai-live/sessions/${id}/stop`, { method: "POST" });
        if (!response.ok) setError("หยุด presenter ใน worker ไม่สำเร็จ กรุณาตรวจ worker");
      }
    } catch { setError("ติดต่อ worker เพื่อหยุด presenter ไม่สำเร็จ"); }
    setSessionId(null);
    setMetrics(null);
    setBusy(false);
    void refreshHealth();
  }

  async function startPresenter() {
    if (!reference || !health?.ready || busy) return;
    setBusy(true);
    setError(null);
    setPreviewError(false);
    let createdSession: string | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      audioRef.current = { stream };
      if (!activeRef.current) throw new Error("PRESENTER_SESSION_CLOSED");
      const context = new AudioContext();
      audioRef.current.context = context;
      await context.audioWorklet.addModule("/ai-live-audio-worklet.js");
      if (!activeRef.current || !audioRef.current) throw new Error("PRESENTER_SESSION_CLOSED");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "viralflow-pcm-worklet");
      audioRef.current.node = node;
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const id = sessionRef.current;
        if (!id || audioPendingRef.current >= 4) return;
        audioPendingRef.current += 1;
        void fetch(`/api/ai-live/sessions/${id}/audio`, {
          method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: event.data,
        }).then((response) => {
          if (!response.ok) setError("ส่งเสียงไปยัง presenter ไม่สำเร็จ กรุณาหยุดและตรวจ worker");
        }).catch(() => setError("การเชื่อมต่อเสียงกับ worker ขาดหาย")).finally(() => { audioPendingRef.current -= 1; });
      };

      const uploaded = await fetch("/api/ai-live/references", {
        method: "POST", headers: { "Content-Type": reference.type }, body: reference,
      });
      if (!activeRef.current) throw new Error("PRESENTER_SESSION_CLOSED");
      const imageResult = await uploaded.json() as { reference_id?: string; error?: string };
      if (!uploaded.ok || !imageResult.reference_id) throw new Error(imageResult.error ?? "REFERENCE_UPLOAD_FAILED");

      const started = await fetch("/api/ai-live/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference_id: imageResult.reference_id, target_fps: targetFps }),
      });
      const result = await started.json() as { session_id?: string; error?: string };
      if (!started.ok || !result.session_id) throw new Error(result.error ?? "PRESENTER_START_FAILED");
      createdSession = result.session_id;
      if (!activeRef.current) throw new Error("PRESENTER_SESSION_CLOSED");
      sessionRef.current = createdSession;
      source.connect(node);
      node.connect(context.destination);
      await context.resume();
      if (!activeRef.current) throw new Error("PRESENTER_SESSION_CLOSED");
      setSessionId(createdSession);
    } catch (cause) {
      releaseAudio();
      sessionRef.current = null;
      if (createdSession) void fetch(`/api/ai-live/sessions/${createdSession}/stop`, { method: "POST" });
      setError(cause instanceof Error ? cause.message : "เริ่ม presenter ไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  return <div className="ai-live-page">
    <header className="ai-live-hero">
      <div><p className="eyebrow">VIRALFLOW / AI LIVE · LIVE-1</p><h1>Presenter Studio</h1><p>เสียงจากไมโครโฟน → lip-sync แบบต่อเนื่อง → preview สด โดยยังไม่เชื่อม TikTok LIVE</p></div>
      <span className={`ai-live-state ${health?.ready ? "ready" : "blocked"}`}>{health === null ? "กำลังตรวจ" : health.ready ? "WORKER READY" : "SETUP REQUIRED"}</span>
    </header>

    <div className="ai-live-grid">
      <section className="ai-live-panel ai-live-setup" aria-label="Presenter controls">
        <div className="ai-live-panel-title"><div><p className="eyebrow">PRESENTER ENGINE</p><h2>ตั้งค่าพรีเซนเตอร์</h2></div><span className="phase-chip">LIVE-1</span></div>
        <label className="ai-live-field">Presenter reference
          <input type="file" accept="image/jpeg,image/png" disabled={busy || !!sessionId} onChange={(event) => chooseReference(event.target.files?.[0] ?? null)} />
          <small>ภาพ JPEG/PNG ที่คุณมีสิทธิใช้งาน ไม่เกิน 4 MB</small>
        </label>
        <div className="ai-live-context-grid">
          <label className="ai-live-field">บัญชี TikTok ใน ViralFlow
            <select value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)}>
              <option value="">ยังไม่เลือกบัญชี</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          </label>
          <label className="ai-live-field">สินค้าใน ViralFlow
            <select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}>
              <option value="">ยังไม่เลือกสินค้า</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
            </select>
          </label>
        </div>
        <p className="ai-live-context-note">การเลือกบัญชีและสินค้าเป็นบริบทสำหรับ AI LIVE ระยะต่อไป LIVE-1 ไม่ส่งภาพหรือเสียงไป TikTok และไม่ใช้ token บัญชี</p>
        <label className="ai-live-field ai-live-fps">Target FPS
          <select value={targetFps} disabled={busy || !!sessionId} onChange={(event) => setTargetFps(Number(event.target.value))}>
            {[15, 20, 24, 30].map((fps) => <option value={fps} key={fps}>{fps} FPS</option>)}
          </select>
        </label>
        <div className="ai-live-actions">
          <button className="primary-action" type="button" disabled={!reference || !health?.ready || busy || !!sessionId} onClick={() => void startPresenter()}>{busy && !sessionId ? "กำลังเริ่ม..." : "Start Presenter"}</button>
          <button className="danger-action" type="button" disabled={!sessionId || busy} onClick={() => void stopPresenter()}>Stop Presenter</button>
        </div>
        {error && <p className="ai-live-error" role="alert">{error}</p>}
        {!health?.ready && <p className="ai-live-warning" role="status">Presenter ยังเริ่มไม่ได้: {health?.blockers?.join(", ") || "กำลังตรวจความพร้อมของ worker"}</p>}
      </section>

      <section className="ai-live-panel ai-live-preview" aria-label="Live presenter preview">
        <div className="ai-live-panel-title"><div><p className="eyebrow">LIVE PREVIEW</p><h2>ภาพพรีเซนเตอร์</h2></div><span className="phase-chip">{sessionId ? "STREAMING" : "OFFLINE"}</span></div>
        <div className="ai-live-stage">
          {sessionId && !previewError ? <img src={`/api/ai-live/sessions/${sessionId}/preview?stream=${previewEpoch}`} alt="ภาพพรีเซนเตอร์จาก worker แบบสด" onError={() => setPreviewError(true)} />
            : referencePreview ? <img src={referencePreview} alt="ภาพอ้างอิงที่เลือก ยังไม่ใช่ภาพ live" />
              : <div className="ai-live-stage-empty"><span>LV</span><strong>ยังไม่มีภาพจาก Presenter</strong><p>เลือกภาพอ้างอิงและเชื่อม worker ที่พร้อมใช้งานเพื่อเริ่ม preview</p></div>}
          {referencePreview && !sessionId && <span className="ai-live-stage-tag">REFERENCE IMAGE · ไม่ใช่ภาพสด</span>}
          {previewError && <span className="ai-live-stage-tag error">PREVIEW DISCONNECTED</span>}
        </div>
        <div className="ai-live-metrics" aria-label="Presenter metrics">
          <div><span>Actual FPS</span><strong>{metrics?.fps ?? "—"}</strong></div>
          <div><span>Latency</span><strong>{metrics?.latency_ms == null ? "—" : `${Math.round(metrics.latency_ms)} ms`}</strong></div>
          <div><span>Audio queue</span><strong>{metrics?.queue_depth ?? "—"}</strong></div>
          <div><span>Frames</span><strong>{metrics?.frames_generated ?? "—"}</strong></div>
        </div>
      </section>
    </div>

    <section className="ai-live-panel ai-live-readiness"><div className="ai-live-panel-title"><div><p className="eyebrow">RUNTIME READINESS</p><h2>สถานะ Worker จริง</h2></div><button className="secondary-action" onClick={() => void refreshHealth()}>ตรวจอีกครั้ง</button></div>
      <div className="ai-live-readiness-grid">
        <div><span>Python</span><strong>{health?.python?.version ?? "—"}</strong></div>
        <div><span>GPU</span><strong>{health?.gpu ? (health.gpu.cuda_device ?? health.gpu.nvidia_name ?? "ไม่พบ NVIDIA") : "ยังไม่ทราบ"}</strong></div>
        <div><span>CUDA</span><strong>{statusLabel(health?.gpu?.cuda_available)}</strong></div>
        <div><span>FFmpeg</span><strong>{statusLabel(health?.ffmpeg?.available)}</strong></div>
        <div><span>NVENC</span><strong>{statusLabel(health?.ffmpeg?.nvenc_usable)}</strong></div>
        <div><span>MuseTalk + models</span><strong>{statusLabel(health?.musetalk?.models_available && health?.musetalk?.streaming_backend_available)}</strong></div>
        <div><span>LivePortrait</span><strong>{health?.liveportrait?.optional_candidate_available ? "ติดตั้งแล้ว (ทางเลือก)" : "ยังไม่ติดตั้ง"}</strong></div>
      </div>
      <p className="ai-live-roadmap">ขั้นต่อไป: Chat → AI Brain → TTS → Presenter → Encoder → TikTok LIVE ทั้งหมดนี้ยังไม่เปิดใช้งานใน LIVE-1</p>
    </section>
  </div>;
}
