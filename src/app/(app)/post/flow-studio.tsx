import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsFor, remainingCapacity, type FlowAccountView } from "@/features/flow-farm/capacity";
import { bangkokDate, flowClipStatusLabels, MAX_FLOW_ACCOUNTS_PER_TIKTOK, type FlowClipStatus } from "@/features/flow-farm/contracts";
import { flowLogins, listFlowAccounts, listLibrary, listTodayClips, workerLastSeen } from "@/features/flow-farm/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { addFlowAccountAction, discardClipAction, flowAccountAction, markPostedAction, scheduleClipAction, startBatchAction, unscheduleClipAction } from "./flow-actions";
import { TikTokDraftButton, type DraftReceipt } from "./tiktok-draft-button";
import { TikTokPrivatePostButton } from "./tiktok-private-post-button";
import { LearningPanel } from "./learning-panel";
import "./flow-studio.css";

export interface StudioAccount { id: string; display_name: string; daily_post_target: number | null; effective_mode: string | null }

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Reads outside render; a missing table (migration not applied yet) shows a notice instead of an error page. */
async function loadStudio(client: SupabaseClient, owner: string, accountId: string) {
  const logins = await flowLogins(createAdminClient(), owner).catch(() => ({}));
  const settled = await Promise.allSettled([listFlowAccounts(client, owner, new Date(), logins), listTodayClips(client, owner, accountId), listLibrary(client, owner, accountId), workerLastSeen(client, owner)]);
  const list = <T,>(result: PromiseSettledResult<T[]>) => result.status === "fulfilled" ? result.value : [];
  return { flowAccounts: accountsFor(list(settled[0]), accountId), today: list(settled[1]), library: list(settled[2]),
    lastSeen: settled[3].status === "fulfilled" ? settled[3].value : null, unavailable: settled.some(result => result.status === "rejected"), now: Date.now(),
    ...await loadDrafts(client, owner, accountId, list(settled[2]).map(clip => clip.video_sha256).filter((hash): hash is string => !!hash)) };
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
  const { flowAccounts, today, library, lastSeen, unavailable, now, drafts, draftScope, publishScope, scopes } = await loadStudio(client, owner, account.id);
  const own = flowAccounts.filter(f => f.tiktokAccountId === account.id), shared = flowAccounts.filter(f => f.tiktokAccountId === null);
  const capacity = remainingCapacity(flowAccounts);
  const counts = today.reduce((map, clip) => map.set(clip.status, (map.get(clip.status) ?? 0) + 1), new Map<FlowClipStatus, number>());
  const defaultCount = Math.min(30, Math.max(1, account.daily_post_target ?? 5));
  const online = lastSeen !== null && now - Date.parse(lastSeen) < 3 * 60_000;
  const selling = account.effective_mode === "AFFILIATE";
  const waitingLogin = flowAccounts.some(f => f.active && f.loginState === "PENDING");
  const ready = flowAccounts.some(f => f.active && f.loginState === "READY");
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
      </li>)}</ol> : <p className="manual-warning">ยังไม่ได้ผูกบัญชี Google ผูกอย่างน้อย 1 บัญชีก่อนสร้างคลิป</p>}
      {shared.length > 0 && <p className="manual-muted">บัญชีกลางที่ใช้ร่วมทุกบัญชี TikTok (ใช้หลังบัญชีของตัวเองหมด): {shared.map(f => f.label).join(", ")}</p>}
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
        <span className="manual-private">เครดิตฟรีวันนี้ทำได้อีกประมาณ {capacity} คลิป</span></div>
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
      {today.length > 0 && <>
        <ul className="library-counts">{(["QUEUED", "GENERATING", "READY", "SCHEDULED", "POSTED", "FAILED", "SKIPPED_NO_CREDIT"] as FlowClipStatus[])
          .filter(s => counts.get(s)).map(s => <li key={s} className={`library-chip library-${s.toLowerCase()}`}>{flowClipStatusLabels[s]} <strong>{counts.get(s)}</strong></li>)}</ul>
        <details className="library-today"><summary>รายการวันนี้ ({today.length})</summary><ol>{today.map(clip => <li key={clip.id}>
          <span>{clip.title}</span><small>{flowClipStatusLabels[clip.status]}{clip.error ? ` (${clip.error})` : ""}</small></li>)}</ol></details>
      </>}
    </section>

    <section className="manual-panel" aria-labelledby="library-title">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 3 · รอโพสต์</p><h2 id="library-title">คลังคลิป ({library.length})</h2></div></div>
      {library.length === 0 ? <div className="manual-empty"><h3>ยังไม่มีคลิปรอโพสต์</h3><p>คลิปที่สร้างเสร็จและผ่านการตรวจ (MP4 แนวตั้ง 9:16 ไม่ซ้ำ) จะมาอยู่ตรงนี้</p></div>
        : <div className="library-grid">{library.map(clip => {
          const due = clip.status === "SCHEDULED" && clip.scheduled_at && Date.parse(clip.scheduled_at) <= now;
          return <article key={clip.id} className="library-clip">
            <video controls playsInline preload="none" src={`/api/library/${clip.id}/video`} aria-label={clip.title} />
            <div className="library-clip-body">
              <h3>{clip.title}</h3>
              <p className="library-meta">{clip.kind === "AFFILIATE" ? "ขายของ" : "ปั้นช่อง"}{clip.duration_seconds ? ` · ${Number(clip.duration_seconds).toFixed(0)} วิ` : ""} · สร้างด้วย Google Flow</p>
              {clip.status === "SCHEDULED" && clip.scheduled_at && <p className={due ? "library-due" : "library-scheduled"}>{due ? "ถึงเวลาโพสต์แล้ว · " : "ตั้งเวลาไว้ · "}{bangkokTime(clip.scheduled_at)}</p>}
              <textarea className="library-caption" readOnly rows={3} defaultValue={[clip.caption, clip.hashtags.join(" ")].filter(Boolean).join("\n")} aria-label="คำบรรยายสำหรับคัดลอก" />
              <div className="library-actions">
                {publishScope && clip.kind === "GROWTH" && <TikTokPrivatePostButton clipId={clip.id} />}
                {draftScope ? <TikTokDraftButton clipId={clip.id} accountId={account.id} initial={(clip.video_sha256 && drafts.get(clip.video_sha256)) || null}
                  caption={[clip.caption, clip.hashtags.join(" ")].filter(Boolean).join("\n")} />
                  : <a className="manual-primary" href="/auth/tiktok/start?inbox=1&new_account=1">อนุญาตส่งเข้า TikTok (ครั้งเดียว)</a>}
                <a className="manual-secondary" href={`/api/library/${clip.id}/video?download=1`}>ดาวน์โหลด MP4</a>
                <form action={markPostedAction} className="library-inline"><input type="hidden" name="id" value={clip.id} />{back}
                  <input name="url" type="url" placeholder="ลิงก์โพสต์ TikTok (ไม่บังคับ)" aria-label="ลิงก์โพสต์ TikTok" />
                  <button className="manual-secondary" type="submit">โพสต์แล้ว · ลบไฟล์</button></form>
                <form action={scheduleClipAction} className="library-inline"><input type="hidden" name="id" value={clip.id} />{back}
                  <input name="at" type="datetime-local" required aria-label="เวลาโพสต์ (เวลาไทย)" />
                  <button className="manual-secondary" type="submit">ตั้งเวลา</button></form>
                <div className="library-inline">
                  {clip.status === "SCHEDULED" && <form action={unscheduleClipAction}><input type="hidden" name="id" value={clip.id} />{back}<button className="library-link" type="submit">ยกเลิกเวลา</button></form>}
                  <form action={discardClipAction}><input type="hidden" name="id" value={clip.id} />{back}<button className="library-link danger" type="submit">ทิ้งคลิปนี้</button></form>
                </div>
              </div>
            </div>
          </article>;
        })}</div>}
      <p className="manual-muted">โพสต์ใน TikTok แล้วเปิดป้าย “เนื้อหาที่สร้างด้วย AI” ทุกครั้ง กด “ส่งเข้า TikTok (แบบร่าง)” แล้วคลิปจะไปรอในการแจ้งเตือน (Inbox) ของแอป TikTok ระบบคัดลอกคำบรรยายและแฮชแท็กให้ในปุ่มเดียวกัน (TikTok ไม่รับคำบรรยายผ่านการส่งแบบร่าง) วางในช่องคำบรรยายแล้วกดโพสต์ หรือกด “โพสต์แบบส่วนตัว (มีคำบรรยาย)” คลิปจะขึ้นโปรไฟล์เป็น “เฉพาะฉัน” พร้อมคำบรรยาย แฮชแท็ก และป้าย AI แล้วเปลี่ยนเป็น “ทุกคน” ในแอป (คลิปขายของต้องส่งแบบร่าง) เสร็จแล้วกลับมากด “โพสต์แล้ว” ระบบลบไฟล์ออกจากคลังทันที การตั้งเวลาตอนนี้เป็นการเตือนในคลัง เมื่อ TikTok อนุมัติ API โพสต์อัตโนมัติ คลิปที่ตั้งเวลาไว้จะโพสต์เองแล้วลบไฟล์</p>
    </section>

    <LearningPanel owner={owner} accountId={account.id} scopes={scopes} />
  </>;
}
