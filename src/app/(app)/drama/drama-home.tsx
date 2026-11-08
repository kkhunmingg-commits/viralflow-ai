/* eslint-disable @next/next/no-img-element -- signed Supabase URLs expire; next/image would cache them */
import Link from "next/link";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAMA_GENRES, dramaGenreLabels, episodeStatusLabels, seriesStatusLabels } from "@/features/drama/contracts";
import { GENRE_STORIES } from "@/features/drama/genres";
import { OneVideoAtATime } from "./one-video";
import { AccountPoolPanel } from "@/components/account-pool-panel";
import { pickStory } from "@/features/drama/showrunner";
import { dramaAvailable, listSeries, repairPool, signedImage, type SeriesSummary } from "@/features/drama/service";
import { repairShotsLeft } from "@/features/drama/engine";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { flowLogins } from "@/features/flow-farm/service";
import { addRepairAccountAction, flowAccountAction } from "../post/flow-actions";
import { createSeriesAction, newStoryAction, reviewEpisodeAction, takeAction } from "./actions";
import "../post/flow-studio.css";
import "./drama.css";

interface GoogleAccount { id: string; label: string; tiktok_account_id: string | null; active: boolean; exhausted_on: string | null; purpose: "CLIP" | "REPAIR";
  clips_today: number; clips_today_on: string | null; clips_per_day_estimate: number }

function nextStep(item: SeriesSummary, today: string) {
  const { series, current, toReview, latestReady } = item;
  if (series.status === "COMPLETED") return `จบครบ ${series.total_episodes} ตอนแล้ว`;
  if (toReview) return `ตอนที่ ${toReview.number} ตัดต่อเสร็จ รอคุณตรวจ ดูคลิปในขั้นที่ 4 แล้วกด “ผ่าน” เพื่อไปตอนที่ ${toReview.number + 1} หรือ “ไม่ผ่าน” เพื่อทำเวอร์ชันใหม่ จากนั้นกด “สร้างตอนต่อไป” เมื่อพร้อม`;
  if (series.status === "PAUSED") return "รอคุณกด “สร้างตอนต่อไป” ในหน้าเรื่อง";
  if (current?.status === "FAILED") return `ตอนที่ ${current.number} ต้องตรวจ: ${current.error ?? "ช็อตสร้างไม่สำเร็จ"}`;
  if (current?.status === "ASSEMBLING") return `กำลังตัดต่อตอนที่ ${current.number}`;
  if (current) return `กำลังถ่ายทำตอนที่ ${current.number} · ช็อต ${item.shotsDone}/${item.shotsTotal}${item.queued ? " · อยู่ในคิว Flow"
    : item.shots.some(shot => shot.waitingCredits) ? " · เครดิตหมด รอเครดิตรอบใหม่" : " · กำลังส่งช็อตถัดไป"}`;
  const done = latestReady ? `ตอนที่ ${latestReady.number} สำเร็จ ✓ ` : "";
  if (item.takes.length > 0) return `ตอนที่ ${series.next_episode_number} ไม่ผ่าน กำลังเริ่มถ่ายเวอร์ชันใหม่ (เครื่องสร้างคลิปจะรับงานภายใน 1–2 นาที) ระหว่างนี้เลือกเวอร์ชันเก่าในขั้นที่ 4 ได้`;
  if (latestReady?.started_on === today) return `${done}· ตอนที่ ${series.next_episode_number} เริ่มพรุ่งนี้`;
  return `${done}· ตอนที่ ${series.next_episode_number} กำลังจะเริ่ม`;
}

/** The drama menu: every series, which Google accounts make it, and the form that starts a new one. */
/** One pool account's state in words: how many repair shots it has left today, or that its credits are gone. */
function repairStatus(a: { active: boolean; loggedIn: boolean; exhaustedToday: boolean; usedToday: number; perDay: number; asideReason: string | null } | undefined) {
  if (!a) return "";
  if (!a.active) return "พักไว้";
  if (a.asideReason && !a.exhaustedToday) return `พักไว้ชั่วคราว (${a.asideReason}) ช็อตย้ายไปบัญชีอื่นเองแล้ว เดี๋ยวกลับมาใช้ใหม่เอง`;
  if (a.exhaustedToday || a.usedToday >= a.perDay) return `หมดเครดิตแล้ว (ใช้ ${Math.min(a.usedToday, a.perDay)}/${a.perDay} ช็อต) รอเครดิตรอบใหม่`;
  if (!a.loggedIn) return `ยังใช้ไม่ได้จนกว่าจะล็อกอิน (${a.perDay} ช็อต)`;
  return `พร้อมซ่อม · เหลือ ${a.perDay - a.usedToday}/${a.perDay} ช็อตวันนี้`;
}

export async function DramaHome({ client, owner, library, libraryCount = 0 }: { client: SupabaseClient; owner: string; library?: ReactNode; libraryCount?: number }) {
  const available = await dramaAvailable(client);
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,is_mock").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = ((accountsResult.data ?? []) as Array<{ id: string; display_name: string; is_mock: boolean | null }>)
    .filter(a => process.env.NODE_ENV !== "production" || !a.is_mock);
  const all = ((await client.from("flow_accounts").select("id,label,tiktok_account_id,active,exhausted_on,purpose,clips_today,clips_today_on,clips_per_day_estimate").eq("owner_id", owner).order("priority").order("created_at")).data ?? []) as GoogleAccount[];
  const google = all.filter(g => g.purpose !== "REPAIR"), repairs = all.filter(g => g.purpose === "REPAIR");
  const logins = await flowLogins(createAdminClient(), owner).catch(() => ({} as Awaited<ReturnType<typeof flowLogins>>));
  const series = available ? await listSeries(client, owner).catch(() => []) : [];
  const label = (id: string | null) => all.find(g => g.id === id)?.label ?? null;
  // Every repair account is one shared pool: any series sends a repair shot to whichever account still has credits.
  const pool = await repairPool(createAdminClient(), owner).catch(() => []);
  const poolLeft = pool.reduce((sum, a) => sum + repairShotsLeft(a), 0), poolTotal = pool.filter(a => a.active).reduce((sum, a) => sum + a.perDay, 0);
  const poolOf = (id: string) => pool.find(a => a.id === id);
  const poolText = pool.length === 0 ? "ไม่มีบัญชีซ่อม" : poolLeft === 0 ? `บัญชีซ่อม ${pool.length} บัญชี · เครดิตหมดทุกบัญชีแล้ว` : `บัญชีซ่อมกองกลาง ${pool.length} บัญชี · ซ่อมได้อีก ${poolLeft} ช็อตวันนี้`;
  const loginText = (id: string) => { const l = logins[id]; return l?.state === "READY" ? "✓ ล็อกอินแล้ว" : l?.state === "FAILED" ? `⚠ ล็อกอินไม่สำเร็จ${l.note ? ` (${l.note})` : ""}` : "⏳ รอล็อกอิน (เปิดคอมที่ติดตั้งเครื่องสร้างคลิปไว้)"; };
  const drama = <input type="hidden" name="studio" value="drama" />;
  const today = bangkokDate();
  // One cover picture per series (episode 1's key still: the cast in the opening scene).
  const admin = createAdminClient();
  const covers = new Map(await Promise.all(series.map(async item => [item.series.id, await signedImage(admin, item.series.key_still_path).catch(() => null)] as const)));

  if (!available) return <section className="manual-panel"><h2>ยังเปิดใช้ไม่ได้</h2>
    <p className="manual-muted">ฐานข้อมูลยังไม่มีตาราง Drama Studio ต้องรัน migration ใน Supabase ก่อน (ไม่กระทบระบบเดิม)</p></section>;

  const reviewing = series.filter(item => item.takes.length > 0);
  const waiting = reviewing.filter(item => item.takes.some(t => t.review === "PENDING")).length;
  const producing = series.filter(item => item.series.status === "ACTIVE").length;
  const ready = accounts.length > 0 && google.length > 0;
  const steps = [
    { href: "#step-accounts", title: "เตรียมบัญชี", note: ready ? `บัญชีหลัก ${google.length} · ซ่อม ${repairs.length}` : "ต้องทำก่อน", todo: !ready },
    { href: "#step-new", title: "เริ่มเรื่องใหม่", note: `ระบบเลือกบัญชีให้เอง`, todo: false },
    { href: "#step-production", title: "ติดตามการผลิต", note: `${producing} เรื่องกำลังผลิต`, todo: false },
    { href: "#step-review", title: "ตรวจตอนที่เสร็จ", note: waiting > 0 ? `รอคุณตรวจ ${waiting} ตอน` : "ยังไม่มีตอนรอตรวจ", todo: waiting > 0 },
    { href: "#library", title: "โพสต์จากคลังละคร", note: libraryCount ? `รอโพสต์ ${libraryCount} ตอน` : "ยังไม่มีตอนรอโพสต์", todo: Boolean(libraryCount) },
  ];
  const stepHead = (n: number, id: string, title: string, hint: string) => <div className="drama-step-head">
    <span className="drama-step-no" aria-hidden="true">{n}</span><div><h2 id={id}>ขั้นที่ {n} · {title}</h2><p className="manual-muted">{hint}</p></div></div>;

  return <div className="drama-page">
    <OneVideoAtATime />
    <ol className="drama-steps" aria-label="ขั้นตอนทำละคร">{steps.map((step, i) => <li key={step.href} className={step.todo ? "is-todo" : undefined}>
      <a href={step.href}><span aria-hidden="true">{i + 1}</span><strong>{step.title}</strong><small>{step.note}</small></a></li>)}</ol>

    <section className="manual-panel drama-step" id="step-accounts" aria-labelledby="accounts-title">
      {stepHead(1, "accounts-title", "เตรียมบัญชี", "ไม่ล็อกบัญชีกับเรื่องแล้ว ทุกบัญชีเป็นกองกลาง ตอนใหม่ใช้บัญชีที่เหลือเต็ม 5/5 ช็อตที่ต้องซ่อมใช้บัญชีที่เหลือไม่เต็ม ระบบเลือกให้เอง")}
      {accounts.length === 0 && <p className="manual-muted">เชื่อมบัญชี TikTok ก่อน <Link href="/accounts">ไปหน้าบัญชี</Link></p>}
      {/* Lucky, 8 Nov: the same pool list as the promo and product-clip tabs: every signed-in account, clips left today. */}
      <AccountPoolPanel owner={owner} mode="DRAMA" channelNames={Object.fromEntries(accounts.map(a => [a.id, a.display_name]))} />
      {google.length > 0 && <p className="manual-muted drama-note">เพิ่มหรือแก้บัญชีหลักได้ที่ <Link href="/post">แท็บสร้างคลิปโปรโมท</Link></p>}
      <h3>จัดการบัญชีซ่อม ({repairs.length})</h3>
      {pool.length > 0 && <p className="drama-pool"><strong>{poolLeft > 0 ? `วันนี้ซ่อมได้อีก ${poolLeft} จาก ${poolTotal} ช็อต` : `เครดิตหมดทุกบัญชีแล้ว (${poolTotal} ช็อต)`}</strong> · ช็อตละ 10 เครดิต · บัญชีไหนหมดระบบข้ามไปบัญชีถัดไปเอง</p>}
      {repairs.length > 0 && <ol className="library-flow-list">{repairs.map(g => <li key={g.id} className={g.active ? undefined : "paused"}>
        <div><strong>{g.label}</strong><small>{loginText(g.id)} · {repairStatus(poolOf(g.id))}</small></div>
        <form action={flowAccountAction} className="library-inline"><input type="hidden" name="id" value={g.id} />{drama}
          {(g.exhausted_on === today || (poolOf(g.id)?.usedToday ?? 0) >= (poolOf(g.id)?.perDay ?? Infinity)) && <button className="library-link" name="op" value="RESET" type="submit">เติมเครดิตแล้ว</button>}
          {logins[g.id]?.state !== "PENDING" && <button className="library-link" name="op" value="RELOGIN" type="submit">ล็อกอินใหม่</button>}
          <button className="library-link" name="op" value={g.active ? "PAUSE" : "RESUME"} type="submit">{g.active ? "พัก" : "ใช้งาน"}</button>
          <button className="library-link danger" name="op" value="REMOVE" type="submit">เลิกผูก</button></form>
      </li>)}</ol>}
      <form action={addRepairAccountAction} className="library-start">{drama}
        <label className="manual-filter">อีเมล Google ของบัญชีซ่อม<input name="label" required maxLength={60} placeholder="name@gmail.com" /></label>
        <label className="manual-filter">คลิปฟรีต่อวันโดยประมาณ<input name="clipsPerDay" type="number" min={1} max={200} defaultValue={5} /></label>
        <button className="manual-secondary" type="submit">+ เพิ่มบัญชีซ่อม</button></form>
      <p className="manual-muted drama-note">เพิ่มแล้ว คอมที่ติดตั้งเครื่องสร้างคลิปจะเปิดหน้าล็อกอิน Google ของบัญชีนี้ให้ครั้งเดียว ใช้บัญชีที่ไม่ได้ผูกเป็นบัญชีหลัก</p>
    </section>

    <section className="manual-panel drama-step" id="step-new" aria-labelledby="new-title">
      {stepHead(2, "new-title", "เริ่มละครเรื่องใหม่", "เลือกแนว ช่อง และบัญชีหลัก แล้ว AI เขียนทั้งซีซันและเริ่มถ่ายทำวันละตอนเอง")}
      <details className="drama-step-body" open={series.length === 0}><summary>{series.length === 0 ? "ตั้งค่าเรื่องแรก" : "เปิดฟอร์มเริ่มเรื่องใหม่"}</summary>
      {accounts.length === 0 ? <p className="manual-muted">เชื่อมบัญชี TikTok ก่อน <Link href="/accounts">ไปหน้าบัญชี</Link></p>
      : google.length === 0 ? <p className="manual-muted">ยังไม่มีบัญชี Google ผูกบัญชีในแท็บ “สร้างคลิปโปรโมท” ก่อน <Link href="/post">ไปผูกบัญชี</Link></p>
      : <form action={createSeriesAction} className="drama-form">
        <fieldset className="drama-genres"><legend>แนวละคร</legend>
          {DRAMA_GENRES.map((genre, i) => {
            const used = series.filter(s => s.series.genre === genre).map(s => s.series.bible.premiseKey);
            const stories = GENRE_STORIES[genre], next = stories.find(k => k.premise.key === pickStory(genre, used)) ?? stories[0];
            return <label key={genre} className="drama-genre-option">
              <input type="radio" name="genre" value={genre} defaultChecked={i === 0} required />
              <span><strong>{dramaGenreLabels[genre]} · {next.premise.title}</strong><small>{next.premise.logline}</small>
                <small>มี {stories.length} เรื่องในแนวนี้: {stories.map(k => k.premise.title).join(" · ")}</small></span>
            </label>;
          })}
        </fieldset>
        <div className="drama-form-row">
          <label className="manual-filter">ช่อง TikTok ที่จะลง<select name="tiktokAccountId" defaultValue={accounts[0]?.id}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}</select></label>
          <label className="manual-filter">จำนวนตอนทั้งซีซัน<select name="totalEpisodes" defaultValue="30">
            {[6, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} ตอน</option>)}</select></label>
          <label className="manual-filter">ช็อตต่อตอน (ช็อตละ 10 วิ)<select name="shotsPerEpisode" defaultValue="5">
            {[3, 4, 5].map(n => <option key={n} value={n}>{n} ช็อต ≈ {n * 10} วิ · {n * 10} เครดิต</option>)}</select></label>
          <label className="manual-filter">ตอนต่อวัน<select name="episodesPerDay" defaultValue="1">
            {[1, 2].map(n => <option key={n} value={n}>{n} ตอน/วัน</option>)}</select></label>
        </div>
        <p className="manual-muted drama-note">ใช้เครดิตฟรีของบัญชี Google เท่านั้น ไม่โพสต์ TikTok เอง · ระบบเลือกบัญชีเอง: ตอนใหม่ใช้บัญชีที่เหลือเต็ม (เช่น 5/5) ช็อตที่ต้องซ่อมใช้บัญชีที่เหลือไม่เต็ม (เช่น 3/5, 4/5)</p>
        <button className="manual-primary" type="submit" disabled={all.filter(g => g.active).length === 0}>ให้ AI เขียนซีซันและเริ่มผลิต</button>
      </form>}
      </details>
    </section>

    <section className="manual-panel drama-step" id="step-production" aria-labelledby="series-title">
      {stepHead(3, "series-title", "ติดตามการผลิต", "ดูว่าแต่ละเรื่องถึงตอนไหน ช็อตไหนเสร็จแล้ว ระบบถ่ายทำ ซ่อม และตัดต่อเองทั้งหมด")}
      {series.length === 0 ? <p className="manual-muted">ยังไม่มีละคร เริ่มเรื่องแรกได้ที่ขั้นที่ 2</p>
        : <div className="drama-series-list">{series.map(item => {
          const s = item.series, percent = Math.round(item.readyEpisodes / s.total_episodes * 100);
          const main = label(s.flow_account_id);
          return <article key={s.id} className="drama-card">
            <div className="drama-card-head"><span className={`drama-genre drama-genre-${s.genre.toLowerCase()}`}>{dramaGenreLabels[s.genre]}</span>
              <span className="drama-status">{seriesStatusLabels[s.status]}</span></div>
            <h3><Link href={`/drama/${s.id}`}>{s.title}</Link></h3>
            <p className="drama-logline">{s.logline}</p>
            <div className="drama-progress" role="img" aria-label={`สำเร็จ ${item.readyEpisodes} จาก ${s.total_episodes} ตอน`}><span style={{ width: `${percent}%` }} /></div>
            <p className="drama-meta">สำเร็จ {item.readyEpisodes}/{s.total_episodes} ตอน{item.current ? ` · ${episodeStatusLabels[item.current.status]}` : ""}</p>
            {main && <p className="drama-meta">บัญชีหลัก {main} · {poolText}</p>}
            <p className="drama-next">{nextStep(item, today)}</p>
            {covers.get(s.id) && <Link href={`/drama/${s.id}`} className="drama-cover"><img src={covers.get(s.id)!} alt={`ภาพปกตัวอย่างของ ${s.title}`} /></Link>}
            {item.shotsOf && item.shots.length > 0 && <Link className="drama-more" href={`/drama/${s.id}`}>ช็อตของตอนที่ {item.shotsOf.number}: เสร็จ {item.shotsDone}/{item.shotsTotal} · ดูทีละช็อตและสั่งทำใหม่ →</Link>}
            {item.takes.length > 0 && <a className="drama-more" href="#step-review">{item.takes.some(t => t.review === "PENDING") ? "มีตอนรอคุณตรวจ ไปขั้นที่ 4 →" : "มีเวอร์ชันให้เลือก ไปขั้นที่ 4 →"}</a>}
            {s.status === "COMPLETED" && (item.hasNextStory ? <p className="drama-meta">สร้างเรื่องใหม่ต่อจากเรื่องนี้แล้ว</p>
              : <form action={newStoryAction}><input type="hidden" name="id" value={s.id} />
                <button className="manual-primary" type="submit">สร้างเรื่องใหม่ ({dramaGenreLabels[s.genre]})</button></form>)}
            <Link className="drama-more" href={`/drama/${s.id}`}>ดูรายละเอียดเรื่อง →</Link>
          </article>;
        })}</div>}
    </section>

    <section className="manual-panel drama-step" id="step-review" aria-labelledby="review-title">
      {stepHead(4, "review-title", "ตรวจตอนที่เสร็จ", "ดูคลิปแล้วกด “ผ่าน” หรือ “ไม่ผ่าน” ระบบจะรอจนคุณกด “สร้างตอนต่อไป” ในหน้าเรื่องก่อนใช้เครดิต")}
      {reviewing.length === 0 ? <p className="manual-muted">ยังไม่มีตอนรอตรวจ ตอนที่ตัดต่อเสร็จจะขึ้นมาตรงนี้</p>
        : reviewing.map(item => {
          const s = item.series;
          return <div key={s.id} className="drama-review-series"><h3><Link href={`/drama/${s.id}`}>{s.title}</Link></h3>
            <div className="drama-takes">
              <p className="drama-meta"><strong>ตอนที่ {item.takes[0].number} · {item.takes.length > 1 ? `เทียบ ${item.takes.length} เวอร์ชัน` : item.takes[0].review === "PENDING" ? "รอคุณตรวจ" : "เวอร์ชันที่ไม่ผ่าน"}</strong>
                {" "}เวอร์ชันที่เลือกจะใช้ต่อตอนถัดไป เวอร์ชันอื่นถูกลบทิ้ง</p>
              {item.current && <p className="drama-meta">กำลังถ่ายเวอร์ชัน {item.current.take} อยู่ เสร็จแล้วจะขึ้นมาให้เทียบตรงนี้</p>}
              <div className="drama-take-grid">{item.takes.map(take => {
                const pending = take.review === "PENDING";
                const hidden = <><input type="hidden" name="seriesId" value={s.id} /><input type="hidden" name="episodeId" value={take.id} /></>;
                return <article key={take.id} className={pending ? "drama-take is-pending" : "drama-take"}>
                  {take.flow_clip_id && <video controls playsInline preload="metadata" src={`/api/library/${take.flow_clip_id}/video#t=0.1`} aria-label={`ตอนที่ ${take.number} เวอร์ชัน ${take.take}`} />}
                  <p className="drama-take-label"><strong>เวอร์ชัน {take.take}</strong><span>{pending ? "ใหม่ล่าสุด · รอตรวจ" : "ไม่ผ่าน · เก็บไว้เทียบ"}</span></p>
                  {pending ? <form action={reviewEpisodeAction} className="drama-review-buttons">{hidden}
                    <button className="manual-primary" name="verdict" value="APPROVE" type="submit">{item.takes.length > 1 ? "เลือกเวอร์ชันนี้" : "ผ่าน"} ไปตอนที่ {take.number + 1 > s.total_episodes ? "จบ" : take.number + 1}</button>
                    <button className="manual-secondary" name="verdict" value="REJECT" type="submit">ไม่ผ่าน ทำเวอร์ชันใหม่</button></form>
                    : <form action={takeAction} className="drama-review-buttons">{hidden}
                      <button className="manual-primary" name="op" value="CHOOSE" type="submit" disabled={Boolean(item.current && item.queued)}>เลือกเวอร์ชันนี้</button>
                      <button className="library-link danger" name="op" value="DELETE" type="submit">ลบเวอร์ชันนี้</button></form>}
                </article>;
              })}</div>
              {item.current && item.queued && <p className="drama-meta">ช็อตของเวอร์ชันใหม่อยู่ใน Flow ตอนนี้ เลือกเวอร์ชันเก่าได้เมื่อช็อตนั้นเสร็จ (ระบบจะหยุดถ่ายเวอร์ชันใหม่ให้)</p>}
            </div>
          </div>;
        })}
    </section>

    {library}

  </div>;
}
