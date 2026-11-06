import Link from "next/link";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAMA_GENRES, dramaGenreLabels, episodeStatusLabels, seriesStatusLabels } from "@/features/drama/contracts";
import { GENRE_STORIES } from "@/features/drama/genres";
import { OneVideoAtATime } from "./one-video";
import { pickStory } from "@/features/drama/showrunner";
import { dramaAvailable, listSeries, type SeriesSummary } from "@/features/drama/service";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { createAdminClient } from "@/lib/supabase/admin";
import { flowLogins } from "@/features/flow-farm/service";
import { addRepairAccountAction, flowAccountAction } from "../post/flow-actions";
import { continueAfterCreditsAction, createSeriesAction, newStoryAction, redoShotAction, reviewEpisodeAction, takeAction } from "./actions";
import "../post/flow-studio.css";
import "./drama.css";

interface GoogleAccount { id: string; label: string; tiktok_account_id: string | null; active: boolean; exhausted_on: string | null; purpose: "CLIP" | "REPAIR" }

function nextStep(item: SeriesSummary, today: string) {
  const { series, current, toReview, latestReady } = item;
  if (series.status === "COMPLETED") return `จบครบ ${series.total_episodes} ตอนแล้ว`;
  if (toReview) return `ตอนที่ ${toReview.number} ตัดต่อเสร็จ รอคุณตรวจ ดูคลิปด้านล่างแล้วกด “ผ่าน” เพื่อไปตอนที่ ${toReview.number + 1} หรือ “ไม่ผ่าน” เพื่อทำเวอร์ชันใหม่ทันที`;
  if (series.status === "PAUSED") return "พักไว้ กด “ผลิตต่อ” ในหน้าเรื่อง";
  if (current?.status === "FAILED") return `ตอนที่ ${current.number} ต้องตรวจ: ${current.error ?? "ช็อตสร้างไม่สำเร็จ"}`;
  if (current?.status === "ASSEMBLING") return `กำลังตัดต่อตอนที่ ${current.number}`;
  if (current) return `กำลังถ่ายทำตอนที่ ${current.number} · ช็อต ${item.shotsDone}/${item.shotsTotal}${item.queued ? " · อยู่ในคิว Flow"
    : item.shots.some(shot => shot.waitingCredits) ? " · เครดิตหมด รอเครดิตรอบใหม่" : " · กำลังส่งช็อตถัดไป"}`;
  const done = latestReady ? `ตอนที่ ${latestReady.number} สำเร็จ ✓ ` : "";
  if (item.takes.length > 0) return `ตอนที่ ${series.next_episode_number} ไม่ผ่าน กำลังเริ่มถ่ายเวอร์ชันใหม่ (เครื่องสร้างคลิปจะรับงานภายใน 1–2 นาที) ระหว่างนี้เลือกเวอร์ชันเก่าด้านล่างได้`;
  if (latestReady?.started_on === today) return `${done}· ตอนที่ ${series.next_episode_number} เริ่มพรุ่งนี้`;
  return `${done}· ตอนที่ ${series.next_episode_number} กำลังจะเริ่ม`;
}

/** One chip per shot of the episode in production, so the owner sees exactly where it is. */
function shotState(shot: SeriesSummary["shots"][number]) {
  if (shot.status === "DONE") return { tone: "done", text: "✓ เสร็จ" };
  if (shot.status === "SKIPPED") return { tone: "done", text: "ข้าม" };
  if (shot.status === "FAILED") return { tone: "failed", text: "⚠ ต้องตรวจ" };
  if (shot.status === "QUEUED") return shot.generating ? { tone: "live", text: "● กำลังสร้าง" } : { tone: "queued", text: "อยู่ในคิว" };
  return { tone: "waiting", text: "รอคิว" };
}

/** The drama menu: every series, which Google accounts make it, and the form that starts a new one. */
export async function DramaHome({ client, owner, library }: { client: SupabaseClient; owner: string; library?: ReactNode }) {
  const available = await dramaAvailable(client);
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,is_mock").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = ((accountsResult.data ?? []) as Array<{ id: string; display_name: string; is_mock: boolean | null }>)
    .filter(a => process.env.NODE_ENV !== "production" || !a.is_mock);
  const all = ((await client.from("flow_accounts").select("id,label,tiktok_account_id,active,exhausted_on,purpose").eq("owner_id", owner).order("priority").order("created_at")).data ?? []) as GoogleAccount[];
  const google = all.filter(g => g.purpose !== "REPAIR"), repairs = all.filter(g => g.purpose === "REPAIR");
  const logins = await flowLogins(createAdminClient(), owner).catch(() => ({} as Awaited<ReturnType<typeof flowLogins>>));
  const series = available ? await listSeries(client, owner).catch(() => []) : [];
  const busy = new Map(series.filter(s => (s.series.status === "ACTIVE" || s.series.status === "PAUSED") && s.series.flow_account_id).map(s => [s.series.flow_account_id!, s.series.title]));
  const free = google.filter(g => g.active && !busy.has(g.id));
  const label = (id: string | null) => all.find(g => g.id === id)?.label ?? null;
  const repairUse = (id: string) => series.filter(s => s.series.repair_flow_account_id === id && (s.series.status === "ACTIVE" || s.series.status === "PAUSED")).length;
  const loginText = (id: string) => { const l = logins[id]; return l?.state === "READY" ? "✓ ล็อกอินแล้ว" : l?.state === "FAILED" ? `⚠ ล็อกอินไม่สำเร็จ${l.note ? ` (${l.note})` : ""}` : "⏳ รอล็อกอิน (เปิดคอมที่ติดตั้งเครื่องสร้างคลิปไว้)"; };
  const drama = <input type="hidden" name="studio" value="drama" />;
  const channel = (id: string | null) => id ? accounts.find(a => a.id === id)?.display_name ?? "ช่องอื่น" : "ใช้ได้ทุกช่อง";
  const today = bangkokDate();

  if (!available) return <section className="manual-panel"><h2>ยังเปิดใช้ไม่ได้</h2>
    <p className="manual-muted">ฐานข้อมูลยังไม่มีตาราง Drama Studio ต้องรัน migration ใน Supabase ก่อน (ไม่กระทบระบบเดิม)</p></section>;

  return <div className="drama-page">
    <OneVideoAtATime />
    <section className="drama-series-list" aria-labelledby="series-title">
      <h2 id="series-title">ละครที่กำลังผลิต</h2>
      {series.length === 0 ? <p className="manual-muted">ยังไม่มีละคร เริ่มเรื่องแรกได้จากด้านล่าง</p>
        : series.map(item => {
          const s = item.series, percent = Math.round(item.readyEpisodes / s.total_episodes * 100);
          const main = label(s.flow_account_id), repair = label(s.repair_flow_account_id);
          return <article key={s.id} className="drama-card">
            <div className="drama-card-head"><span className={`drama-genre drama-genre-${s.genre.toLowerCase()}`}>{dramaGenreLabels[s.genre]}</span>
              <span className="drama-status">{seriesStatusLabels[s.status]}</span></div>
            <h3><Link href={`/drama/${s.id}`}>{s.title}</Link></h3>
            <p className="drama-logline">{s.logline}</p>
            <div className="drama-progress" role="img" aria-label={`สำเร็จ ${item.readyEpisodes} จาก ${s.total_episodes} ตอน`}><span style={{ width: `${percent}%` }} /></div>
            <p className="drama-meta">สำเร็จ {item.readyEpisodes}/{s.total_episodes} ตอน{item.current ? ` · ${episodeStatusLabels[item.current.status]}` : ""}</p>
            {main && <p className="drama-meta">บัญชีหลัก {main}{repair ? ` · บัญชีซ่อม ${repair}` : " · ไม่มีบัญชีซ่อม"}</p>}
            <p className="drama-next">{nextStep(item, today)}</p>
            {item.shotsOf && item.shots.length > 0 && <>
              <ol className="drama-shot-strip" aria-label={`สถานะช็อตของตอนที่ ${item.shotsOf.number}`}>
              {item.shots.map(shot => { const state = shotState(shot);
                const redoable = item.shotsOf?.status !== "ASSEMBLING" && (shot.status === "FAILED" || shot.status === "SKIPPED" || (shot.status === "DONE" && shot.hasVideo));
                return <li key={shot.position} className={`drama-shot-chip is-${state.tone}`}>
                <strong>ช็อต {shot.position}</strong><small>{state.text}{shot.repair ? " · บัญชีซ่อม" : ""}</small>
                {shot.hasVideo && <video className="drama-shot-video" controls playsInline preload="none" src={`/api/drama/shots/${shot.id}/video`} aria-label={`ช็อต ${shot.position}`} />}
                {redoable && <form action={redoShotAction}><input type="hidden" name="seriesId" value={s.id} /><input type="hidden" name="shotId" value={shot.id} />
                  <button className="drama-shot-redo" type="submit">ทำช็อตนี้ใหม่</button></form>}</li>; })}</ol>
              {item.shots.some(shot => shot.hasVideo) && <p className="drama-meta">กดดูแต่ละช็อตได้ก่อนรวมคลิป ช็อตไหนไม่ดี กด “ทำช็อตนี้ใหม่” ระบบทำแค่ช็อตนั้น แล้วตัดต่อใหม่ให้เอง</p>}
              {!item.queued && item.shots.some(shot => shot.waitingCredits) && <form action={continueAfterCreditsAction} className="drama-continue">
                <input type="hidden" name="id" value={s.id} /><p className="drama-meta">เครดิตหมดระหว่างตอน ระบบจะทำต่อเองเมื่อเครดิตรอบใหม่มา ถ้าเครดิตกลับมาแล้ว กดทำต่อได้เลย</p>
                <button className="manual-primary" type="submit">เครดิตมาแล้ว ทำต่อเลย</button></form>}
            </>}
            {item.takes.length > 0 && <div className="drama-takes">
              <p className="drama-meta"><strong>ตอนที่ {item.takes[0].number} · {item.takes.length > 1 ? `เทียบ ${item.takes.length} เวอร์ชัน` : item.takes[0].review === "PENDING" ? "รอคุณตรวจ" : "เวอร์ชันที่ไม่ผ่าน"}</strong>
                {" "}เลือกเวอร์ชันที่ชอบ ระบบจะใช้เวอร์ชันนั้นไปตอนถัดไป แล้วลบเวอร์ชันอื่นทิ้งทั้งหมด ไม่ถูกใจทุกเวอร์ชัน กด “ไม่ผ่าน ทำเวอร์ชันใหม่” ได้เรื่อยๆ</p>
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
            </div>}
            {s.status === "COMPLETED" && (item.hasNextStory ? <p className="drama-meta">สร้างเรื่องใหม่ต่อจากเรื่องนี้แล้ว</p>
              : <form action={newStoryAction}><input type="hidden" name="id" value={s.id} />
                <button className="manual-primary" type="submit">สร้างเรื่องใหม่ ({dramaGenreLabels[s.genre]})</button></form>)}
            <Link className="drama-more" href={`/drama/${s.id}`}>ดูรายละเอียดเรื่อง →</Link>
          </article>;
        })}
    </section>

    {library}

    <section className="manual-panel" aria-labelledby="new-title">
      <h2 id="new-title">เริ่มละครเรื่องใหม่</h2>
      <p className="manual-muted">บัญชีหลักคือบัญชี Google ที่ผูกไว้ในเมนู “สร้างคลิปโปรโมท” 1 บัญชีล็อกกับละครได้ 1 เรื่อง (วันละ 1 ตอน 5 ช็อต ≈ 40 วินาที) และยังทำคลิปปกติได้เหมือนเดิม โดยระบบทำตอนละครของวันนั้นก่อนแล้วค่อยทำคลิป ช็อตไหนเสียหรือเครดิตหมดกลางตอน ระบบส่งไปบัญชีซ่อมจนได้ แล้วตัดต่อเป็นตอนพร้อมแคปชันและแฮชแท็กไปรอใน “คลังละคร” ด้านบน ทุกตอนรอคุณกด “ผ่าน” ก่อนจะไปตอนถัดไป ถ้า “ไม่ผ่าน” ระบบเก็บเวอร์ชันนั้นไว้ แล้วเริ่มถ่ายเวอร์ชันใหม่ของตอนเดิมทันที ให้เทียบแล้วเลือกเวอร์ชันที่ชอบ เมื่อครบซีซัน กด “สร้างเรื่องใหม่” ในการ์ดของเรื่องนั้นได้เลย</p>
      {accounts.length === 0 ? <p className="manual-muted">เชื่อมบัญชี TikTok ก่อน <Link href="/accounts">ไปหน้าบัญชี</Link></p>
      : google.length === 0 ? <p className="manual-muted">ยังไม่มีบัญชี Google ผูกบัญชีในเมนู “สร้างคลิปโปรโมท” ก่อน <Link href="/post">ไปผูกบัญชี</Link></p>
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
          <label className="manual-filter">บัญชี Google หลัก (ล็อกกับเรื่องนี้)<select name="flowAccountId" defaultValue={free[0]?.id} required>
            {google.map(g => <option key={g.id} value={g.id} disabled={!g.active || busy.has(g.id)}>
              {g.label} · {channel(g.tiktok_account_id)}{busy.has(g.id) ? ` · ล็อกกับ “${busy.get(g.id)}” แล้ว` : !g.active ? " · พักไว้" : ""}</option>)}</select></label>
          <label className="manual-filter">บัญชีซ่อม (ไม่บังคับ)<select name="repairFlowAccountId" defaultValue="">
            <option value="">ไม่ใช้บัญชีซ่อม</option>
            {repairs.filter(g => g.active).map(g => <option key={g.id} value={g.id}>{g.label}{repairUse(g.id) ? ` · ซ่อมให้ ${repairUse(g.id)} เรื่องอยู่` : ""}</option>)}</select></label>
          <label className="manual-filter">จำนวนตอนทั้งซีซัน<select name="totalEpisodes" defaultValue="30">
            {[6, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} ตอน</option>)}</select></label>
          <label className="manual-filter">ช็อตต่อตอน (ช็อตละ 8 วิ)<select name="shotsPerEpisode" defaultValue="5">
            {[3, 4, 5].map(n => <option key={n} value={n}>{n} ช็อต ≈ {n * 8} วิ · {n * 10} เครดิต</option>)}</select></label>
          <label className="manual-filter">ตอนต่อวัน<select name="episodesPerDay" defaultValue="1">
            {[1, 2].map(n => <option key={n} value={n}>{n} ตอน/วัน</option>)}</select></label>
        </div>
        <p className="manual-muted drama-note">ใช้เครดิตฟรีของบัญชี Google เท่านั้น ไม่มีค่าใช้จ่ายเพิ่ม และไม่โพสต์ TikTok เอง ตอนที่ตัดเสร็จไปรอในคลังละครให้คุณตรวจและโพสต์เอง{repairs.length === 0 ? " ยังไม่มีบัญชีซ่อม เพิ่มได้ด้านล่าง" : ""}</p>
        <button className="manual-primary" type="submit" disabled={free.length === 0}>{free.length === 0 ? "บัญชี Google ทุกบัญชีล็อกกับละครแล้ว" : "ให้ AI เขียนซีซันและเริ่มผลิต"}</button>
      </form>}
    </section>

    <section className="manual-panel" aria-labelledby="repair-title">
      <h2 id="repair-title">บัญชีซ่อม ({repairs.length})</h2>
      <p className="manual-muted">บัญชี Google แยกต่างหากสำหรับทำช็อตละครใหม่เมื่อช็อตเสียหรือบัญชีหลักเครดิตหมด ใช้ร่วมกันได้ทุกเรื่อง และไม่ถูกดึงไปทำคลิปปกติ เครดิตจึงเหลือไว้ซ่อมเสมอ</p>
      {repairs.length > 0 && <ol className="library-flow-list">{repairs.map(g => <li key={g.id} className={g.active ? undefined : "paused"}>
        <div><strong>{g.label}</strong><small>{loginText(g.id)} · {!g.active ? "พักไว้" : g.exhausted_on === today ? "เครดิตหมดวันนี้" : "พร้อมซ่อม"}{repairUse(g.id) ? ` · ซ่อมให้ ${repairUse(g.id)} เรื่อง` : ""}</small></div>
        <form action={flowAccountAction} className="library-inline"><input type="hidden" name="id" value={g.id} />{drama}
          {g.exhausted_on === today && <button className="library-link" name="op" value="RESET" type="submit">เติมเครดิตแล้ว</button>}
          {logins[g.id]?.state !== "PENDING" && <button className="library-link" name="op" value="RELOGIN" type="submit">ล็อกอินใหม่</button>}
          <button className="library-link" name="op" value={g.active ? "PAUSE" : "RESUME"} type="submit">{g.active ? "พัก" : "ใช้งาน"}</button>
          <button className="library-link danger" name="op" value="REMOVE" type="submit">เลิกผูก</button></form>
      </li>)}</ol>}
      <form action={addRepairAccountAction} className="library-start">{drama}
        <label className="manual-filter">อีเมล Google ของบัญชีซ่อม<input name="label" required maxLength={60} placeholder="name@gmail.com" /></label>
        <label className="manual-filter">คลิปฟรีต่อวันโดยประมาณ<input name="clipsPerDay" type="number" min={1} max={200} defaultValue={5} /></label>
        <button className="manual-secondary" type="submit">+ เพิ่มบัญชีซ่อม</button></form>
      <p className="manual-muted">เพิ่มแล้ว คอมพิวเตอร์ที่ติดตั้งเครื่องสร้างคลิปจะเปิดหน้าล็อกอิน Google ของบัญชีนี้ให้ครั้งเดียว ใช้บัญชีที่ไม่ได้ผูกในเมนูสร้างคลิปโปรโมท</p>
    </section>
  </div>;
}
