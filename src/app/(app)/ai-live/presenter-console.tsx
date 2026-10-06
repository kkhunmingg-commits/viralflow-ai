"use client";

/* The selected reference image is a browser Blob URL. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { LocalLiveClient, type LocalMachineView, type LocalPresenterCard } from "@/features/ai-live/local-client";
import { customerRoomRuntime, machineForAccount, type CustomerRoomRuntime } from "@/features/ai-live/customer-room-view";
import { PassivePresenterRequests } from "@/features/ai-live/passive-presenter-requests";
import { customerConnectionQuality, customerLiveStatus } from "@/features/ai-live/customer-stream-status";
import { AI_LIVE_REALTIME_VALIDATED } from "@/features/ai-live/local-contract";

type Choice = { id: string; label: string };
type ProductChoice = { id: string; title: string };
type Action = "pair" | "check" | "register" | "revoke" | "update-check" | "update" | "repair" | "configure" | "prepare" | "start" | "stop" | "pause" | "resume" | null;

export interface PresenterConsoleHandle {
  start(): Promise<void>;
  stop(accountId?: string): Promise<void>;
  check(): Promise<void>;
  pause(accountId?: string): Promise<void>;
  resume(accountId?: string): Promise<void>;
  preview(): void;
  loadReference(file: File | null): void;
  listPresenters(): Promise<LocalPresenterCard[]>;
  savePresenter(input: { id?: string; name: string; voiceLabel: string; assignedAccountIds: string[]; consentConfirmed: boolean; reference?: File }): Promise<LocalPresenterCard>;
  deletePresenter(id: string): Promise<void>;
  presenterReference(id: string): Promise<File>;
  presenterThumbnail(id: string, signal: AbortSignal): Promise<File>;
}

function machineLabel(view: LocalMachineView | null): string {
  if (!view) return "กำลังตรวจสอบ";
  if (view.membershipStatus === "UNSUPPORTED") return "สมาชิกไม่รองรับ AI LIVE";
  if (view.updateStatus === "UPDATING") return "กำลังอัปเดตส่วนเสริม";
  if (view.updateStatus === "RESTART_REQUIRED") return "เปิดส่วนเสริมใหม่";
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
    case "NOT_INSTALLED": return "ยังไม่พบส่วนเสริม AI LIVE บนเครื่องนี้ ติดตั้งส่วนเสริมแล้วเปิดเพื่อเชื่อมกับบัญชีของคุณ";
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

export function LivePresenterConsole({ accounts, products, accountId, productId, productIds, onReferenceChange, onProductChange, onAccountChange, onRuntimeChange, controlsRef, embedded = false }: {
  accounts: Choice[]; products: ProductChoice[]; accountId?: string; productId?: string; productIds?: string[];
  onProductChange?: (productId: string) => void;
  onReferenceChange?: (reference: File | null) => void;
  onAccountChange?: (accountId: string) => void; onRuntimeChange?: (runtime: CustomerRoomRuntime) => void;
  controlsRef?: Ref<PresenterConsoleHandle>; embedded?: boolean;
}) {
  const [machine, setMachine] = useState<LocalMachineView | null>(null);
  const [internalAccount, setInternalAccount] = useState("");
  const selectedAccount = accountId ?? internalAccount;
  const selectedMachine = machineForAccount(machine, selectedAccount);
  const accountSelectionReady = accounts.some((account) => account.id === selectedAccount);
  const [internalProduct, setInternalProduct] = useState("");
  const selectedProduct = productId ?? internalProduct;
  const selectedProductIds = useMemo(() => productIds ?? (selectedProduct ? [selectedProduct] : []), [productIds, selectedProduct]);
  const productSelectionReady = selectedProductIds.length > 0 && selectedProductIds.length <= 10
    && new Set(selectedProductIds).size === selectedProductIds.length
    && selectedProductIds.every((id) => products.some((product) => product.id === id));
  const [presenter, setPresenter] = useState<File | null>(null);
  const [presenterPreview, setPresenterPreview] = useState<string | null>(null);
  const [systemPreview, setSystemPreview] = useState<string | null>(null);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [microphoneLabel, setMicrophoneLabel] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [action, setActionState] = useState<Action>(null);
  const [passivePresenterReads] = useState(() => new PassivePresenterRequests());
  const setAction = useCallback((next: Action) => {
    // Session controls never wait for an image read, even before React commits the UI.
    if (next !== null) passivePresenterReads.suspend();
    setActionState(next);
  }, [passivePresenterReads]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clientRef = useRef<LocalLiveClient | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const requestQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const requestControllerRef = useRef<AbortController | null>(null);
  const presenterUrlRef = useRef<string | null>(null);
  const systemPreviewUrlRef = useRef<string | null>(null);
  const previewElement = useRef<HTMLElement | null>(null);
  const automaticPreparationAttemptedRef = useRef(false);
  const previewEnabled = AI_LIVE_REALTIME_VALIDATED && !!selectedMachine?.paired && !!selectedMachine.sessionActive
    && selectedMachine.deviceAuthorized && action !== "stop" && !["STOPPING", "OFFLINE", "ERROR"].includes(selectedMachine.state);

  // Polling and user actions use the same queue, so only one local request runs at a time.
  const requestMachine = useCallback((operation: (client: LocalLiveClient, signal: AbortSignal) => Promise<LocalMachineView>) => {
    const generation = generationRef.current;
    const request = requestQueueRef.current.catch(() => undefined).then(async () => {
      if (!mountedRef.current || generation !== generationRef.current || !clientRef.current) return null;
      const controller = new AbortController();
      requestControllerRef.current = controller;
      try {
        const result = await operation(clientRef.current, controller.signal);
        if (!result.paired || !result.deviceAuthorized || result.membershipStatus !== "SUPPORTED" || result.sessionActive) passivePresenterReads.suspend();
        if (mountedRef.current && generation === generationRef.current) setMachine(result);
        return result;
      } finally {
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
      }
    });
    requestQueueRef.current = request.catch(() => undefined);
    return request;
  }, [passivePresenterReads]);

  const passiveReadsEnabled = !!machine?.paired && machine.deviceAuthorized && machine.membershipStatus === "SUPPORTED"
    && !machine.sessionActive && !action && !["UPDATE_REQUIRED", "OFFLINE", "ERROR"].includes(machine.state);
  useEffect(() => {
    passivePresenterReads.setEnabled(passiveReadsEnabled);
    return () => passivePresenterReads.suspend();
  }, [passiveReadsEnabled, passivePresenterReads]);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    clientRef.current = new LocalLiveClient();
    let timer: number | null = null;
    const poll = async () => {
      try { await requestMachine(async (client, signal) => {
        const next = await client.refresh(signal);
        if (!next.paired || next.state === "UPDATE_REQUIRED") return next;
        await client.checkComponents(signal);
        return client.refreshRooms(signal);
      }); }
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
      passivePresenterReads.suspend();
      clientRef.current?.dispose();
      clientRef.current = null;
      if (presenterUrlRef.current) URL.revokeObjectURL(presenterUrlRef.current);
      presenterUrlRef.current = null;
    };
  }, [requestMachine, passivePresenterReads]);

  const prepareMachine = useCallback(async (repair = false) => {
    if (action || !machine?.paired || !machine.deviceAuthorized || machine.membershipStatus !== "SUPPORTED"
      || machine.sessionActive || !machine.components?.canPrepare
      || !accountSelectionReady || !productSelectionReady) return;
    automaticPreparationAttemptedRef.current = true;
    setAction("prepare"); setError(null); setNotice(null);
    try {
      await requestMachine((client, signal) => client.prepareComponents({ accountId: selectedAccount, productIds: selectedProductIds }, repair, signal));
    } catch {
      if (mountedRef.current) setError("ยังเตรียมเครื่องไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วกดเตรียมเครื่องอีกครั้ง");
    } finally { if (mountedRef.current) setAction(null); }
  }, [action, machine, requestMachine, selectedAccount, accountSelectionReady, productSelectionReady, selectedProductIds, setAction]);

  useEffect(() => {
    if (automaticPreparationAttemptedRef.current || action || !machine?.paired || !machine.deviceAuthorized
      || machine.membershipStatus !== "SUPPORTED" || machine.sessionActive
      || machine.components?.state !== "NOT_CONFIGURED" || !machine.components.canPrepare || !accountSelectionReady || !productSelectionReady) return;
    const timer = window.setTimeout(() => { void prepareMachine(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [action, machine, prepareMachine, accountSelectionReady, productSelectionReady]);

  useEffect(() => {
    if (!previewEnabled) return;
    const controller = new AbortController();
    let timer: number | null = null;
    const poll = async () => {
      try {
        const frame = await clientRef.current?.previewAccountFrame(selectedAccount, controller.signal);
        if (controller.signal.aborted || !mountedRef.current) return;
        if (!frame) return;
        const url = URL.createObjectURL(frame);
        if (systemPreviewUrlRef.current) URL.revokeObjectURL(systemPreviewUrlRef.current);
        systemPreviewUrlRef.current = url;
        setSystemPreview(url);
      } catch {
        if (!controller.signal.aborted && mountedRef.current) {
          if (systemPreviewUrlRef.current) URL.revokeObjectURL(systemPreviewUrlRef.current);
          systemPreviewUrlRef.current = null;
          setSystemPreview(null);
        }
      } finally {
        // Schedule after completion so slow requests never overlap or build a queue.
        if (!controller.signal.aborted && mountedRef.current) timer = window.setTimeout(() => { void poll(); }, 500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      if (systemPreviewUrlRef.current) URL.revokeObjectURL(systemPreviewUrlRef.current);
      systemPreviewUrlRef.current = null;
      if (mountedRef.current) setSystemPreview(null);
    };
  }, [previewEnabled, selectedAccount]);

  function choosePresenter(file: File | null, notify = true) {
    if (file && (!["image/jpeg", "image/png"].includes(file.type) || file.size > 4 * 1024 * 1024)) {
      setError("กรุณาเลือกภาพ JPEG หรือ PNG ขนาดไม่เกิน 4 MB");
      file = null;
    } else setError(null);
    if (presenterUrlRef.current) URL.revokeObjectURL(presenterUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    presenterUrlRef.current = url;
    setPresenter(file);
    setPresenterPreview(url);
    if (notify) onReferenceChange?.(file);
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
    try { await requestMachine(async (client, signal) => {
      const result = machine?.paired ? await client.checkHardware(signal) : await client.discover(signal);
      if (result.deviceAuthorized && presenter && accountSelectionReady && productSelectionReady) {
        await client.prepareAI(signal, { accountId: selectedAccount, productIds: selectedProductIds,
          presenter, microphoneId: microphoneReady ? "default" : null });
      }
      return client.snapshot();
    }); }
    catch { if (mountedRef.current) setError("ตรวจสอบเครื่องไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function startLive() {
    if (action || !machine?.canStart || !accountSelectionReady
      || selectedMachine?.sessionActive || machine.capacity?.status !== "VERIFIED" || !machine.capacity.canStartAnotherRoom
      || !productSelectionReady || !presenter || !microphoneReady) return;
    setAction("start"); setError(null);
    try {
      await requestMachine((client, signal) => client.start({
        accountId: selectedAccount, productIds: selectedProductIds, presenter, microphoneId: "default",
      }, signal));
    } catch { if (mountedRef.current) setError("เริ่ม AI LIVE ไม่สำเร็จ กรุณาตรวจสอบเครื่องแล้วลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function registerMachine() {
    if (action || !machine?.paired) return;
    setAction("register"); setError(null); setNotice(null);
    try {
      const result = await requestMachine((client, signal) => client.registerDevice(signal));
      if (result?.deviceAuthorized) setNotice("อนุญาตให้บัญชีของคุณใช้ส่วนเสริมบนเครื่องนี้แล้ว");
      else if (result) setError("ยังยืนยันสิทธิ์ใช้งานเครื่องนี้ไม่ได้ กรุณาลองอีกครั้ง");
    } catch { if (mountedRef.current) setError("ยังอนุญาตเครื่องนี้ไม่ได้ กรุณาตรวจสอบสิทธิ์การใช้งานหรือลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function configureLive() {
    if (action || !clientRef.current || !machine?.paired || !machine.deviceAuthorized
      || machine.membershipStatus !== "SUPPORTED" || machine.sessionActive || !accountSelectionReady || !productSelectionReady) return;
    setAction("configure"); setError(null); setNotice(null);
    // Use the same request queue as session actions without exposing the dialog's configuration.
    const generation = generationRef.current;
    const operation = requestQueueRef.current.catch(() => undefined).then(async () => {
      if (!mountedRef.current || generation !== generationRef.current || !clientRef.current) return;
      const controller = new AbortController();
      requestControllerRef.current = controller;
      try {
        await clientRef.current.configureStream({ accountId: selectedAccount, productIds: selectedProductIds }, controller.signal);
        if (mountedRef.current && generation === generationRef.current) setNotice("เปิดหน้าตั้งค่าบนเครื่องแล้ว");
      } finally { if (requestControllerRef.current === controller) requestControllerRef.current = null; }
    });
    requestQueueRef.current = operation.catch(() => undefined);
    try { await operation; }
    catch { if (mountedRef.current) setError("ยังเปิดหน้าตั้งค่าการ LIVE ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และการเชื่อมต่อเครื่อง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function revokeMachine() {
    if (action || !machine?.paired || !window.confirm("ยกเลิกสิทธิ์ใช้ AI LIVE ของเครื่องนี้หรือไม่?")) return;
    setAction("revoke"); setError(null); setNotice(null);
    try {
      await requestMachine((client, signal) => client.revokeDevice(signal));
      setNotice("ยกเลิกสิทธิ์เครื่องนี้แล้ว");
    } catch { if (mountedRef.current) setError("ยังยืนยันการยกเลิกสิทธิ์ไม่ได้ กรุณาตรวจสอบอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function stopLive(targetAccount = selectedAccount) {
    const target = machineForAccount(machine, targetAccount);
    if (action || !target?.sessionActive) return;
    setAction("stop"); setError(null);
    try { await requestMachine((client, signal) => client.stopAccount(targetAccount, signal)); }
    catch { if (mountedRef.current) setError("หยุด AI LIVE ไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function pauseLive(resume = false, targetAccount = selectedAccount) {
    const target = machineForAccount(machine, targetAccount);
    if (action || !target?.sessionActive) return;
    setAction(resume ? "resume" : "pause"); setError(null);
    try { await requestMachine((client, signal) => resume ? client.resumeAccount(targetAccount, signal) : client.pauseAccount(targetAccount, signal)); }
    catch { if (mountedRef.current) setError("ยังเปลี่ยนสถานะการพูดไม่ได้ กรุณาลองอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  // Studio and runtime share the same authenticated bridge and serialized request queue.
  async function studioRequest<T>(operation: (client: LocalLiveClient, signal: AbortSignal) => Promise<T>): Promise<T> {
    const generation = generationRef.current;
    const queued = requestQueueRef.current.catch(() => undefined).then(async () => {
      if (!mountedRef.current || generation !== generationRef.current || !clientRef.current) throw new Error("กรุณาเชื่อมต่อเครื่องก่อน");
      const controller = new AbortController();
      requestControllerRef.current = controller;
      try { return await operation(clientRef.current, controller.signal); }
      finally { if (requestControllerRef.current === controller) requestControllerRef.current = null; }
    });
    requestQueueRef.current = queued.catch(() => undefined);
    return queued;
  }

  useImperativeHandle(controlsRef, () => ({
    start: startLive, stop: stopLive, check: checkMachine,
    pause: (target) => pauseLive(false, target), resume: (target) => pauseLive(true, target), loadReference: (file) => choosePresenter(file, false),
    preview: () => previewElement.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
    listPresenters: () => studioRequest((client, signal) => client.listPresenters(signal)),
    savePresenter: (input) => studioRequest((client, signal) => client.savePresenter(input, signal)),
    deletePresenter: (id) => studioRequest((client, signal) => client.deletePresenter(id, signal)),
    presenterReference: (id) => studioRequest((client, signal) => client.presenterReference(id, signal)),
    presenterThumbnail: (id, signal) => passivePresenterReads.read(async (readSignal) => {
      if (!mountedRef.current || !clientRef.current) throw new DOMException("Read cancelled", "AbortError");
      return clientRef.current.presenterReference(id, readSignal);
    }, signal),
  }));

  useEffect(() => {
    onRuntimeChange?.(customerRoomRuntime({ accountId: selectedAccount, machine, imageReady: !!presenter,
      microphoneReady, productsReady: productSelectionReady,
      busy: !!action, accountReady: accountSelectionReady }));
  }, [onRuntimeChange, selectedAccount, machine, presenter, microphoneReady, productSelectionReady, action, accountSelectionReady]);

  async function checkUpdates() {
    if (action || !machine?.paired) return;
    setAction("update-check"); setError(null); setNotice(null);
    try {
      const result = await requestMachine((client, signal) => client.checkUpdates(signal));
      if (result) setNotice(result.updateCanApply ? "มีส่วนเสริมรุ่นใหม่พร้อมให้อัปเดต" : "ตรวจอัปเดตเรียบร้อยแล้ว");
    } catch { if (mountedRef.current) setError("ยังตรวจอัปเดตไม่ได้ กรุณาลองอีกครั้งภายหลัง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  async function installUpdate(repair = false) {
    if (action || !machine?.paired || machine.sessionActive
      || !window.confirm(repair ? "ซ่อมแซมส่วนเสริมบนเครื่องนี้หรือไม่?" : "อัปเดตส่วนเสริมบนเครื่องนี้หรือไม่? เมื่อเสร็จแล้วต้องเปิดส่วนเสริมใหม่")) return;
    setAction(repair ? "repair" : "update"); setError(null); setNotice(null);
    try {
      await requestMachine((client, signal) => client.installUpdate(repair, signal));
      setNotice(repair ? "กำลังซ่อมแซมส่วนเสริม กรุณารอผลการติดตั้ง" : "กำลังอัปเดตส่วนเสริม กรุณารอผลการติดตั้ง");
    } catch { if (mountedRef.current) setError("ยังเริ่มติดตั้งไม่ได้ กรุณาหยุดไลฟ์แล้วตรวจอัปเดตอีกครั้ง"); }
    finally { if (mountedRef.current) setAction(null); }
  }

  const showPairing = machine && !machine.paired && !["NOT_INSTALLED", "OFFLINE", "INSTALLING"].includes(machine.state);
  const canStart = !!selectedMachine?.canStart && selectedMachine.deviceAuthorized && !selectedMachine.sessionActive && !action
    && machine?.capacity?.status === "VERIFIED" && machine.capacity.canStartAnotherRoom
    && accountSelectionReady && productSelectionReady && !!presenter && microphoneReady;
  const components = machine?.components;
  const liveStatus = components?.state === "READY" && !selectedMachine?.canStart && !selectedMachine?.sessionActive
    ? "กำลังเตรียมพร้อม" : customerLiveStatus(selectedMachine, action === "start" || action === "stop" ? action : null);
  const componentBusy = !!components && ["CHECKING", "DOWNLOADING", "VERIFYING", "INSTALLING"].includes(components.state);
  const componentProgress = components?.totalBytes ? Math.min(100, Math.floor(100 * components.bytesReceived / components.totalBytes)) : null;
  const preparationAllowed = !!machine?.paired && machine.deviceAuthorized && machine.membershipStatus === "SUPPORTED"
    && !machine.sessionActive && !!components?.canPrepare && accountSelectionReady && productSelectionReady && !action;
  const previewImage = previewEnabled && systemPreview ? systemPreview : presenterPreview;
  const previewIsGenerated = previewEnabled && !!systemPreview;

  return <div className={`ai-live-page ${embedded ? "ai-live-room-runtime" : ""}`}>
    {!embedded && <header className="ai-live-hero">
      <div><p className="eyebrow">VIRALFLOW / AI LIVE</p><h1>AI LIVE</h1><p>เลือกบัญชี พรีเซนเตอร์ และสินค้า แล้วเริ่มไลฟ์จาก ViralFlow</p></div>
      <span className={`ai-live-state ${machine?.canStart ? "ready" : "blocked"}`} role="status" aria-live="polite">{liveStatus}</span>
    </header>}
    {notice && <p className="ai-live-notice" role="status">{notice}</p>}
    {error && <p className="ai-live-error" role="alert">{error}</p>}

    <section className="ai-live-first-run" aria-label="เตรียมเครื่องสำหรับ AI LIVE">
      <ol className="ai-live-first-run-steps">
        <li className="done"><span aria-hidden="true">✓</span>เข้าสู่ระบบแล้ว</li>
        <li className={machine?.machineReady === true ? "done" : "current"}><span aria-hidden="true">2</span>ตรวจสอบเครื่อง</li>
        <li className={components?.state === "READY" ? "done" : componentBusy ? "current" : ""}><span aria-hidden="true">3</span>เตรียมส่วนประกอบ</li>
        <li className={machine?.canStart && machine.deviceAuthorized ? "done" : ""}><span aria-hidden="true">4</span>{machine?.canStart && machine.deviceAuthorized ? "พร้อมใช้งาน" : "รอความพร้อม"}</li>
      </ol>
      <div className="ai-live-first-run-status" role="status" aria-live="polite">
        <strong>{components?.message ?? (!machine ? "กำลังตรวจสอบเครื่อง" : machine.machineReady === true ? "กำลังเตรียมส่วนประกอบ" : "ต้องตรวจสอบความพร้อมของเครื่อง")}</strong>
        {components?.state === "NOT_CONFIGURED" && !components.canPrepare && <p>ยังไม่พร้อมให้ดาวน์โหลด</p>}
        {componentBusy && <div className="ai-live-download-progress">
          <progress max={100} value={components.state === "DOWNLOADING" && componentProgress !== null ? componentProgress : undefined} aria-label="ความคืบหน้าการเตรียมส่วนประกอบ" />
          {components.state === "DOWNLOADING" && <span>{componentProgress === null ? "กำลังรับข้อมูล" : `${componentProgress}%`}
            {components.bytesReceived > 0 ? ` · ${(components.bytesReceived / 1048576).toFixed(1)} MB${components.totalBytes > 0 ? ` / ${(components.totalBytes / 1048576).toFixed(1)} MB` : ""}` : ""}</span>}
        </div>}
        {components?.state === "READY" && !machine?.canStart && <p>ส่วนประกอบพร้อมแล้ว AI LIVE ยังอยู่ระหว่างการเตรียมความพร้อม</p>}
        {(!components || components.state !== "READY") && !componentBusy && <button type="button" className="ai-live-secondary" disabled={!preparationAllowed}
          onClick={() => void prepareMachine(components?.state === "REPAIR_REQUIRED" || components?.state === "ERROR")}>{action === "prepare" ? "กำลังเตรียมเครื่อง..." : "เตรียมเครื่อง"}</button>}
        {machine?.paired && !machine.deviceAuthorized && <p>เชื่อมต่อและอนุญาตเครื่องใน “ตั้งค่าการ LIVE” ก่อนเตรียมเครื่อง</p>}
        {machine?.deviceAuthorized && (!accountSelectionReady || !productSelectionReady) && components?.state !== "READY" && <p>เลือกบัญชีที่เชื่อมต่อและสินค้าเพื่อเตรียมเครื่อง</p>}
        {machine?.hardwareAdvice === "DRIVER_UPDATE_REQUIRED" && <a href="https://www.nvidia.com/Download/index.aspx" target="_blank" rel="noopener noreferrer">อัปเดตไดรเวอร์จากผู้ผลิต</a>}
      </div>
    </section>

    <div className="ai-live-grid">
      <section className="ai-live-panel ai-live-setup" aria-label="เตรียม AI LIVE">
        <div className="ai-live-panel-title"><h2>เตรียมไลฟ์</h2></div>
        <ul className="ai-live-ready-checks" aria-label="ความพร้อมของ AI">
          {(["brain", "voice", "presenter"] as const).map((key) => <li key={key}>
            <strong>{key === "brain" ? "AI" : key === "voice" ? "เสียง" : "คน LIVE"}</strong>
            <span>{machine?.aiReadiness?.[key] === "READY" ? "พร้อม" : "กำลังเตรียม"}</span>
          </li>)}
        </ul>
        <label className="ai-live-field">บัญชี TikTok
          <select value={selectedAccount} disabled={!!action} onChange={(event) => { setInternalAccount(event.target.value); onAccountChange?.(event.target.value); }}>
            <option value="">เลือกบัญชี</option>
            {!!selectedAccount && !accountSelectionReady && <option value={selectedAccount} disabled>บัญชีนี้ต้องเชื่อม TikTok ใหม่</option>}
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
        </label>
        {accounts.length === 0 && <p className="ai-live-help">ยังไม่มีบัญชีที่เชื่อมต่อ <Link href="/accounts">ดูบัญชี TikTok</Link></p>}
        <label className="ai-live-field">พรีเซนเตอร์
          <input type="file" accept="image/jpeg,image/png" disabled={!!selectedMachine?.sessionActive} onChange={(event) => choosePresenter(event.target.files?.[0] ?? null)} />
          <small>เลือกภาพที่คุณมีสิทธิใช้งาน ขนาดไม่เกิน 4 MB</small>
        </label>
        {!embedded && <label className="ai-live-field">สินค้า
          <select value={selectedProduct} disabled={!!selectedMachine?.sessionActive} onChange={(event) => { setInternalProduct(event.target.value); onProductChange?.(event.target.value); }}>
            <option value="">เลือกสินค้า</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
          </select>
        </label>}
        {products.length === 0 && <p className="ai-live-help">ยังไม่มีสินค้าให้เลือก</p>}
        <div className="ai-live-field"><span>ไมโครโฟน</span>
          <div className="ai-live-microphone-row">
            <span className="ai-live-microphone-name">{microphoneReady ? microphoneLabel : "ยังไม่ได้ตรวจสอบไมโครโฟน"}</span>
            <button type="button" className="ai-live-secondary" disabled={!!selectedMachine?.sessionActive} onClick={() => void chooseMicrophone()}>{microphoneReady ? "ตรวจสอบอีกครั้ง" : "ตรวจสอบไมโครโฟน"}</button>
          </div><small>ระบบจะใช้ไมโครโฟนเริ่มต้นของเครื่อง และขอสิทธิ์เมื่อคุณกดตรวจสอบเท่านั้น</small>
        </div>
        <div className="ai-live-live-actions">
          <button className="primary-action" type="button" disabled={!canStart} onClick={() => void startLive()}>{action === "start" ? "กำลังเตรียม..." : "เริ่ม LIVE"}</button>
          <button className="danger-action" type="button" disabled={!selectedMachine?.sessionActive || !!action} onClick={() => void stopLive()}>{action === "stop" ? "กำลังหยุด..." : "หยุด LIVE"}</button>
        </div>
        {!machine?.canStart && <p className="ai-live-context-note">AI LIVE ยังไม่พร้อมเริ่มถ่ายทอดสด ดูความพร้อมและเชื่อมต่อเครื่องได้ใน “ตั้งค่าการ LIVE”</p>}
      </section>

      <div className="ai-live-side">
        <details className="ai-live-panel ai-live-machine ai-live-settings">
          <summary>ตั้งค่าการ LIVE<span>ความพร้อมและการเชื่อมต่อเครื่อง</span></summary>
          <div className="ai-live-settings-content">
          <div className="ai-live-transport-setup">
            <button type="button" className="ai-live-secondary" disabled={!!action || !machine?.paired || !machine.deviceAuthorized
              || machine.membershipStatus !== "SUPPORTED" || machine.sessionActive || !accountSelectionReady || !productSelectionReady}
              onClick={() => void configureLive()}>{action === "configure" ? "กำลังเปิดหน้าตั้งค่า..." : "ตั้งค่าการ LIVE"}</button>
            <p className="ai-live-context-note">เลือกบัญชีและสินค้า แล้วกรอกข้อมูลการ LIVE ที่คุณได้รับอนุญาตให้ใช้ในหน้าต่างบนเครื่อง</p>
          </div>
          <strong className="ai-live-machine-status" aria-live="polite">{machineLabel(machine)}</strong>
          <p className="ai-live-machine-description">{machineDescription(machine)}</p>
          {machine && <dl className="ai-live-delivery-status">
            <div><dt>ส่วนเสริม</dt><dd>{["NOT_INSTALLED", "OFFLINE"].includes(machine.state) ? "ยังไม่พบส่วนเสริม" : "ติดตั้งแล้ว"}</dd></div>
            <div><dt>การอัปเดต</dt><dd>{machine.updateStatus === "UPDATING" ? "กำลังอัปเดต"
              : machine.updateStatus === "RESTART_REQUIRED" ? "เปิดส่วนเสริมใหม่เพื่อใช้งาน"
              : machine.updateStatus === "AVAILABLE" ? "มีรุ่นใหม่ให้ติดตั้ง"
              : machine.updateStatus === "REQUIRED" ? "ต้องอัปเดตก่อนใช้งาน"
              : machine.updateStatus === "ROLLED_BACK" ? "คืนรุ่นเดิมแล้ว กรุณาตรวจอัปเดตอีกครั้ง"
              : machine.updateStatus === "NOT_CONFIGURED" ? "ยังไม่มีอัปเดตที่พร้อมติดตั้ง"
              : "ยังไม่มีการอัปเดตที่พร้อมติดตั้ง"}</dd></div>
            <div><dt>สมาชิก</dt><dd>{machine.membershipStatus === "SUPPORTED" ? "รองรับ AI LIVE"
              : machine.membershipStatus === "UNSUPPORTED" ? "สมาชิกไม่รองรับ AI LIVE" : "ยังยืนยันสิทธิ์ไม่ได้"}</dd></div>
            <div><dt>สิทธิ์เครื่อง</dt><dd>{machine.deviceAuthorized ? "อนุญาตแล้ว"
              : machine.deviceStatus === "MEMBERSHIP_REQUIRED" ? "สมาชิกไม่รองรับ AI LIVE"
              : machine.deviceStatus === "UNAVAILABLE" ? "ยังยืนยันสิทธิ์ไม่ได้" : "ยังไม่ได้อนุญาต"}</dd></div>
          </dl>}
          {!!machine?.reasons.length && <ul className="ai-live-machine-reasons">{[...new Set(machine.reasons)].map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          {showPairing && <div className="ai-live-pairing">
            <label className="ai-live-field">รหัสเชื่อมต่อจากส่วนเสริมบนเครื่อง
              <input type="text" autoComplete="one-time-code" value={pairCode} disabled={!!action} onChange={(event) => setPairCode(event.target.value)} placeholder="กรอกรหัสที่แสดงในส่วนเสริม" />
            </label>
            <button type="button" className="ai-live-secondary" disabled={!pairCode.trim() || !!action} onClick={() => void pairMachine()}>{action === "pair" ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อเครื่อง"}</button>
            <p className="ai-live-context-note">เปิดส่วนเสริม ViralFlow บนเครื่องนี้เพื่อดูรหัส แล้วเชื่อมต่อก่อนตรวจสอบเครื่อง ไม่ต้องเปิดหน้าคำสั่ง</p>
          </div>}
          {machine?.paired && <div className="ai-live-authorization-actions">
            {!machine.deviceAuthorized && <button type="button" className="ai-live-secondary" disabled={!!action || machine.membershipStatus !== "SUPPORTED" || ["REQUIRED", "UPDATING"].includes(machine.updateStatus)} onClick={() => void registerMachine()}>{action === "register" ? "กำลังลงทะเบียน..." : "ลงทะเบียนเครื่อง"}</button>}
            {machine.deviceRegistered && <button type="button" className="ai-live-secondary" disabled={!!action} onClick={() => void revokeMachine()}>{action === "revoke" ? "กำลังยกเลิก..." : "ยกเลิกเครื่อง"}</button>}
            {machine.deviceStatus === "MEMBERSHIP_REQUIRED" && <Link href="/profile">ตรวจสอบสมาชิก</Link>}
          </div>}
          {machine?.paired && <div className="ai-live-update-actions">
            <button type="button" className="ai-live-secondary" disabled={!!action || machine.updateStatus === "UPDATING"} onClick={() => void checkUpdates()}>{action === "update-check" ? "กำลังตรวจอัปเดต..." : "ตรวจอัปเดต"}</button>
            <button type="button" className="ai-live-secondary" disabled={!!action || !machine.updateCanApply || machine.sessionActive} onClick={() => void installUpdate()}>{action === "update" ? "กำลังเริ่มอัปเดต..." : "อัปเดต"}</button>
            <button type="button" className="ai-live-secondary" disabled={!!action || !machine.updateCanRepair || machine.sessionActive} onClick={() => void installUpdate(true)}>{action === "repair" ? "กำลังเริ่มซ่อมแซม..." : "ซ่อมแซม"}</button>
          </div>}
          {machine && ["AVAILABLE", "REQUIRED", "RESTART_REQUIRED"].includes(machine.updateStatus) && <p className="ai-live-context-note">เปิดส่วนเสริมบนเครื่องเพื่ออัปเดต หรือเรียกตัวติดตั้งอีกครั้ง ระบบจะเก็บรุ่นเดิมไว้หากติดตั้งไม่สำเร็จ</p>}
          <div className="ai-live-machine-actions">
            <button type="button" className="ai-live-secondary" disabled={!!action} onClick={() => void checkMachine()}>{action === "check" ? "กำลังตรวจสอบ..." : "ตรวจสอบเครื่อง"}</button>
            <p>หากเบราว์เซอร์ถาม ให้ยอมให้หน้านี้เชื่อมต่อส่วนเสริมบนเครื่อง</p>
          </div>
          </div>
        </details>
        <section className="ai-live-panel ai-live-preview" ref={previewElement} aria-label="ภาพพรีเซนเตอร์">
          <div className="ai-live-panel-title"><h2>ดูตัวอย่าง</h2><span className="ai-live-preview-state">{previewIsGenerated ? "ภาพจากระบบ" : "ภาพอ้างอิง · ยังไม่ใช่ภาพสด"}</span></div>
          <div className="ai-live-stage">
            {previewImage ? <img src={previewImage} alt={previewIsGenerated ? "ภาพพรีเซนเตอร์จากระบบ" : "ภาพพรีเซนเตอร์ที่เลือก ยังไม่ใช่ภาพสด"} />
              : <div className="ai-live-stage-empty"><span>✦</span><strong>เลือกภาพพรีเซนเตอร์</strong><p>ภาพที่เลือกจะแสดงตรงนี้</p></div>}
            {previewImage && <span className="ai-live-stage-tag">{previewIsGenerated ? "ภาพจากระบบ" : "ภาพที่เลือก · ยังไม่ใช่ภาพสด"}</span>}
          </div>
        </section>
      </div>
    </div>
    <section className="ai-live-summary" aria-label="สถานะไลฟ์" aria-live="polite">
      <div><span>สถานะ</span><strong>{liveStatus}</strong></div>
      <div><span>คุณภาพการเชื่อมต่อ</span><strong>{customerConnectionQuality(selectedMachine)}</strong></div>
    </section>
  </div>;
}
