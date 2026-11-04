import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DRAMA_GENRES, dramaGenreLabels, episodeStatusLabels, seriesStatusLabels } from "@/features/drama/contracts";
import { GENRE_STORIES } from "@/features/drama/genres";
import { pickStory } from "@/features/drama/showrunner";
import { dramaAvailable, listSeries, type SeriesSummary } from "@/features/drama/service";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { createSeriesAction } from "./actions";
import "./drama.css";

interface GoogleAccount { id: string; label: string; tiktok_account_id: string | null; active: boolean; exhausted_on: string | null }

function nextStep(item: SeriesSummary, today: string) {
  const { series, current } = item;
  if (series.status === "COMPLETED") return series.auto_next ? "จบซีซันแล้ว เรื่องใหม่แนวเดียวกันเริ่มต่อในบัญชีเดิม" : "จบซีซันแล้ว ทุกตอนอยู่ในคลัง";
  if (series.status === "PAUSED") return "พักไว้ กด “ผลิตต่อ” ในหน้าเรื่อง";
  if (current?.status === "FAILED") return `ตอนที่ ${current.number} ต้องตรวจ: ${current.error ?? "ช็อตสร้างไม่สำเร็จ"}`;
  if (current?.status === "ASSEMBLING") return `กำลังตัดต่อตอนที่ ${current.number}`;
  if (current) return `กำลังถ่ายทำตอนที่ ${current.number} · ช็อต ${item.shotsDone}/${item.shotsTotal}${item.queued ? " · อยู่ในคิว Flow" : " · รอเครดิตวันใหม่"}`;
  if (item.latestReady?.started_on === today || (series.previous_series_id && series.next_episode_number === 1 && bangkokDate(new Date(series.created_at)) === today))
    return `ตอนที่ ${series.next_episode_number} เริ่มพรุ่งนี้เช้า (เครดิต Flow วันใหม่)`;
  return `ตอนที่ ${series.next_episode_number} จะเริ่มเมื่อเครื่อง Flow worker เช็กคิวรอบถัดไป`;
}

/** Drama mode of the clip studio: every series, which Google accounts make it, and the form that starts a new one. */
export async function DramaHome({ client, owner }: { client: SupabaseClient; owner: string }) {
  const available = await dramaAvailable(client);
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,is_mock").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = ((accountsResult.data ?? []) as Array<{ id: string; display_name: string; is_mock: boolean | null }>)
    .filter(a => process.env.NODE_ENV !== "production" || !a.is_mock);
  const google = ((await client.from("flow_accounts").select("id,label,tiktok_account_id,active,exhausted_on").eq("owner_id", owner).order("priority").order("created_at")).data ?? []) as GoogleAccount[];
  const series = available ? await listSeries(client, owner).catch(() => []) : [];
  const busy = new Map(series.filter(s => (s.series.status === "ACTIVE" || s.series.status === "PAUSED") && s.series.flow_account_id).map(s => [s.series.flow_account_id!, s.series.title]));
  const free = google.filter(g => g.active && !busy.has(g.id));
  const label = (id: string | null) => google.find(g => g.id === id)?.label ?? null;
  const channel = (id: string | null) => id ? accounts.find(a => a.id === id)?.display_name ?? "ช่องอื่น" : "ใช้ได้ทุกช่อง";
  const today = bangkokDate();

  if (!available) return <section className="manual-panel"><h2>ยังเปิดใช้ไม่ได้</h2>
    <p className="manual-muted">ฐานข้อมูลยังไม่มีตาราง Drama Studio ต้องรัน migration ใน Supabase ก่อน (ไม่กระทบระบบเดิม)</p></section>;

  return <div className="drama-page">
    <section className="drama-series-list" aria-labelledby="series-title">
      <h2 id="series-title">ละครที่กำลังผลิต</h2>
      {series.length === 0 ? <p className="manual-muted">ยังไม่มีละคร เริ่มเรื่องแรกได้จากด้านล่าง</p>
        : series.map(item => {
          const s = item.series, percent = Math.round(item.readyEpisodes / s.total_episodes * 100);
          const main = label(s.flow_account_id), repair = label(s.repair_flow_account_id);
          return <Link key={s.id} href={`/drama/${s.id}`} className="drama-card">
            <div className="drama-card-head"><span className={`drama-genre drama-genre-${s.genre.toLowerCase()}`}>{dramaGenreLabels[s.genre]}</span>
              <span className="drama-status">{seriesStatusLabels[s.status]}</span></div>
            <h3>{s.title}</h3>
            <p className="drama-logline">{s.logline}</p>
            <div className="drama-progress" role="img" aria-label={`ตัดต่อเสร็จ ${item.readyEpisodes} จาก ${s.total_episodes} ตอน`}><span style={{ width: `${percent}%` }} /></div>
            <p className="drama-meta">ตัดต่อเสร็จ {item.readyEpisodes}/{s.total_episodes} ตอน{item.current ? ` · ${episodeStatusLabels[item.current.status]}` : ""}</p>
            {main && <p className="drama-meta">บัญชีหลัก {main}{repair ? ` · บัญชีซ่อม ${repair}` : " · ไม่มีบัญชีซ่อม"}</p>}
            <p className="drama-next">{nextStep(item, today)}</p>
          </Link>;
        })}
    </section>

    <section className="manual-panel" aria-labelledby="new-title">
      <h2 id="new-title">เริ่มละครเรื่องใหม่</h2>
      <p className="manual-muted">1 บัญชี Google = 1 เรื่อง วันละ 1 ตอน (5 ช็อต ≈ 40 วินาที) บัญชีหลักจะทำเฉพาะละครเรื่องนี้ ช็อตไหนเสียหรือเครดิตหมดกลางตอน ระบบส่งไปบัญชีซ่อมจนได้ แล้วตัดต่อเป็นตอนพร้อมแคปชันและแฮชแท็กไปรอในคลัง เมื่อครบซีซัน ระบบเริ่มเรื่องใหม่แนวเดียวกันในบัญชีเดิมให้เอง</p>
      {accounts.length === 0 ? <p className="manual-muted">เชื่อมบัญชี TikTok ก่อน <Link href="/accounts">ไปหน้าบัญชี</Link></p>
      : google.length === 0 ? <p className="manual-muted">ยังไม่มีบัญชี Google ผูกบัญชีในแท็บ “คลิป” ก่อน <Link href="/post">ไปผูกบัญชี</Link></p>
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
              {g.label} · {channel(g.tiktok_account_id)}{busy.has(g.id) ? ` · กำลังทำ “${busy.get(g.id)}”` : !g.active ? " · ปิดอยู่" : ""}</option>)}</select></label>
          <label className="manual-filter">บัญชีซ่อม (ไม่บังคับ)<select name="repairFlowAccountId" defaultValue="">
            <option value="">ไม่ใช้บัญชีซ่อม</option>
            {google.filter(g => g.active).map(g => <option key={g.id} value={g.id}>{g.label} · {channel(g.tiktok_account_id)}{busy.has(g.id) ? " · เป็นบัญชีหลักของอีกเรื่อง" : ""}</option>)}</select></label>
          <label className="manual-filter">จำนวนตอนทั้งซีซัน<select name="totalEpisodes" defaultValue="30">
            {[6, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} ตอน</option>)}</select></label>
          <label className="manual-filter">ช็อตต่อตอน (ช็อตละ 8 วิ)<select name="shotsPerEpisode" defaultValue="5">
            {[3, 4, 5].map(n => <option key={n} value={n}>{n} ช็อต ≈ {n * 8} วิ · {n * 10} เครดิต</option>)}</select></label>
          <label className="manual-filter">ตอนต่อวัน<select name="episodesPerDay" defaultValue="1">
            {[1, 2].map(n => <option key={n} value={n}>{n} ตอน/วัน</option>)}</select></label>
        </div>
        <p className="manual-muted drama-note">ใช้เครดิตฟรีของบัญชี Google เท่านั้น ไม่มีค่าใช้จ่ายเพิ่ม และไม่โพสต์ TikTok เอง ตอนที่ตัดเสร็จไปรอในคลังให้คุณตรวจและโพสต์เอง บัญชีซ่อมใช้ร่วมกันได้หลายเรื่อง และยังทำคลิปปกติได้เมื่อว่าง</p>
        <button className="manual-primary" type="submit" disabled={free.length === 0}>{free.length === 0 ? "บัญชี Google ทุกบัญชีมีละครแล้ว" : "ให้ AI เขียนซีซันและเริ่มผลิต"}</button>
      </form>}
    </section>
  </div>;
}
