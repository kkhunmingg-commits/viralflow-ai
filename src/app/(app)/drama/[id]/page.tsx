/* eslint-disable @next/next/no-img-element -- signed Supabase URLs expire; next/image would cache them */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dramaGenreLabels, episodePhaseLabels, episodeStatusLabels, seriesStatusLabels, shotStatusLabels, type EpisodePhase, type ShotStatus } from "@/features/drama/contracts";
import { seriesDetail, signedImage } from "@/features/drama/service";
import { newStoryAction, retryEpisodeAction, reviewEpisodeAction, seriesStatusAction, skipShotAction } from "../actions";
import "../../post/post.css";
import "../drama.css";
export const metadata = { title: "ละครซีรีส์ · Viral Flow AI" };
export const dynamic = "force-dynamic";

const roleLabels = { LEAD: "ตัวเอก", ALLY: "คู่หู", RIVAL: "คู่ปรับ" } as const;
const shotError = (error: string | null) => !error ? null : error === "NO_CREDIT" ? "เครดิต Flow หมด ทำต่อวันใหม่" : error;

/** One series: its bible, story memory, season map, the episode in production shot by shot, and finished episodes. */
export default async function DramaSeriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/post");
  const { id } = await params, { msg } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await seriesDetail(client, data.user.id, id).catch(() => null);
  if (!detail) notFound();
  const { series, episodes, shots } = detail, bible = series.bible, memory = series.story_state;
  const keyStill = await signedImage(createAdminClient(), series.key_still_path).catch(() => null);
  const current = episodes.find(e => e.status !== "READY") ?? null;
  const currentShots = current ? shots.filter(s => s.episode_id === current.id) : [];
  const clipIds = episodes.map(e => e.flow_clip_id).filter((v): v is string => Boolean(v));
  const clips = clipIds.length ? ((await client.from("flow_clips").select("id,status").eq("owner_id", data.user.id).in("id", clipIds)).data ?? []) as Array<{ id: string; status: string }> : [];
  const inLibrary = new Set(clips.filter(c => c.status === "READY" || c.status === "SCHEDULED").map(c => c.id));
  const posted = new Set(clips.filter(c => c.status === "POSTED").map(c => c.id));
  const byNumber = new Map(episodes.map(e => [e.number, e]));
  const accountIds = [series.flow_account_id, series.repair_flow_account_id].filter((v): v is string => Boolean(v));
  const google = accountIds.length ? ((await client.from("flow_accounts").select("id,label").eq("owner_id", data.user.id).in("id", accountIds)).data ?? []) as Array<{ id: string; label: string }> : [];
  const accountLabel = (id: string | null) => google.find(g => g.id === id)?.label ?? null;
  const mainLabel = accountLabel(series.flow_account_id), repairLabel = accountLabel(series.repair_flow_account_id);

  return <div className="manual-page drama-page">
    <header className="manual-hero"><div><p className="manual-eyebrow">Drama Studio · {dramaGenreLabels[series.genre]} · {seriesStatusLabels[series.status]}</p><h1>{series.title}</h1>
      <p>{series.logline}</p></div>
      <Link className="manual-back" href="/post?studio=drama">← ละครทั้งหมด</Link></header>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}

    <div className="drama-controls">
      {series.status === "ACTIVE" && <form action={seriesStatusAction}><input type="hidden" name="id" value={series.id} /><input type="hidden" name="status" value="PAUSED" />
        <button className="manual-secondary" type="submit">พักการผลิต</button></form>}
      {series.status === "PAUSED" && <form action={seriesStatusAction}><input type="hidden" name="id" value={series.id} /><input type="hidden" name="status" value="ACTIVE" />
        <button className="manual-primary" type="submit">ผลิตต่อ</button></form>}
      {series.status === "COMPLETED" && <form action={newStoryAction}><input type="hidden" name="id" value={series.id} />
        <button className="manual-primary" type="submit">สร้างเรื่องใหม่ (แนวเดิม)</button></form>}
      {series.status !== "ARCHIVED" && <form action={seriesStatusAction}><input type="hidden" name="id" value={series.id} /><input type="hidden" name="status" value="ARCHIVED" />
        <button className="manual-secondary" type="submit">เก็บเข้ากรุ</button></form>}
      <span className="manual-muted">ตอนละ {series.shots_per_episode} ช็อต · {series.episodes_per_day} ตอน/วัน · ตัวเขียนบท {series.writer}
        {mainLabel && ` · บัญชีหลัก ${mainLabel}`}{series.flow_account_id && (repairLabel ? ` · บัญชีซ่อม ${repairLabel}` : " · ไม่มีบัญชีซ่อม")}
        {series.auto_next && series.flow_account_id ? " · จบแล้วเริ่มเรื่องใหม่แนวเดิมให้เอง" : ""}</span>
    </div>

    <section className="manual-panel" aria-labelledby="arc-title">
      <h2 id="arc-title">แผนทั้งซีซัน ({series.total_episodes} ตอน)</h2>
      <ol className="drama-arc">{bible.arc.map((phase: EpisodePhase, i: number) => {
        const episode = byNumber.get(i + 1), state = episode?.status ?? (i + 1 < series.next_episode_number ? "READY" : "PLANNED");
        return <li key={i} className={`drama-arc-${state.toLowerCase()}`} title={`ตอนที่ ${i + 1} · ${episodePhaseLabels[phase]}${episode ? ` · ${episode.title}` : ""}`}>
          <span>{i + 1}</span><small>{episodePhaseLabels[phase]}</small></li>;
      })}</ol>
      <p className="manual-muted">ตอนจบถูกล็อกไว้ตั้งแต่วันแรก: {bible.ending}</p>
    </section>

    {current && <section className="manual-panel" aria-labelledby="current-title">
      <div className="manual-section-head"><h2 id="current-title">ตอนที่ {current.number}: {current.title}</h2><span className="drama-status">{episodeStatusLabels[current.status]}</span></div>
      <p className="manual-muted">{episodePhaseLabels[current.phase as EpisodePhase] ?? current.phase} · {current.summary}</p>
      {current.error && <p className="manual-warning">{current.error}</p>}
      <ol className="drama-shots">{currentShots.map(shot => <li key={shot.id} className={`drama-shot drama-shot-${shot.status.toLowerCase()}`}>
        <div><strong>ช็อต {shot.position}</strong> <span className="drama-status">{shotStatusLabels[shot.status as ShotStatus]}</span>{shot.route === "REPAIR" && <span className="drama-status drama-repair">บัญชีซ่อม</span>}
          <small>{shot.reference_mode === "PREVIOUS_FRAME" ? "ต่อจากเฟรมสุดท้ายของช็อตก่อน" : shot.reference_mode === "KEY_STILL" ? "ใช้ภาพตัวละครหลักของเรื่อง" : "ช็อตเปิดตัวละคร (สร้างภาพหลักของเรื่อง)"}</small></div>
        {shot.subtitle && <p className="drama-line">“{shot.subtitle}”</p>}
        {shotError(shot.error) && <p className="manual-warning">{shotError(shot.error)}{shot.attempts ? ` · ลองแล้ว ${shot.attempts} ครั้ง` : ""}</p>}
        {(shot.status === "FAILED" || (shot.status === "PLANNED" && shot.attempts > 0)) && <form action={skipShotAction}><input type="hidden" name="seriesId" value={series.id} />
          <input type="hidden" name="shotId" value={shot.id} /><button className="manual-secondary" type="submit">ข้ามช็อตนี้</button></form>}
        <details><summary>คำสั่งที่ส่งให้ Flow</summary><pre className="drama-prompt">{shot.prompt}</pre></details>
      </li>)}</ol>
      {(current.status === "FAILED") && <form action={retryEpisodeAction}><input type="hidden" name="id" value={series.id} />
        <button className="manual-primary" type="submit">ลองใหม่ (ใช้เครดิต Flow อีกครั้ง)</button></form>}
    </section>}

    <div className="drama-two">
      <section className="manual-panel" aria-labelledby="cast-title">
        <h2 id="cast-title">ตัวละคร</h2>
        {keyStill && <img className="drama-still" src={keyStill} alt="ภาพหลักของตัวละครจากตอนที่ 1" />}
        <ul className="drama-cast">{bible.cast.map(c => <li key={c.role}>
          <strong>{c.name}</strong> <small>{roleLabels[c.role]}</small>
          <p>{c.trait} · อยากได้: {c.want}</p>
          {memory.conditions?.[c.role] && <p className="drama-change">ตอนนี้: {memory.conditions[c.role]?.th}</p>}
          <details><summary>ความลับ (ผู้ชมยังไม่รู้)</summary><p>{c.secret}</p></details>
        </li>)}</ul>
        <h3>สถานที่</h3>
        <ul className="drama-places">{bible.places.map(p => <li key={p.key}>{p.name}</li>)}<li>สิ่งของสำคัญ: {bible.object.name}</li></ul>
      </section>
      <section className="manual-panel" aria-labelledby="memory-title">
        <h2 id="memory-title">ความทรงจำของเรื่อง</h2>
        <p className="manual-muted">ตอนถัดไปเขียนจากข้อมูลนี้เสมอ</p>
        {memory.lastCliff ? <p><strong>ค้างไว้ที่:</strong> {memory.lastCliff.th}</p> : <p className="manual-muted">ยังไม่มีตอนที่ตัดเสร็จ</p>}
        {memory.clues?.length > 0 && <><h3>เบาะแสที่ผู้ชมรู้แล้ว</h3><ul>{memory.clues.map(c => <li key={c}>{c}</li>)}</ul></>}
        {memory.recap?.length > 0 && <><h3>เรื่องย่อตอนล่าสุด</h3><ul className="drama-recap">{memory.recap.toReversed().map(r => <li key={r.episode}><strong>EP.{r.episode} {r.title}</strong> {r.summary}</li>)}</ul></>}
        <details><summary>ความจริงที่ซ่อนอยู่ (เฉลยในไคลแมกซ์)</summary><p>{bible.truth}</p></details>
      </section>
    </div>

    <section className="manual-panel" aria-labelledby="done-title">
      <h2 id="done-title">ตอนที่ตัดต่อเสร็จ</h2>
      {episodes.filter(e => e.status === "READY").length === 0 ? <p className="manual-muted">ตอนแรกจะตัดต่อเสร็จเมื่อครบ {series.shots_per_episode} ช็อต</p> :
        <div className="drama-episodes">{episodes.filter(e => e.status === "READY").toReversed().map(e => <article key={e.id} className="drama-episode">
          {e.flow_clip_id && inLibrary.has(e.flow_clip_id) && <video controls playsInline preload="metadata" src={`/api/library/${e.flow_clip_id}/video#t=0.1`} aria-label={e.title} />}
          <h3>EP.{e.number} {e.title}</h3>
          <p className="drama-meta">{e.review === "APPROVED" ? "✓ ผ่านแล้ว" : "รอคุณตรวจ"}</p>
          {e.review === "PENDING" && <form action={reviewEpisodeAction} className="drama-review-buttons"><input type="hidden" name="seriesId" value={series.id} />
            <input type="hidden" name="episodeId" value={e.id} /><input type="hidden" name="back" value="series" />
            <button className="manual-primary" name="verdict" value="APPROVE" type="submit">ผ่าน</button>
            <button className="manual-secondary" name="verdict" value="REJECT" type="submit">ไม่ผ่าน ทำใหม่พรุ่งนี้</button></form>}
          <p className="manual-muted">{e.summary}</p>
          <p className="drama-meta">{e.flow_clip_id && posted.has(e.flow_clip_id) ? "โพสต์แล้ว" : e.flow_clip_id && inLibrary.has(e.flow_clip_id) ? <Link href={`/post?account=${series.tiktok_account_id}`}>อยู่ในคลัง รอโพสต์ →</Link> : "ไฟล์ถูกลบจากคลังแล้ว"}</p>
        </article>)}</div>}
    </section>
  </div>;
}
