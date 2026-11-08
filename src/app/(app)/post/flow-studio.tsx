import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsFor, remainingCapacity, type FlowAccountView } from "@/features/flow-farm/capacity";
import { bangkokDate, MAX_FLOW_ACCOUNTS_PER_TIKTOK } from "@/features/flow-farm/contracts";
import { closeDeliveredDraftClips, draftDelivered, flowLogins, listFlowAccounts, listLibrary, liveClipProgress, workerLastSeen } from "@/features/flow-farm/service";
import { LiveClipProgressPanel } from "./live-clip-progress";
import { createAdminClient } from "@/lib/supabase/admin";
import { addFlowAccountAction, flowAccountAction, startBatchAction } from "./flow-actions";
import type { DraftReceipt } from "./tiktok-draft-button";
import { LearningPanel } from "./learning-panel";
import { ClipLibrary } from "./clip-library";
import { AccountPoolPanel } from "@/components/account-pool-panel";
import { flowPool } from "@/features/flow-farm/pool";
import "./flow-studio.css";

export interface StudioAccount { id: string; display_name: string; daily_post_target: number | null; effective_mode: string | null }

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Reads outside render; a missing table (migration not applied yet) shows a notice instead of an error page. */
async function loadStudio(client: SupabaseClient, owner: string, accountId: string) {
  const logins = await flowLogins(createAdminClient(), owner).catch(() => ({}));
  const settled = await Promise.allSettled([listFlowAccounts(client, owner, new Date(), logins), liveClipProgress(client, owner, accountId), listLibrary(client, owner, accountId), workerLastSeen(client, owner)]);
  const list = <T,>(result: PromiseSettledResult<T[]>) => result.status === "fulfilled" ? result.value : [];
  return { flowAccounts: accountsFor(list(settled[0]).filter(view => view.purpose !== "REPAIR"), accountId), live: settled[1].status === "fulfilled" ? settled[1].value : null, library: list(settled[2]),
    lastSeen: settled[3].status === "fulfilled" ? settled[3].value : null, unavailable: settled.some(result => result.status === "rejected"), now: Date.now(),
    ...await loadDrafts(client, owner, accountId, list(settled[2]).map(clip => clip.video_sha256).filter((hash): hash is string => !!hash)) };
}

/** Clips whose draft TikTok already confirmed (e.g. the page was closed before) leave the library on the next load. */
async function dropDeliveredDrafts(owner: string, accountId: string, studio: Awaited<ReturnType<typeof loadStudio>>) {
  const delivered = [...studio.drafts].filter(([, draft]) => draftDelivered(draft.status)).map(([hash]) => hash);
  if (!delivered.length) return studio;
  const removed = new Set(await closeDeliveredDraftClips(createAdminClient(), owner, accountId, delivered).catch(() => []));
  return { ...studio, library: studio.library.filter(clip => !removed.has(clip.id)) };
}

/** Whether this TikTok account may receive drafts, and what was already sent, keyed by the clip's MP4 hash. */
async function loadDrafts(client: SupabaseClient, owner: string, accountId: string, hashes: string[]) {
  const [account, sent] = await Promise.all([
    client.from("tiktok_accounts").select("is_mock,authorization_status,granted_scopes").eq("owner_id", owner).eq("id", accountId).maybeSingle(),
    hashes.length ? client.from("tiktok_inbox_uploads").select("id,status,media_sha256").eq("owner_id", owner).eq("tiktok_account_id", accountId).in("media_sha256", hashes)
      : Promise.resolve({ data: [] }),
  ]);
  const drafts = new Map<string, DraftReceipt>((sent.data ?? []).map(row => [row.media_sha256 as string, { receipt: row.id as string, status: row.status as string }]));
  const a = account.data, live = !!a && !a.is_mock && a.authorization_status === "authorized";
  return { drafts, draftScope: live && (a.granted_scopes ?? []).includes("video.upload"), publishScope: live && (a.granted_scopes ?? []).includes("video.publish"),
    scopes: live ? (a.granted_scopes ?? []) as string[] : [] };
}

/** Main path: free clips from the Google Flow accounts linked to this TikTok account, made on the owner's computer. */
function loginLabel(f: FlowAccountView) {
  if (f.loginState === "PENDING") return "⏳ รอล็อกอิน: คอมพิวเตอร์จะเปิดหน้าล็อกอิน Google ให้ (ต้องเปิดคอมไว้) · ";
  if (f.loginState === "FAILED") return `⚠ ล็อกอินไม่สำเร็จ${f.loginNote ? ` (${f.loginNote})` : ""} กด “ล็อกอินใหม่” · `;
  return `✓ ล็อกอินแล้ว${f.loginNote ? ` · ${f.loginNote}` : ""} · `;
}

export async function FlowStudio({ client, owner, account }: { client: SupabaseClient; owner: string; account: StudioAccount }) {
  const { flowAccounts, live, library, lastSeen, unavailable, now, publishScope, scopes } = await dropDeliveredDrafts(owner, account.id, await loadStudio(client, owner, account.id));
  const own = flowAccounts.filter(f => f.tiktokAccountId === account.id);
  // Lucky, 8 Nov: every signed-in Google account (any channel, repair accounts too) makes promo clips; drama keeps its share.
  const admin = createAdminClient();
  const pool = await flowPool(admin, owner).catch(() => null);
  const channels = ((await client.from("tiktok_accounts").select("id,display_name").eq("owner_id", owner)).data ?? []) as Array<{ id: string; display_name: string }>;
  const channelNames = Object.fromEntries(channels.map(c => [c.id, c.display_name]));
  const capacity = pool ? pool.openClips : remainingCapacity(flowAccounts);
  const defaultCount = Math.min(30, Math.max(1, account.daily_post_target ?? 5));
  const online = lastSeen !== null && now - Date.parse(lastSeen) < 3 * 60_000;
  const selling = account.effective_mode === "AFFILIATE";
  const signedIn = pool ? pool.accounts.some(a => a.active && a.loginState === "READY") : flowAccounts.some(f => f.active && f.loginState === "READY");
  // Only this channel's own new accounts hold the button: an account of another channel signing in does not.
  const waitingLogin = !signedIn && own.some(f => f.active && f.loginState === "PENDING");
  const ready = signedIn;
  const back = <input type="hidden" name="back" value={account.id} />;
  // Each web account downloads its own installer; the file carries a token that serves only this account.
  const installer = <form method="post" action="/api/flow-installer" className="library-start">
    <button className={online ? "manual-secondary" : "manual-primary"} type="submit">ดาวน์โหลดตัวติดตั้ง (Windows)</button></form>;

  return <>
    {unavailable && <p className="manual-warning">ยังอ่านข้อมูลระบบ Flow ไม่ได้ (ฐานข้อมูลยังไม่ได้เพิ่มตาราง flow_clips) ปุ่มด้านล่างจะใช้ได้หลังอัปเดตฐานข้อมูล</p>}
    <p className={online ? "flow-worker online" : "flow-worker"} role="status"><span aria-hidden="true">●</span>
      {online ? "เครื่องสร้างคลิปออนไลน์ กำลังรอ/ทำงานเบื้องหลัง"
        : lastSeen ? `เครื่องสร้างคลิปไม่ได้ทำงาน (เห็นล่าสุด ${bangkokTime(lastSeen)}) เปิดคอมเครื่องที่ติดตั้งไว้ หรือติดตั้งใหม่ด้านล่าง`
          : "ยังไม่ได้ติดตั้งเครื่องสร้างคลิปในคอมพิวเตอร์ ติดตั้งครั้งเดียวด้านล่าง"}</p>
    {online ? <details className="manual-panel"><summary>ติดตั้งในคอมเครื่องอื่น / อัปเดตตัวสร้างคลิป</summary>
      <p className="manual-muted">ใช้ได้ทีละเครื่องต่อบัญชีเว็บ ดาวน์โหลดใหม่แล้วเครื่องเดิมจะหยุดทำงาน</p>{installer}</details>
      : <section className="manual-panel" aria-labelledby="install-title">
        <div className="manual-section-head"><div><p className="manual-eyebrow">ครั้งเดียว · Windows · ต้องมี Google Chrome</p>
          <h2 id="install-title">ติดตั้งเครื่องสร้างคลิปในคอมพิวเตอร์</h2></div></div>
        <ol className="manual-muted">
          <li>กดดาวน์โหลด แล้วเปิดไฟล์ <code>ViralFlow-Setup.zip</code> ที่ได้ แล้วดับเบิลคลิก <code>ViralFlow-Setup.cmd</code> ข้างใน (ถ้า Windows ถามหรือขึ้นหน้าจอเตือนสีน้ำเงิน กด “เรียกใช้” หรือ “ข้อมูลเพิ่มเติม” แล้ว “เรียกใช้”)</li>
          <li>รอ 2-5 นาทีจนขึ้นว่าติดตั้งเสร็จ ไม่ต้องตั้งค่าอะไร โปรแกรมจะทำงานเบื้องหลังและเปิดเองทุกครั้งที่เปิดคอม</li>
          <li>ผูกบัญชี Google ด้านล่าง Chrome จะเปิดหน้าล็อกอินให้ครั้งเดียว ล็อกอินเสร็จแล้วปิดหน้าต่างนั้น</li>
        </ol>{installer}
        <p className="manual-muted">ไฟล์นี้ผูกกับบัญชีเว็บที่ล็อกอินอยู่ ให้เพื่อนล็อกอินเว็บด้วยบัญชีของตัวเองแล้วดาวน์โหลดเอง ถอนการติดตั้งได้ที่ Settings &gt; Apps</p>
      </section>}

    <section className="manual-panel" aria-labelledby="google-title">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 1 · ฟรี ไม่มีค่าใช้จ่ายต่อคลิป</p>
        <h2 id="google-title">บัญชี Google Flow ของ {account.display_name} ({own.length}/{MAX_FLOW_ACCOUNTS_PER_TIKTOK})</h2></div></div>
      <p className="manual-muted">ผูกบัญชี Google ได้สูงสุด {MAX_FLOW_ACCOUNTS_PER_TIKTOK} บัญชีเพื่อหมุนใช้เครดิตฟรีทุกวัน ระบบใช้บัญชีบนสุดจนเครดิตหมดก่อนแล้วค่อยย้ายบัญชีถัดไป
        ถ้ามีบัญชีที่เครดิตเหลือเยอะ ผูกบัญชีเดียวก็พอ ระบบจะใช้บัญชีนั้นไปเรื่อย ๆ จนเครดิตหมด</p>
      {own.length ? <ol className="library-flow-list">{own.map((f, index) => <li key={f.id} className={f.active ? undefined : "paused"}>
        <div><strong>{index + 1}. {f.label}</strong><small>
          {loginLabel(f)}{!f.active ? "พักไว้" : f.loginState !== "READY" ? "" : f.exhaustedToday ? `เครดิตหมดวันนี้ · ทำไป ${f.clipsToday} คลิป · พรุ่งนี้ใช้ต่อได้` : `วันนี้ทำไป ${f.clipsToday} คลิป · คาดว่าได้ ~${f.clipsPerDayEstimate} คลิป/วัน`}</small>
          </div>
        <form action={flowAccountAction} className="library-inline"><input type="hidden" name="id" value={f.id} />{back}
          <button className="library-link" name="op" value="UP" type="submit" disabled={index === 0} aria-label="ใช้ก่อน">↑</button>
          <button className="library-link" name="op" value="DOWN" type="submit" disabled={index === own.length - 1} aria-label="ใช้ทีหลัง">↓</button>
          {f.exhaustedToday && <button className="library-link" name="op" value="RESET" type="submit">เติมเครดิตแล้ว</button>}
          {f.loginState !== "PENDING" && <button className="library-link" name="op" value="RELOGIN" type="submit">ล็อกอินใหม่</button>}
          <button className="library-link" name="op" value={f.active ? "PAUSE" : "RESUME"} type="submit">{f.active ? "พัก" : "ใช้งาน"}</button>
          <button className="library-link danger" name="op" value="REMOVE" type="submit">เลิกผูก</button></form>
      </li>)}</ol> : signedIn ? <p className="manual-muted">ช่องนี้ยังไม่ได้ผูกบัญชี Google ของตัวเอง ไม่เป็นไร ระบบใช้บัญชีกองกลางด้านล่างทำคลิปให้ได้เลย</p>
        : <p className="manual-warning">ยังไม่ได้ผูกบัญชี Google ผูกอย่างน้อย 1 บัญชีก่อนสร้างคลิป</p>}
      <AccountPoolPanel owner={owner} mode="PROMO" channelNames={channelNames} pool={pool ?? undefined} />
      {own.length < MAX_FLOW_ACCOUNTS_PER_TIKTOK && <form action={addFlowAccountAction} className="library-start">
        <input type="hidden" name="tiktokAccountId" value={account.id} />{back}
        <label className="manual-filter">อีเมล Google (หรือชื่อเรียก)<input name="label" required maxLength={60} placeholder="name@gmail.com" /></label>
        <label className="manual-filter">คลิปฟรีต่อวันโดยประมาณ<input name="clipsPerDay" type="number" min={1} max={200} defaultValue={5} /></label>
        <button className="manual-secondary" type="submit">+ ผูกบัญชี Google</button></form>}
      <p className="manual-muted">กดผูกแล้ว คอมพิวเตอร์จะเปิดหน้าล็อกอิน Google ของบัญชีนั้นให้เองทีละบัญชี ล็อกอินเสร็จหน้าต่างปิดเอง
        หลังจากนั้นการสร้างคลิปทำงานเบื้องหลังทั้งหมด ไม่มีหน้าต่างโผล่ และไม่กดสร้างถ้าคลิปใช้เกิน 10 เครดิต</p>
    </section>

    <section className="manual-panel" aria-labelledby="make-title">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 2 · วันนี้ {bangkokDate()}</p><h2 id="make-title">สร้างคลิปฟรี</h2></div>
        <span className="manual-private">เครดิตฟรีวันนี้ทำคลิปโปรโมทได้อีกประมาณ {capacity} คลิป (ทุกบัญชีรวมกัน)</span></div>
      <form action={startBatchAction} className="library-start">
        <input type="hidden" name="accountId" value={account.id} />{back}
        <label className="manual-filter">จำนวนคลิปวันนี้<input name="count" type="number" min={1} max={30} defaultValue={defaultCount} /></label>
        <button className="manual-primary" type="submit" disabled={!ready || waitingLogin}>{selling ? "ค้นหาสินค้าและสร้างคลิป" : "สร้างคลิปปั้นช่อง"}</button>
      </form>
      {waitingLogin ? <p className="manual-warning">รอล็อกอินบัญชี Google ให้ครบก่อน แล้วค่อยกดสร้างคลิป</p>
        : !ready && <p className="manual-warning">ยังไม่มีบัญชี Google ที่ล็อกอินแล้ว ผูกบัญชีในขั้นที่ 1 ก่อน</p>}
      <p className="manual-muted">{selling
        ? "ระบบเลือกสินค้าขายดีที่มีรูปผ่านการตรวจสิทธิ์ (จาก TikTok Shop API เมื่อได้สิทธิ์ ระหว่างนี้จากสินค้าที่นำเข้า) แล้วทำคลิปโฆษณาไม่ซ้ำฉาก"
        : "บัญชีช่วงอุ่นเครื่อง: ระบบทำคลิปปั้นช่องที่ไม่มีสินค้า เพื่อให้คนกดติดตาม"} ถ้าเครดิตทุกบัญชี Google หมด ระบบจะหยุดที่คลิปที่ทำได้แล้วรอโพสต์ คลิปที่เหลือข้ามไปวันถัดไป</p>
      {live && <LiveClipProgressPanel key={account.id} accountId={account.id} initial={live} />}
    </section>

    <ClipLibrary library={library} now={now} back={account.id} publishable={publishScope ? [account.id] : []} eyebrow="ขั้นที่ 3 · รอโพสต์" title="คลังคลิปโปรโมท"
      empty="คลิปที่สร้างเสร็จและผ่านการตรวจ (MP4 แนวตั้ง 9:16 ไม่ซ้ำ) จะมาอยู่ตรงนี้ ตอนละครอยู่ในแท็บ “ละครซีรีส์”" />

    <LearningPanel owner={owner} accountId={account.id} scopes={scopes} />
  </>;
}
