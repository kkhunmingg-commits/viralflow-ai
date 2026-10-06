"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { customerMetric, readinessLabel, type CustomerRoomRuntime, type LiveReadinessKey } from "@/features/ai-live/customer-room-view";
import type { LocalPresenterCard } from "@/features/ai-live/local-client";
import { LivePresenterConsole, type PresenterConsoleHandle } from "./presenter-console";
import { PresenterStudio } from "./presenter-studio";
import { liveObservationSummary } from "./live-observation-summary";

export type LiveAccountChoice = { id: string; label: string; avatarUrl?: string | null; connected?: boolean };
export type LiveProductChoice = { id: string; title: string; category?: string | null };
export interface CustomerLiveRoomObservation {
  accountId: string; liveSeconds: number | null; viewers: number | null; sales: number | null; units: number | null;
  salesPerHour: number | null; comments: number | null; currentProductName: string | null;
  currentResponse: string | null; latestComment: string | null;
  totalViewers?: number | null; nextScheduledAt?: string | null; scheduled?: boolean | null;
  backupVoiceReady?: boolean | null; safetyVoiceSeconds?: number | null; presenterState?: string | null;
}
type RoomDraft = { title: string; category: string; durationMinutes: string; productIds: string[]; presenterName: string | null; reference: File | null };
const readinessNames: Record<LiveReadinessKey, string> = {
  image: "ภาพ", audio: "เสียง", brain: "AI", products: "สินค้า", connection: "การเชื่อมต่อ", backupVoice: "เสียงสำรอง",
};
const emptyDraft: RoomDraft = { title: "", category: "", durationMinutes: "", productIds: [], presenterName: null, reference: null };

export function AiLiveControlRoom({ accounts, products, observations = [] }: {
  accounts: LiveAccountChoice[]; products: LiveProductChoice[]; observations?: CustomerLiveRoomObservation[];
}) {
  const [selectedAccount, setSelectedAccount] = useState(accounts.find((account) => account.connected !== false)?.id ?? accounts[0]?.id ?? "");
  const [runtime, setRuntime] = useState<CustomerRoomRuntime | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RoomDraft>>({});
  const [studioOpen, setStudioOpen] = useState(false);
  const [presenters, setPresenters] = useState<LocalPresenterCard[]>([]);
  const [clock, setClock] = useState<number | null>(null);
  const controls = useRef<PresenterConsoleHandle | null>(null);
  const roomElement = useRef<HTMLElement | null>(null);
  const focusedAccount = selectedAccount;
  const activeRooms = runtime?.rooms.filter((room) => room.sessionActive) ?? [];
  const focusedActive = runtime?.accountId === focusedAccount && runtime.sessionActive;
  const currentDraft = drafts[focusedAccount] ?? emptyDraft;
  const selected = accounts.find((account) => account.id === focusedAccount);
  const currentObservation = observations.find((room) => room.accountId === focusedAccount);
  const categoryOptions = [...new Set(products.map((product) => product.category).filter((value): value is string => !!value))];
  const runtimeAccounts = useMemo(() => accounts.filter((account) => account.connected !== false), [accounts]);
  const filteredProducts = useMemo(() => currentDraft.category ? products.filter((product) => product.category === currentDraft.category) : products, [products, currentDraft.category]);
  const summary = liveObservationSummary(accounts.map((account) => account.id), observations);
  const updateRuntime = useCallback((next: CustomerRoomRuntime) => setRuntime(next), []);
  const updatePresenters = useCallback((next: LocalPresenterCard[]) => setPresenters(next), []);
  const hasTimedRoom = !!runtime?.rooms.some((room) => room.sessionActive && room.sessionStartedAt !== null);
  useEffect(() => {
    if (!hasTimedRoom) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasTimedRoom]);

  function openRoom(accountId: string) {
    // Opening one account never changes, pauses, or stops another account's room.
    controls.current?.loadReference(drafts[accountId]?.reference ?? null);
    setSelectedAccount(accountId);
    roomElement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function updateDraft(update: Partial<RoomDraft>) {
    setDrafts((current) => ({ ...current, [focusedAccount]: { ...(current[focusedAccount] ?? emptyDraft), ...update } }));
  }
  function usePresenter(presenter: LocalPresenterCard, file: File) {
    if (focusedActive) return;
    controls.current?.loadReference(file); updateDraft({ presenterName: presenter.name, reference: file });
    setStudioOpen(false); roomElement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return <div className="live-control-center">
    <header className="live-control-heading"><div><p className="live-kicker">VIRALFLOW AI</p><h1>ห้อง AI LIVE</h1><p>ดูแลทุกบัญชี เตรียมคน LIVE และสินค้าได้ในที่เดียว</p></div>
      <button className="ai-live-secondary" type="button" onClick={() => setStudioOpen((current) => !current)}>{studioOpen ? "กลับไปห้อง LIVE" : "คน LIVE"}</button></header>
    {!!accounts.length && <section className="live-quick-controls" aria-label="ควบคุมห้องที่เลือก"><label className="ai-live-field">บัญชี TikTok
      <select value={focusedAccount} onChange={(event) => openRoom(event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.label}</option>)}</select></label>
      <div className="live-card-actions"><button type="button" onClick={() => openRoom(focusedAccount)}>เตรียมห้อง</button>
        <button type="button" className="primary-action" disabled={!runtime?.canStart || runtime.accountId !== focusedAccount} onClick={() => void controls.current?.start()}>เริ่ม LIVE</button>
        <button type="button" className="live-text-danger" disabled={!focusedActive} onClick={() => void controls.current?.stop(focusedAccount)}>หยุด LIVE</button></div></section>}
    <section className="live-overview" aria-label="ภาพรวม AI LIVE">
      <div><span>กำลัง LIVE บนเครื่องนี้</span><strong>{customerMetric(runtime?.canManagePresenters ? runtime.rooms.filter((room) => room.status === "กำลัง LIVE").length : null, " บัญชี")}</strong></div>
      <div><span>ห้องที่เลือกพร้อมเริ่ม</span><strong>{customerMetric(runtime?.canManagePresenters ? runtime.canStart ? 1 : 0 : null, " บัญชี")}</strong></div>
      <div><span>กำหนดเวลาแล้ว</span><strong>{customerMetric(summary.scheduled, " บัญชี")}</strong></div>
      <div><span>ชั่วโมง LIVE วันนี้</span><strong>{customerMetric(summary.hours)}</strong></div>
      <div><span>ยอดขาย</span><strong>{customerMetric(summary.sales)}</strong></div>
      <div><span>ขายแล้ว</span><strong>{customerMetric(summary.units, " ชิ้น")}</strong></div>
      <div><span>ยอดขาย / ชั่วโมง</span><strong>{customerMetric(summary.salesPerHour)}</strong></div>
    </section>
    <section className="live-device-capacity" aria-label="ความพร้อมของเครื่อง"><div><span className={`ai-live-machine-dot ${runtime?.canStart ? "ready" : ""}`} aria-hidden="true" />
      <div><strong>{runtime?.canStart ? "เครื่องพร้อม" : runtime?.canManagePresenters ? "กำลังเตรียม" : "ต้องตรวจสอบเครื่อง"}</strong>
        <p>{runtime?.capacity.status === "VERIFIED" ? `รองรับ ${customerMetric(runtime.capacity.maximumRooms)} ห้องพร้อมกัน`
          : "ยังไม่ได้ทดสอบจำนวนห้องพร้อมกัน"}</p></div></div>
      <button className="ai-live-secondary" type="button" onClick={() => void controls.current?.check()}>ตรวจเครื่อง</button></section>

    <section className="live-accounts" aria-labelledby="live-accounts-title">
      <header className="live-section-heading"><h2 id="live-accounts-title">บัญชีของคุณ</h2><Link href="/accounts">จัดการบัญชี →</Link></header>
      {!accounts.length && <div className="live-empty-state"><strong>เริ่มจากเชื่อม TikTok</strong><p>บัญชีที่คุณเชื่อมไว้ใน ViralFlow จะแสดงที่นี่</p><Link className="primary-action" href="/accounts">เชื่อมบัญชี</Link></div>}
      <div className="live-account-grid">{accounts.map((account) => {
        const isObserved = runtime?.accountId === account.id;
        const observedRoom = runtime?.rooms.find((room) => room.accountId === account.id);
        const isActive = !!observedRoom?.sessionActive;
        const observation = observations.find((room) => room.accountId === account.id);
        const elapsedSeconds = isActive && observedRoom?.sessionStartedAt != null && clock !== null
          ? Math.max(0, (clock - observedRoom.sessionStartedAt) / 1000) : null;
        const currentProductId = isActive ? observedRoom?.currentProductId : drafts[account.id]?.productIds[0];
        const currentProduct = currentProductId ? products.find((product) => product.id === currentProductId)?.title : null;
        const status = observedRoom?.status ?? (isObserved ? runtime.status : account.connected === false ? "ต้องเชื่อมต่อใหม่" : observation?.scheduled === true ? "กำหนดเวลาแล้ว" : "ยังไม่เริ่มไลฟ์");
        const assignedPresenter = presenters.find((presenter) => presenter.assignedAccountIds.includes(account.id));
        return <article className={`live-account-card ${focusedAccount === account.id ? "selected" : ""}`} key={account.id}>
          <div className="live-account-header">{account.avatarUrl ? <Image src={account.avatarUrl} alt="" width={48} height={48} unoptimized /> : <span className="live-account-avatar" aria-hidden="true">{account.label.replace(/^@/, "").slice(0, 1)}</span>}
            <h3>{account.label}</h3><span className={`live-soft-badge ${isActive ? "active" : ""}`}>{status}</span></div>
          <dl className="live-room-metrics"><div><dt>{isActive && observation?.liveSeconds == null ? "เวลาห้อง" : "เวลา LIVE"}</dt><dd>{customerMetric(observation?.liveSeconds != null ? observation.liveSeconds / 60 : elapsedSeconds !== null ? elapsedSeconds / 60 : null, " นาที")}</dd></div>
            <div><dt>ผู้ชมตอนนี้</dt><dd>{customerMetric(observation?.viewers)}</dd></div><div><dt>ผู้ชมทั้งหมด</dt><dd>{customerMetric(observation?.totalViewers)}</dd></div><div><dt>ยอดขาย</dt><dd>{customerMetric(observation?.sales)}</dd></div>
            <div><dt>ขายแล้ว</dt><dd>{customerMetric(observation?.units, " ชิ้น")}</dd></div><div><dt>ยอดขาย / ชั่วโมง</dt><dd>{customerMetric(observation?.salesPerHour)}</dd></div></dl>
          <div className="live-account-context"><p><span>สินค้า</span>{observation?.currentProductName || currentProduct || (isActive ? "ยังไม่มีข้อมูล" : "ยังไม่เลือก")}</p><p><span>คน LIVE</span>{drafts[account.id]?.presenterName ?? assignedPresenter?.name ?? "ยังไม่เลือก"}</p>
            <p><span>เสียงสำรอง</span>{observation?.backupVoiceReady === true ? "พร้อม" : observation?.backupVoiceReady === false ? "ยังไม่พร้อม" : "ยังไม่มีข้อมูล"}</p>
            <p><span>ไลฟ์ถัดไป</span>{scheduledTime(observation?.nextScheduledAt)}</p></div>
          <div className="live-card-actions"><button type="button" className="primary-action" disabled={!isObserved || !runtime.canStart || account.connected === false} onClick={() => void controls.current?.start()}>START LIVE</button>
            <button type="button" className="live-text-danger" disabled={!isActive} onClick={() => void controls.current?.stop(account.id)}>หยุด</button>
            <button type="button" onClick={() => openRoom(account.id)}>เปิดห้อง →</button></div>
        </article>;
      })}</div>
    </section>
    {!!activeRooms.length && <p className="live-empty-note" role="status">เปิดดูแต่ละห้องได้โดยไม่กระทบห้องอื่น การเริ่มห้องเพิ่มขึ้นกับความพร้อมที่เครื่องยืนยัน</p>}

    <div hidden={!studioOpen}><PresenterStudio bridge={controls} authorized={!!runtime?.canManagePresenters}
      passiveImagesEnabled={studioOpen && !!runtime?.canLoadPresenterImages}
      accounts={accounts} onUse={usePresenter} onChanged={updatePresenters} /></div>
    <section className="live-room" ref={roomElement} aria-labelledby="live-room-title" hidden={studioOpen}>
      <header className="live-section-heading"><div><p className="live-kicker">ห้องของคุณ</p><h2 id="live-room-title">{selected?.label || "เตรียมห้องแรก"}</h2></div>
        <span className="live-soft-badge" role="status">{runtime?.accountId === focusedAccount ? runtime.status : "กำลังตรวจสอบ"}</span></header>
      {selected?.connected === false && <div className="live-reconnect-notice" role="status"><div><strong>ต้องเชื่อม TikTok บัญชีนี้ใหม่</strong>
        <p>ห้องของ {selected.label} ยังเริ่มไม่ได้ เชื่อมบัญชีนี้ให้เรียบร้อยก่อนเตรียมไลฟ์</p></div>
        <Link className="ai-live-secondary" href={`/accounts/${selected.id}`}>เชื่อม TikTok ใหม่ →</Link></div>}
      <div className="live-room-planning"><label className="ai-live-field">ชื่อห้องสำหรับวางแผน<input maxLength={100} value={currentDraft.title} disabled={focusedActive} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="ตั้งชื่อห้อง LIVE" /><small>ใช้เตรียมห้องในหน้านี้ ยังไม่ส่งชื่อห้องไปแพลตฟอร์ม</small></label>
        <label className="ai-live-field">หมวดสินค้า<select value={currentDraft.category} disabled={focusedActive} onChange={(event) => updateDraft({ category: event.target.value, productIds: [] })}><option value="">ทุกหมวด</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="ai-live-field">ระยะเวลาที่วางแผน (นาที)<input type="number" min={1} max={1440} value={currentDraft.durationMinutes} disabled={focusedActive} onChange={(event) => updateDraft({ durationMinutes: event.target.value })} placeholder="ยังไม่กำหนด" /><small>ใช้วางแผนห้อง กรุณากดหยุดเมื่อสิ้นสุด LIVE</small></label></div>
      <details className="live-platform-options"><summary>เวลาและตัวเลือกของแพลตฟอร์ม</summary><p>รอการเชื่อมต่อจากแพลตฟอร์ม</p>
        <div className="live-room-planning"><label className="ai-live-field">กำหนดเวลา LIVE<input type="datetime-local" disabled /><small>ยังไม่สามารถบันทึกหรือตั้งเวลาไลฟ์ได้</small></label>
          <label className="ai-live-field">หมวด TikTok<select disabled><option>รอการเชื่อมต่อจากแพลตฟอร์ม</option></select></label></div>
        <fieldset disabled><legend>ตัวเลือกห้อง LIVE</legend>{["ความคิดเห็น", "ของขวัญ", "เฉพาะผู้ติดตาม", "จำกัดอายุผู้ชม", "บันทึกย้อนหลัง"].map((option) => <label key={option}><input type="checkbox" />{option}</label>)}</fieldset>
      </details>
      <section className="live-readiness" aria-label="ความพร้อมของห้อง"><div className="live-section-heading"><h3>เช็กก่อนเริ่ม</h3><button className="ai-live-secondary" type="button" onClick={() => void controls.current?.check()}>ตรวจความพร้อม</button></div>
        <ul>{(Object.entries(readinessNames) as [LiveReadinessKey, string][]).map(([key, label]) => {
          const state = runtime?.readiness[key] ?? "UNAVAILABLE";
          return <li className={state === "READY" ? "ready" : ""} key={key}><span aria-hidden="true">{state === "READY" ? "✓" : "○"}</span><strong>{label}</strong><small>{readinessLabel(state)}</small></li>;
        })}</ul><p>AI LIVE ยังต้องผ่านการทดสอบบนเครื่องที่รองรับก่อนเริ่มใช้งานจริง ข้อมูลผลลัพธ์จะแสดงเมื่อมีการวัดจริง</p></section>

      <fieldset className="live-product-choice"><legend>สินค้าในห้อง · เลือกแล้ว {currentDraft.productIds.length} / 10</legend>
        {!filteredProducts.length && <p className="live-empty-note">ยังไม่มีสินค้าในหมวดนี้</p>}
        <div>{filteredProducts.map((product) => <label key={product.id}><input type="checkbox" checked={currentDraft.productIds.includes(product.id)}
          disabled={focusedActive || (!currentDraft.productIds.includes(product.id) && currentDraft.productIds.length >= 10)}
          onChange={(event) => updateDraft({ productIds: event.target.checked ? [...currentDraft.productIds, product.id] : currentDraft.productIds.filter((id) => id !== product.id) })} />{product.title}</label>)}</div>
      </fieldset>
      <div className="live-room-primary-actions"><button type="button" className="ai-live-secondary" onClick={() => controls.current?.preview()}>ดูตัวอย่าง</button>
        <button type="button" className="primary-action" disabled={!runtime?.canStart || runtime.accountId !== focusedAccount} onClick={() => void controls.current?.start()}>เริ่ม LIVE</button></div>
      <LivePresenterConsole accounts={runtimeAccounts} products={filteredProducts} accountId={focusedAccount} productId={focusedActive ? runtime.currentProductId ?? "" : currentDraft.productIds[0] ?? ""}
        productIds={currentDraft.productIds} onReferenceChange={(file) => updateDraft({ reference: file, presenterName: null })}
        onAccountChange={openRoom} controlsRef={controls} onRuntimeChange={updateRuntime} embedded />
      <section className="live-conversation" aria-labelledby="live-conversation-title"><header className="live-section-heading"><h3 id="live-conversation-title">ระหว่าง LIVE</h3></header>
        <dl className="live-room-metrics"><div><dt>ผู้ชม</dt><dd>{customerMetric(currentObservation?.viewers)}</dd></div><div><dt>ความคิดเห็น</dt><dd>{customerMetric(currentObservation?.comments)}</dd></div><div><dt>ยอดขาย</dt><dd>{customerMetric(currentObservation?.sales)}</dd></div><div><dt>ขายแล้ว</dt><dd>{customerMetric(currentObservation?.units)}</dd></div>
          <div><dt>ยอดขาย / ชั่วโมง</dt><dd>{customerMetric(currentObservation?.salesPerHour)}</dd></div><div><dt>สถานะคน LIVE</dt><dd>{currentObservation?.presenterState === "SPEAKING" ? "กำลังพูด" : currentObservation?.presenterState === "IDLE" ? "รอพูด" : "ยังไม่มีข้อมูล"}</dd></div>
          <div><dt>เสียงสำรองที่เหลือ</dt><dd>{customerMetric(currentObservation?.safetyVoiceSeconds, " วินาที")}</dd></div></dl>
        <div className="live-conversation-grid"><div><span>ความคิดเห็นล่าสุด</span><p>{currentObservation?.latestComment || "ยังไม่มีข้อมูลความคิดเห็น"}</p></div><div><span>กำลังพูด</span><p>{currentObservation?.currentResponse || "ยังไม่มีข้อมูลการพูด"}</p></div></div>
        <div className="live-card-actions"><button type="button" disabled title="ยังไม่พร้อมใช้งานในห้องจริง">พูดตอนนี้</button>
          <button type="button" disabled={!focusedActive} onClick={() => void (runtime?.paused ? controls.current?.resume(focusedAccount) : controls.current?.pause(focusedAccount))}>{runtime?.paused ? "ให้ AI พูดต่อ" : "พัก AI"}</button>
          <button type="button" disabled title="เลือกสินค้าได้ก่อนเริ่มห้อง">เปลี่ยนสินค้า</button>
          <button type="button" disabled title="รอการเชื่อมต่อจากแพลตฟอร์ม">ปักสินค้า</button>
          <button className="live-text-danger" type="button" disabled={!focusedActive} onClick={() => void controls.current?.stop(focusedAccount)}>หยุด LIVE</button></div>
        <p className="live-empty-note">การตอบผู้ชมและเปลี่ยนสินค้าระหว่างห้องยังอยู่ระหว่างเตรียมพร้อม</p>
      </section>
    </section>
  </div>;
}

function scheduledTime(value: string | null | undefined): string {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date) : "ยังไม่มีข้อมูล";
}
