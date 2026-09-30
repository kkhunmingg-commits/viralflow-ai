"use client";

/* The selected reference image is a browser Blob URL. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LocalLiveClient, type LocalMachineView } from "@/features/ai-live/local-client";

type Choice = { id: string; label: string };
type ProductChoice = { id: string; title: string };
type Action = "pair" | "check" | "start" | "stop" | null;

function machineLabel(view: LocalMachineView | null): string {
  if (!view) return "กำลังตรวจสอบ";
  switch (view.state) {
    case "NOT_INSTALLED": return "ต้องติดตั้งส่วนเสริม";
    case "INSTALLING":
    case "STARTING": return "กำลังเตรียม";
    case "READY": return view.canStart ? "พร้อมใช้งาน" : "กำลังเตรียม";
    case "BUSY": return "กำลังใช้งาน";
    case "PAUSED": return "พักชั่วคราว";
    case "STOPPING": return "กำลังหยุด";
    case "OFFLINE": return "เชื่อมต่อเครื่องไม่ได้";
    case "UPDATE_REQUIRED": return "ต้องอัปเดต";
    case "GPU_REQUIRED": return "เครื่องไม่รองรับ";
    case "ERROR": return "ตรวจสอบเครื่องอีกครั้ง";
  }
}

function machineDescription(view: LocalMachineView | null): string {
  if (!view) return "กำลังตรวจหาส่วนเสริม AI LIVE บนเครื่องนี้";
  switch (view.state) {
    case "NOT_INSTALLED": return "ยังไม่พบส่วนเสริม AI LIVE บนเครื่องนี้ ขณะนี้ยังไม่มีไฟล์ติดตั้งให้ดาวน์โหลดจากหน้านี้";
    case "INSTALLING": return "ส่วนเสริมกำลังติดตั้ง กรุณารอสักครู่";
    case "STARTING": return "ส่วนเสริมเชื่อมต่อแล้ว แต่ AI LIVE ยังอยู่ระหว่างการเตรียมความพร้อม";
    case "READY": return view.canStart ? "พร้อมสำหรับ AI LIVE" : "เชื่อมต่อเครื่องแล้ว แต่ AI LIVE ยังไม่พร้อมเริ่มถ่ายทอดสด";
    case "BUSY": return "เครื่องนี้กำลังใช้งาน AI LIVE";
    case "PAUSED": return "การใช้งานถูกพักไว้ คุณสามารถหยุดไลฟ์ได้";
    case "STOPPING": return "กำลังหยุดการใช้งานบนเครื่องนี้";
    case "OFFLINE": return "ติดต่อส่วนเสริมบนเครื่องไม่ได้ กรุณาเปิดส่วนเสริมแล้วลองตรวจสอบอีกครั้ง";
    case "UPDATE_REQUIRED": return "ส่วนเสริมบนเครื่องต้องอัปเดตก่อนจึงจะใช้งาน AI LIVE ได้";
    case "GPU_REQUIRED": return "เครื่องนี้ยังไม่รองรับ AI LIVE";
    case "ERROR": return "ตรวจสอบความพร้อมของเครื่องไม่สำเร็จ กรุณาลองอีกครั้ง";
  }
}

export function LivePresenterConsole({ accounts, products }: { accounts: Choice[]; products: ProductChoice[] }) {
  const [machine, setMachine] = useState<LocalMachineView | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [presenter, setPresenter] = useState<File | null>(null);
  const [presenterPreview, setPresenterPreview] = useState<string | null>(null);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [microphoneLabel, setMicrophoneLabel] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clientRef = useRef<LocalLiveClient | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const requestQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const requestControllerRef = useRef<AbortController | null>(null);
  const presenterUrlRef = useRef<string | null>(null);

  // Polling and user actions use the same queue, so only one local request runs at a time.
  const requestMachine = useCallback((operation: (client: LocalLiveClient, signal: AbortSignal) => Promise<LocalMachineView>) => {
    const generation = generationRef.current;
    const request = requestQueueRef.current.catch(() => undefined).then(async () => {
      if (!mountedRef.current || generation !== generationRef.current || !clientRef.current) return null;
      const controller = new AbortController();
      requestControllerRef.current = controller;
      try {
        const result = await operation(clientRef.current, controller.signal);
        if (mountedRef.current && generation === generationRef.current) setMachine(result);
        return result;
      } finally {
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
      }
    });
    requestQueueRef.current = request.catch(() => undefined);
    return request;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    clientRef.current = new LocalLiveClient();
    let timer: number | null = null;
    const poll = async () => {
      try { await requestMachine((client, signal) => client.discover(signal)); }
      catch { /* A later poll may recover after the companion restarts. */ }
      finally {
        if (mountedRef.current && generation === generationRef.current) {
          timer = window.setTimeout(() => { void poll(); }, 4_000);
        }
      }
    };
    void poll();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (timer !== null) window.clearTimeout(timer);
      requestControllerRef.current?.abort();
      clientRef.current?.dispose();
      clientRef.current = null;
      if (presenterUrlRef.current) URL.revokeObjectURL(presenterUrlRef.current);
      presenterUrlRef.current = null;
    };
  }, [requestMachine]);

  function choosePresenter(file: File | null) {
    if (file && (!["image/jpeg", "image/png"].includes(file.type) || file.size > 4 * 1024 * 1024)) {
      setError("กรุณาเลือกภาพ JPEG หรือ PNG ขนาดไม่เกิน 4 MB");
      file = null;
    } else setError(null);
    if (presenterUrlRef.current) URL.revokeObjectURL(presenterUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    presenterUrlRef.current = url;
    setPresenter(file);
    setPresenterPreview(url);
  }

  async function chooseMicrophone() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
      setError("เบราว์เซอร์นี้ยังไม่สามารถเลือกไมโครโฟนได้");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      // The user requests permission here. No audio is retained or uploaded.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const choices = devices.filter((device) => device.kind === "audioinput" && device.deviceId);
      const defaultDevice = choices.find((device) => device.deviceId === "default") ?? choices[0];
      setMicrophoneReady(!!defaultDevice);
      setMicrophoneLabel(defaultDevice?.label || (defaultDevice ? "ไมโครโฟนเริ่มต้นของเครื่อง" : ""));
      if (!defaultDevice) setError("ไม่พบไมโครโฟนที่ใช้งานได้");
    } catch {
      setMicrophoneReady(false);
      setMicrophoneLabel("");
      setError("ไม่สามารถใช้ไมโครโฟนได้ กรุณาอนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง");
    } finally { stream?.getTracks().forEach((track) => track.stop()); }
  }

  async function pairMachine() {
    const code = pairCode.trim();
    if (!code || action) return;
    setAction("pair"); setError(null);
    try {
      const result = await requestMachine((client, signal) => client.pair(code, signal));
      if (result) { setPairCode(""); setNotice("เชื่อมต่อส่วนเสริมบนเครื่องแล้ว"); }
    } catch { if (mountedRef.current) setError("เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบรหัสจากส่วนเสริมแล้วลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function checkMachine() {
    if (action) return;
    setAction("check"); setError(null); setNotice(null);
    try { await requestMachine((client, signal) => machine?.paired ? client.checkHardware(signal) : client.discover(signal)); }
    catch { if (mountedRef.current) setError("ตรวจสอบเครื่องไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function startLive() {
    if (action || !machine?.canStart || !selectedAccount || !selectedProduct || !presenter || !microphoneReady) return;
    setAction("start"); setError(null);
    try {
      await requestMachine((client, signal) => client.start({
        accountId: selectedAccount, productIds: [selectedProduct], presenter, microphoneId: "default",
      }, signal));
    } catch { if (mountedRef.current) setError("เริ่ม AI LIVE ไม่สำเร็จ กรุณาตรวจสอบเครื่องแล้วลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function stopLive() {
    if (action || !machine?.sessionActive) return;
    setAction("stop"); setError(null);
    try { await requestMachine((client, signal) => client.stop(signal)); }
    catch { if (mountedRef.current) setError("หยุด AI LIVE ไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  const showPairing = machine && !machine.paired && !["NOT_INSTALLED", "OFFLINE", "INSTALLING", "UPDATE_REQUIRED"].includes(machine.state);
  const canStart = !!machine?.canStart && !machine.sessionActive && !action && !!selectedAccount && !!selectedProduct && !!presenter && microphoneReady;

  return <div className="ai-live-page">
    <header className="ai-live-hero">
      <div><p className="eyebrow">VIRALFLOW / AI LIVE</p><h1>AI LIVE</h1><p>เลือกบัญชี พรีเซนเตอร์ และสินค้า แล้วตรวจสอบความพร้อมของเครื่องก่อนเริ่ม</p></div>
      <span className={`ai-live-state ${machine?.canStart ? "ready" : "blocked"}`} role="status" aria-live="polite">{machineLabel(machine)}</span>
    </header>

    <div className="ai-live-grid">
      <section className="ai-live-panel ai-live-setup" aria-label="เตรียม AI LIVE">
        <div className="ai-live-panel-title"><h2>เตรียมไลฟ์</h2></div>
        <label className="ai-live-field">บัญชี TikTok
          <select value={selectedAccount} disabled={!!machine?.sessionActive} onChange={(event) => setSelectedAccount(event.target.value)}>
            <option value="">เลือกบัญชี</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
        </label>
        {accounts.length === 0 && <p className="ai-live-help">ยังไม่มีบัญชีที่เชื่อมต่อ <Link href="/accounts">ดูบัญชี TikTok</Link></p>}
        <label className="ai-live-field">พรีเซนเตอร์
          <input type="file" accept="image/jpeg,image/png" disabled={!!machine?.sessionActive} onChange={(event) => choosePresenter(event.target.files?.[0] ?? null)} />
          <small>เลือกภาพที่คุณมีสิทธิใช้งาน ขนาดไม่เกิน 4 MB</small>
        </label>
        <label className="ai-live-field">สินค้า
          <select value={selectedProduct} disabled={!!machine?.sessionActive} onChange={(event) => setSelectedProduct(event.target.value)}>
            <option value="">เลือกสินค้า</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
          </select>
        </label>
        {products.length === 0 && <p className="ai-live-help">ยังไม่มีสินค้าให้เลือก</p>}
        <div className="ai-live-field"><span>ไมโครโฟน</span>
          <div className="ai-live-microphone-row">
            <span className="ai-live-microphone-name">{microphoneReady ? microphoneLabel : "ยังไม่ได้ตรวจสอบไมโครโฟน"}</span>
            <button type="button" className="ai-live-secondary" disabled={!!machine?.sessionActive} onClick={() => void chooseMicrophone()}>{microphoneReady ? "ตรวจสอบอีกครั้ง" : "ตรวจสอบไมโครโฟน"}</button>
          </div><small>ระบบจะใช้ไมโครโฟนเริ่มต้นของเครื่อง และขอสิทธิ์เมื่อคุณกดตรวจสอบเท่านั้น</small>
        </div>
        <div className="ai-live-live-actions">
          <button className="primary-action" type="button" disabled={!canStart} onClick={() => void startLive()}>{action === "start" ? "กำลังเริ่ม..." : "เริ่มไลฟ์"}</button>
          <button className="danger-action" type="button" disabled={!machine?.sessionActive || !!action} onClick={() => void stopLive()}>{action === "stop" ? "กำลังหยุด..." : "หยุดไลฟ์"}</button>
        </div>
        {!machine?.canStart && <p className="ai-live-context-note">AI LIVE จะเปิดให้เริ่มได้เมื่อส่วนเสริมและเครื่องผ่านการตรวจสอบครบถ้วน</p>}
      </section>

      <div className="ai-live-side">
        <section className="ai-live-panel ai-live-machine" aria-label="สถานะเครื่อง">
          <div className="ai-live-panel-title"><h2>สถานะเครื่อง</h2><span className={`ai-live-machine-dot ${machine?.canStart ? "ready" : ""}`} aria-hidden="true" /></div>
          <strong className="ai-live-machine-status" aria-live="polite">{machineLabel(machine)}</strong>
          <p className="ai-live-machine-description">{machineDescription(machine)}</p>
          {!!machine?.reasons.length && <ul className="ai-live-machine-reasons">{[...new Set(machine.reasons)].map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          {showPairing && <div className="ai-live-pairing">
            <label className="ai-live-field">รหัสเชื่อมต่อจากส่วนเสริมบนเครื่อง
              <input type="text" autoComplete="one-time-code" value={pairCode} disabled={!!action} onChange={(event) => setPairCode(event.target.value)} placeholder="กรอกรหัสที่แสดงในส่วนเสริม" />
            </label>
            <button type="button" className="ai-live-secondary" disabled={!pairCode.trim() || !!action} onClick={() => void pairMachine()}>{action === "pair" ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อเครื่อง"}</button>
            <p className="ai-live-context-note">เปิดส่วนเสริม ViralFlow บนเครื่องนี้เพื่อดูรหัส แล้วเชื่อมต่อก่อนตรวจสอบเครื่อง ไม่ต้องเปิดหน้าคำสั่ง</p>
          </div>}
          <div className="ai-live-machine-actions">
            <button type="button" className="ai-live-secondary" disabled={!!action} onClick={() => void checkMachine()}>{action === "check" ? "กำลังตรวจสอบ..." : "ตรวจสอบเครื่อง"}</button>
            <p>หากเบราว์เซอร์ถาม ให้ยอมให้หน้านี้เชื่อมต่อส่วนเสริมบนเครื่อง</p>
          </div>
          {notice && machine?.paired && <p className="ai-live-notice" role="status">{notice}</p>}
          {error && <p className="ai-live-error" role="alert">{error}</p>}
        </section>
        <section className="ai-live-panel ai-live-preview" aria-label="ภาพพรีเซนเตอร์ที่เลือก">
          <div className="ai-live-panel-title"><h2>ภาพพรีเซนเตอร์</h2><span className="ai-live-preview-state">ภาพอ้างอิง</span></div>
          <div className="ai-live-stage">
            {presenterPreview ? <img src={presenterPreview} alt="ภาพพรีเซนเตอร์ที่เลือก ยังไม่ใช่ภาพสด" />
              : <div className="ai-live-stage-empty"><span>✦</span><strong>เลือกภาพพรีเซนเตอร์</strong><p>ภาพที่เลือกจะแสดงตรงนี้</p></div>}
            {presenterPreview && <span className="ai-live-stage-tag">ภาพที่เลือก · ยังไม่ใช่ภาพสด</span>}
          </div>
        </section>
      </div>
    </div>
    <section className="ai-live-summary" aria-label="สถานะไลฟ์" aria-live="polite">
      <div><span>สถานะตอนนี้</span><strong>{machine?.state === "ERROR" && machine.sessionActive ? "ต้องตรวจสอบหรือหยุดไลฟ์" : machine?.state === "PAUSED" ? "พักไลฟ์ชั่วคราว" : machine?.sessionActive ? "กำลังใช้งาน AI LIVE" : "ยังไม่เริ่มไลฟ์"}</strong></div>
      <div><span>บัญชีที่เลือก</span><strong>{accounts.find((account) => account.id === selectedAccount)?.label ?? "ยังไม่ได้เลือกบัญชี"}</strong></div>
      <div><span>สินค้าที่เลือก</span><strong>{products.find((product) => product.id === selectedProduct)?.title ?? "ยังไม่ได้เลือกสินค้า"}</strong></div>
    </section>
  </div>;
}
