"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { customerMetric, readinessLabel, type CustomerRoomRuntime, type LiveReadinessKey } from "@/features/ai-live/customer-room-view";
import type { LocalPresenterCard } from "@/features/ai-live/local-client";
import { LivePresenterConsole, type PresenterConsoleHandle } from "./presenter-console";
import { PresenterStudio } from "./presenter-studio";

export type LiveAccountChoice = { id: string; label: string; avatarUrl?: string | null; connected?: boolean };
export type LiveProductChoice = { id: string; title: string; category?: string | null };
export interface CustomerLiveRoomObservation {
  accountId: string; liveSeconds: number | null; viewers: number | null; sales: number | null; units: number | null;
  salesPerHour: number | null; comments: number | null; currentProductName: string | null;
  currentResponse: string | null; latestComment: string | null;
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
  const activeAccount = runtime?.sessionActive ? runtime.accountId : null;
  const focusedAccount = activeAccount || selectedAccount;
  const currentDraft = drafts[focusedAccount] ?? emptyDraft;
  const selected = accounts.find((account) => account.id === focusedAccount);
  const currentObservation = observations.find((room) => room.accountId === focusedAccount);
  const categoryOptions = [...new Set(products.map((product) => product.category).filter((value): value is string => !!value))];
  const runtimeAccounts = useMemo(() => accounts.filter((account) => account.connected !== false), [accounts]);
  const filteredProducts = useMemo(() => currentDraft.category ? products.filter((product) => product.category === currentDraft.category) : products, [products, currentDraft.category]);
  const observedHours = observations.length > 0 && observations.length === accounts.length && observations.every((room) => room.liveSeconds !== null)
    ? observations.reduce((sum, room) => sum + room.liveSeconds!, 0) / 3600 : null;
  const observedSales = observations.length > 0 && observations.length === accounts.length && observations.every((room) => room.sales !== null)
    ? observations.reduce((sum, room) => sum + room.sales!, 0) : null;
  const observedUnits = observations.length > 0 && observations.length === accounts.length && observations.every((room) => room.units !== null)
    ? observations.reduce((sum, room) => sum + room.units!, 0) : null;
  const updateRuntime = useCallback((next: CustomerRoomRuntime) => setRuntime(next), []);
  const updatePresenters = useCallback((next: LocalPresenterCard[]) => setPresenters(next), []);
  useEffect(() => {
    if (!runtime?.sessionActive || runtime.sessionStartedAt === null) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runtime?.sessionActive, runtime?.sessionStartedAt]);

  function openRoom(accountId: string) {
    // The existing local bridge owns one active session. Never relabel it as another account.
    if (activeAccount && activeAccount !== accountId) return;
    if (!activeAccount) controls.current?.loadReference(drafts[accountId]?.reference ?? null);
    setSelectedAccount(accountId);
    roomElement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function updateDraft(update: Partial<RoomDraft>) {
    setDrafts((current) => ({ ...current, [focusedAccount]: { ...(current[focusedAccount] ?? emptyDraft), ...update } }));
  }
  function usePresenter(presenter: LocalPresenterCard, file: File) {
    if (runtime?.sessionActive) return;
    controls.current?.loadReference(file); updateDraft({ presenterName: presenter.name, reference: file });
    setStudioOpen(false); roomElement.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return <div className="live-control-center">
    <header className="live-control-heading"><div><p className="live-kicker">VIRALFLOW AI</p><h1>ห้อง AI LIVE</h1><p>ดูแลทุกบัญชี เตรียมคน LIVE และสินค้าได้ในที่เดียว</p></div>
      <button className="ai-live-secondary" type="button" onClick={() => setStudioOpen((current) => !current)}>{studioOpen ? "กลับไปห้อง LIVE" : "คน LIVE"}</button></header>
    <section className="live-overview" aria-label="ภาพรวม AI LIVE">
      <div><span>กำลัง LIVE บนเครื่องนี้</span><strong>{customerMetric(runtime ? runtime.status === "กำลัง LIVE" ? 1 : 0 : null, " บัญชี")}</strong></div>
      <div><span>พร้อมเริ่ม</span><strong>{customerMetric(runtime ? runtime.canStart ? 1 : 0 : null, " บัญชี")}</strong></div>
      <div><span>ชั่วโมง LIVE วันนี้</span><strong>{customerMetric(observedHours)}</strong></div>
      <div><span>ยอดขาย</span><strong>{customerMetric(observedSales)}</strong></div>
      <div><span>ขายแล้ว</span><strong>{customerMetric(observedUnits, " ชิ้น")}</strong></div>
      <div><span>ยอดขาย / ชั่วโมง</span><strong>{customerMetric(observedSales !== null && observedHours !== null && observedHours > 0 ? observedSales / observedHours : null)}</strong></div>
    </section>

    <section className="live-accounts" aria-labelledby="live-accounts-title">
      <header className="live-section-heading"><h2 id="live-accounts-title">บัญชีของคุณ</h2><Link href="/accounts">จัดการบัญชี →</Link></header>
      {!accounts.length && <div className="live-empty-state"><strong>เริ่มจากเชื่อม TikTok</strong><p>บัญชีที่คุณเชื่อมไว้ใน ViralFlow จะแสดงที่นี่</p><Link className="primary-action" href="/accounts">เชื่อมบัญชี</Link></div>}
      <div className="live-account-grid">{accounts.map((account) => {
        const isObserved = runtime?.accountId === account.id;
        const isActive = isObserved && runtime.sessionActive;
        const observation = observations.find((room) => room.accountId === account.id);
        const elapsedSeconds = isActive && runtime.sessionStartedAt !== null && clock !== null
          ? Math.max(0, (clock - runtime.sessionStartedAt) / 1000) : null;
        const currentProductId = isActive && runtime.currentProductId ? runtime.currentProductId : drafts[account.id]?.productIds[0];
        const currentProduct = currentProductId ? products.find((product) => product.id === currentProductId)?.title : null;
        const status = isObserved ? runtime.status : account.connected === false ? "ต้องเชื่อมต่อใหม่" : "ยังไม่เริ่มไลฟ์";
        const assignedPresenter = presenters.find((presenter) => presenter.assignedAccountIds.includes(account.id));
        return <article className={`live-account-card ${focusedAccount === account.id ? "selected" : ""}`} key={account.id}>
          <div className="live-account-header">{account.avatarUrl ? <Image src={account.avatarUrl} alt="" width={48} height={48} unoptimized /> : <span className="live-account-avatar" aria-hidden="true">{account.label.replace(/^@/, "").slice(0, 1)}</span>}
            <h3>{account.label}</h3><span className={`live-soft-badge ${isActive ? "active" : ""}`}>{status}</span></div>
          <dl className="live-room-metrics"><div><dt>{isActive && observation?.liveSeconds == null ? "เวลาห้อง" : "เวลา LIVE"}</dt><dd>{customerMetric(observation?.liveSeconds != null ? observation.liveSeconds / 60 : elapsedSeconds !== null ? elapsedSeconds / 60 : null, " นาที")}</dd></div>
            <div><dt>ผู้ชม</dt><dd>{customerMetric(observation?.viewers)}</dd></div><div><dt>ยอดขาย</dt><dd>{customerMetric(observation?.sales)}</dd></div>
            <div><dt>ขายแล้ว</dt><dd>{customerMetric(observation?.units, " ชิ้น")}</dd></div><div><dt>ยอดขาย / ชั่วโมง</dt><dd>{customerMetric(observation?.salesPerHour)}</dd></div></dl>
          <div className="live-account-context"><p><span>สินค้า</span>{observation?.currentProductName || currentProduct || "ยังไม่เลือก"}</p><p><span>คน LIVE</span>{drafts[account.id]?.presenterName ?? assignedPresenter?.name ?? "ยังไม่เลือก"}</p></div>
          <div className="live-card-actions"><button type="button" className="primary-action" disabled={!isObserved || !runtime.canStart || account.connected === false} onClick={() => void controls.current?.start()}>START LIVE</button>
            <button type="button" className="live-text-danger" disabled={!isActive} onClick={() => void controls.current?.stop()}>หยุด</button>
            <button type="button" disabled={!!activeAccount && activeAccount !== account.id} onClick={() => openRoom(account.id)}>เปิดห้อง →</button></div>
        </article>;
      })}</div>
    </section>
    {activeAccount && <p className="live-empty-note" role="status">เครื่องนี้กำลังดูแลหนึ่งห้อง หยุดห้องปัจจุบันก่อนเปลี่ยนบัญชี</p>}

    <div hidden={!studioOpen}><PresenterStudio bridge={controls} authorized={!!runtime?.canManagePresenters}
      passiveImagesEnabled={studioOpen && !!runtime?.canLoadPresenterImages}
      accounts={accounts} onUse={usePresenter} onChanged={updatePresenters} /></div>
    <section className="live-room" ref={roomElement} aria-labelledby="live-room-title" hidden={studioOpen}>
      <header className="live-section-heading"><div><p className="live-kicker">ห้องของคุณ</p><h2 id="live-room-title">{selected?.label || "เตรียมห้องแรก"}</h2></div>
        <span className="live-soft-badge" role="status">{runtime?.status ?? "กำลังตรวจสอบ"}</span></header>
      {selected?.connected === false && <div className="live-reconnect-notice" role="status"><div><strong>ต้องเชื่อม TikTok บัญชีนี้ใหม่</strong>
        <p>ห้องของ {selected.label} ยังเริ่มไม่ได้ เชื่อมบัญชีนี้ให้เรียบร้อยก่อนเตรียมไลฟ์</p></div>
        <Link className="ai-live-secondary" href={`/accounts/${selected.id}`}>เชื่อม TikTok ใหม่ →</Link></div>}
      <div className="live-room-planning"><label className="ai-live-field">ชื่อห้อง<input maxLength={100} value={currentDraft.title} disabled={!!runtime?.sessionActive} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="ตั้งชื่อห้อง LIVE" /></label>
        <label className="ai-live-field">หมวดสินค้า<select value={currentDraft.category} disabled={!!runtime?.sessionActive} onChange={(event) => updateDraft({ category: event.target.value, productIds: [] })}><option value="">ทุกหมวด</option>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="ai-live-field">ระยะเวลาที่วางแผน (นาที)<input type="number" min={1} max={1440} value={currentDraft.durationMinutes} disabled={!!runtime?.sessionActive} onChange={(event) => updateDraft({ durationMinutes: event.target.value })} placeholder="ยังไม่กำหนด" /><small>ใช้วางแผนห้อง กรุณากดหยุดเมื่อสิ้นสุด LIVE</small></label></div>
      <section className="live-readiness" aria-label="ความพร้อมของห้อง"><div className="live-section-heading"><h3>เช็กก่อนเริ่ม</h3><button className="ai-live-secondary" type="button" onClick={() => void controls.current?.check()}>ตรวจความพร้อม</button></div>
        <ul>{(Object.entries(readinessNames) as [LiveReadinessKey, string][]).map(([key, label]) => {
          const state = runtime?.readiness[key] ?? "UNAVAILABLE";
          return <li className={state === "READY" ? "ready" : ""} key={key}><span aria-hidden="true">{state === "READY" ? "✓" : "○"}</span><strong>{label}</strong><small>{readinessLabel(state)}</small></li>;
        })}</ul><p>AI LIVE ยังต้องผ่านการทดสอบบนเครื่องที่รองรับก่อนเริ่มใช้งานจริง ข้อมูลผลลัพธ์จะแสดงเมื่อมีการวัดจริง</p></section>

      <fieldset className="live-product-choice"><legend>สินค้าในห้อง · เลือกแล้ว {currentDraft.productIds.length} / 10</legend>
        {!filteredProducts.length && <p className="live-empty-note">ยังไม่มีสินค้าในหมวดนี้</p>}
        <div>{filteredProducts.map((product) => <label key={product.id}><input type="checkbox" checked={currentDraft.productIds.includes(product.id)}
          disabled={!!runtime?.sessionActive || (!currentDraft.productIds.includes(product.id) && currentDraft.productIds.length >= 10)}
          onChange={(event) => updateDraft({ productIds: event.target.checked ? [...currentDraft.productIds, product.id] : currentDraft.productIds.filter((id) => id !== product.id) })} />{product.title}</label>)}</div>
      </fieldset>
      <LivePresenterConsole accounts={runtimeAccounts} products={filteredProducts} accountId={focusedAccount} productId={runtime?.sessionActive ? runtime.currentProductId ?? currentDraft.productIds[0] ?? "" : currentDraft.productIds[0] ?? ""}
        productIds={currentDraft.productIds} onReferenceChange={(file) => updateDraft({ reference: file, presenterName: null })}
        onAccountChange={openRoom} controlsRef={controls} onRuntimeChange={updateRuntime} embedded />
      <section className="live-conversation" aria-labelledby="live-conversation-title"><header className="live-section-heading"><h3 id="live-conversation-title">ระหว่าง LIVE</h3></header>
        <dl className="live-room-metrics"><div><dt>ผู้ชม</dt><dd>{customerMetric(currentObservation?.viewers)}</dd></div><div><dt>ความคิดเห็น</dt><dd>{customerMetric(currentObservation?.comments)}</dd></div><div><dt>ยอดขาย</dt><dd>{customerMetric(currentObservation?.sales)}</dd></div><div><dt>ขายแล้ว</dt><dd>{customerMetric(currentObservation?.units)}</dd></div></dl>
        <div className="live-conversation-grid"><div><span>ความคิดเห็นล่าสุด</span><p>{currentObservation?.latestComment || "ยังไม่มีข้อมูลความคิดเห็น"}</p></div><div><span>กำลังพูด</span><p>{currentObservation?.currentResponse || "ยังไม่มีข้อมูลการพูด"}</p></div></div>
        <div className="live-card-actions"><button type="button" disabled title="ยังไม่พร้อมใช้งานในห้องจริง">พูดตอนนี้</button>
          <button type="button" disabled={!runtime?.sessionActive} onClick={() => void (runtime?.paused ? controls.current?.resume() : controls.current?.pause())}>{runtime?.paused ? "ให้ AI พูดต่อ" : "พัก AI"}</button>
          <button type="button" disabled title="เลือกสินค้าได้ก่อนเริ่มห้อง">เปลี่ยนสินค้า</button>
          <button className="live-text-danger" type="button" disabled={!runtime?.sessionActive} onClick={() => void controls.current?.stop()}>หยุด LIVE</button></div>
        <p className="live-empty-note">การตอบผู้ชมและเปลี่ยนสินค้าระหว่างห้องยังอยู่ระหว่างเตรียมพร้อม</p>
      </section>
    </section>
  </div>;
}
