import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DRAMA_GENRES, dramaGenreLabels, episodeStatusLabels, seriesStatusLabels } from "@/features/drama/contracts";
import { GENRE_KITS } from "@/features/drama/genres";
import { dramaAvailable, listSeries, type SeriesSummary } from "@/features/drama/service";
import { bangkokDate } from "@/features/flow-farm/contracts";
import { createSeriesAction } from "./actions";
import "../post/post.css";
import "./drama.css";
export const metadata = { title: "ละครซีรีส์ · Viral Flow AI" };
export const dynamic = "force-dynamic";

function nextStep(item: SeriesSummary, today: string) {
  const { series, current } = item;
  if (series.status === "COMPLETED") return "จบซีซันแล้ว ทุกตอนอยู่ในคลัง";
  if (series.status === "PAUSED") return "พักไว้ กด “ผลิตต่อ” ในหน้าเรื่อง";
  if (current?.status === "FAILED") return `ตอนที่ ${current.number} ต้องตรวจ: ${current.error ?? "ช็อตสร้างไม่สำเร็จ"}`;
  if (current?.status === "ASSEMBLING") return `กำลังตัดต่อตอนที่ ${current.number}`;
  if (current) return `กำลังถ่ายทำตอนที่ ${current.number} · ช็อต ${item.shotsDone}/${item.shotsTotal}${item.queued ? " · อยู่ในคิว Flow" : " · รอเครดิตวันใหม่"}`;
  if (item.latestReady?.started_on === today) return `ตอนที่ ${series.next_episode_number} เริ่มพรุ่งนี้เช้า (เครดิต Flow วันใหม่)`;
  return `ตอนที่ ${series.next_episode_number} จะเริ่มเมื่อเครื่อง Flow worker เช็กคิวรอบถัดไป`;
}

/** Drama Studio home: every series, how far each has got, and a one-click way to start a new one. */
export default async function DramaPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/drama");
  const owner = data.user.id, { msg } = await searchParams;
  const available = await dramaAvailable(client);
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,is_mock").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = ((accountsResult.data ?? []) as Array<{ id: string; display_name: string; is_mock: boolean | null }>)
    .filter(a => process.env.NODE_ENV !== "production" || !a.is_mock);
  const flow = await client.from("flow_accounts").select("tiktok_account_id,clips_per_day_estimate,active").eq("owner_id", owner);
  const flowAccounts = (flow.data ?? []) as Array<{ tiktok_account_id: string | null; clips_per_day_estimate: number; active: boolean }>;
  const series = available ? await listSeries(client, owner).catch(() => []) : [];
  const running = new Set(series.filter(s => s.series.status === "ACTIVE" || s.series.status === "PAUSED").map(s => s.series.genre));
  const today = bangkokDate();

  return <div className="manual-page drama-page">
    <header className="manual-hero"><div><p className="manual-eyebrow">Viral Flow AI · Drama Studio</p><h1>ละครซีรีส์</h1>
      <p>เลือกแนวละคร แล้ว AI จะคิดเรื่อง ตัวละคร และตอนจบให้ทั้งซีซัน ทุกวันระบบสร้างตอนใหม่จากคลิป Google Flow ฟรี ต่อเนื่องจากตอนที่แล้ว ตัดต่อพร้อมซับไทย แล้วเก็บไว้ในคลังรอโพสต์</p></div>
      <Link className="manual-back" href="/post">คลังคลิป →</Link></header>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}

    {!available ? <section className="manual-panel"><h2>ยังเปิดใช้ไม่ได้</h2>
      <p className="manual-muted">ฐานข้อมูลยังไม่มีตาราง Drama Studio ต้องรัน migration <code>20261104120000_drama_studio.sql</code> ใน Supabase ก่อน (ไม่กระทบระบบเดิม)</p></section> : <>
      <section className="drama-series-list" aria-labelledby="series-title">
        <h2 id="series-title">เรื่องที่กำลังผลิต</h2>
        {series.length === 0 ? <p className="manual-muted">ยังไม่มีละคร เริ่มเรื่องแรกได้จากด้านล่าง</p>
          : series.map(item => {
            const s = item.series, percent = Math.round(item.readyEpisodes / s.total_episodes * 100);
            return <Link key={s.id} href={`/drama/${s.id}`} className="drama-card">
              <div className="drama-card-head"><span className={`drama-genre drama-genre-${s.genre.toLowerCase()}`}>{dramaGenreLabels[s.genre]}</span>
                <span className="drama-status">{seriesStatusLabels[s.status]}</span></div>
              <h3>{s.title}</h3>
              <p className="drama-logline">{s.logline}</p>
              <div className="drama-progress" role="img" aria-label={`ตัดต่อเสร็จ ${item.readyEpisodes} จาก ${s.total_episodes} ตอน`}><span style={{ width: `${percent}%` }} /></div>
              <p className="drama-meta">ตัดต่อเสร็จ {item.readyEpisodes}/{s.total_episodes} ตอน{item.current ? ` · ${episodeStatusLabels[item.current.status]}` : ""}</p>
              <p className="drama-next">{nextStep(item, today)}</p>
            </Link>;
          })}
      </section>

      <section className="manual-panel" aria-labelledby="new-title">
        <h2 id="new-title">เริ่มละครเรื่องใหม่</h2>
        {accounts.length === 0 ? <p className="manual-muted">เชื่อมบัญชี TikTok ก่อน <Link href="/accounts">ไปหน้าบัญชี</Link></p> :
        <form action={createSeriesAction} className="drama-form">
          <fieldset className="drama-genres"><legend>แนวละคร</legend>
            {DRAMA_GENRES.map((genre, i) => {
              const premise = GENRE_KITS[genre].premise, taken = running.has(genre);
              return <label key={genre} className={`drama-genre-option${taken ? " is-taken" : ""}`}>
                <input type="radio" name="genre" value={genre} defaultChecked={!taken && i === DRAMA_GENRES.findIndex(g => !running.has(g))} disabled={taken} required />
                <span><strong>{dramaGenreLabels[genre]} · {premise.title}</strong><small>{taken ? "กำลังผลิตอยู่แล้ว" : premise.logline}</small></span>
              </label>;
            })}
          </fieldset>
          <div className="drama-form-row">
            <label className="manual-filter">ช่อง TikTok ที่จะลง<select name="tiktokAccountId" defaultValue={accounts[0]?.id}>
              {accounts.map(a => {
                const google = flowAccounts.filter(f => f.active && (f.tiktok_account_id === a.id || f.tiktok_account_id === null));
                const perDay = google.reduce((sum, f) => sum + f.clips_per_day_estimate, 0);
                return <option key={a.id} value={a.id}>{a.display_name} · Google {google.length} บัญชี ≈ {perDay} คลิป/วัน</option>;
              })}</select></label>
            <label className="manual-filter">จำนวนตอนทั้งซีซัน<select name="totalEpisodes" defaultValue="30">
              {[6, 10, 15, 20, 30].map(n => <option key={n} value={n}>{n} ตอน</option>)}</select></label>
            <label className="manual-filter">ช็อตต่อตอน (ช็อตละ 8 วิ)<select name="shotsPerEpisode" defaultValue="4">
              {[3, 4, 5].map(n => <option key={n} value={n}>{n} ช็อต ≈ {n * 8} วิ · {n * 10} เครดิต</option>)}</select></label>
            <label className="manual-filter">ตอนต่อวัน<select name="episodesPerDay" defaultValue="1">
              {[1, 2].map(n => <option key={n} value={n}>{n} ตอน/วัน</option>)}</select></label>
          </div>
          <p className="manual-muted drama-note">ใช้เครดิตฟรีของบัญชี Google ที่ผูกกับช่องนี้เท่านั้น (Veo 3.1 Lite ช็อตละ 10 เครดิต) ไม่มีค่าใช้จ่ายเพิ่ม ไม่โพสต์ TikTok เอง ตอนที่ตัดเสร็จจะไปรอในคลังให้คุณตรวจและโพสต์เอง ถ้าเครดิตหมดกลางตอน ระบบทำต่อพรุ่งนี้โดยไม่ข้ามเนื้อเรื่อง</p>
          <button className="manual-primary" type="submit" disabled={running.size >= DRAMA_GENRES.length}>ให้ AI เขียนซีซันและเริ่มผลิต</button>
        </form>}
      </section>
    </>}
  </div>;
}
