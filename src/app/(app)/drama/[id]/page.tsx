/* eslint-disable @next/next/no-img-element -- signed Supabase URLs expire; next/image would cache them */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dramaGenreLabels, episodePhaseLabels, episodeStatusLabels, seriesStatusLabels, type EpisodePhase } from "@/features/drama/contracts";
import { repairPool, seriesDetail, signedImage } from "@/features/drama/service";
import { repairShotsLeft } from "@/features/drama/engine";
import { continueAfterCreditsAction, newStoryAction, redoShotAction, remakeTakeAction, retryEpisodeAction, reviewEpisodeAction, seriesStatusAction, skipShotAction, startNextEpisodeAction, takeAction } from "../actions";
import { OneVideoAtATime } from "../one-video";
import { RestoreCut } from "../restore-cut";
import { ClipStudioTabs } from "@/components/clip-studio-tabs";
import "../../post/post.css";
import "../drama.css";
export const metadata = { title: "ละครซีรีส์ · Viral Flow AI" };
export const dynamic = "force-dynamic";

const roleLabels = { LEAD: "ตัวเอก", ALLY: "คู่หู", RIVAL: "คู่ปรับ" } as const;
const shotError = (error: string | null) => !error ? null : error === "NO_CREDIT" ? "เครดิต Flow หมด รอเครดิตรอบใหม่" : error;
/** What a shot is doing right now, in words. */
function shotNow(shot: { status: string; retry_after: string | null; video_path: string | null }, generating: boolean) {
  if (shot.status === "DONE") return shot.video_path ? "เสร็จแล้ว · กดดูได้" : "เสร็จแล้ว";
  if (shot.status === "QUEUED") return generating ? "กำลังสร้างใน Flow" : "อยู่ในคิว รอเครื่องสร้างคลิปรับงาน";
  if (shot.status === "PLANNED") return shot.retry_after ? "รอเครดิตรอบใหม่" : "รอคิว";
  if (shot.status === "FAILED") return "สร้างไม่สำเร็จ ต้องตรวจ";
  return "ข้ามช็อตนี้";
}

/** One series: its bible, story memory, season map, the episode in production shot by shot, and finished episodes. */
export default async function DramaSeriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/drama");
  const { id } = await params, { msg } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await seriesDetail(client, data.user.id, id).catch(() => null);
  if (!detail) notFound();
  const { series, episodes, shots } = detail, bible = series.bible, memory = series.story_state;
  const keyStill = await signedImage(createAdminClient(), series.key_still_path).catch(() => null);
  // The episode being made, or else its cut waiting for review: either way each shot can be watched and made again.
  const current = episodes.find(e => e.status !== "READY") ?? episodes.find(e => e.status === "READY" && e.review === "PENDING" && e.number === series.next_episode_number) ?? null;
  const currentShots = current ? shots.filter(s => s.episode_id === current.id) : [];
  const queuedClips = currentShots.filter(s => s.status === "QUEUED" && s.flow_clip_id).map(s => s.flow_clip_id as string);
  const generating = new Set(queuedClips.length ? ((await client.from("flow_clips").select("id,status").eq("owner_id", data.user.id).in("id", queuedClips)).data ?? [])
    .filter(c => c.status === "GENERATING").map(c => c.id as string) : []);
  const busy = currentShots.some(s => s.status === "QUEUED");
  const waitingCredits = !busy && currentShots.some(s => s.status === "PLANNED" && s.retry_after);
  const canRedo = current && current.review === "PENDING" && current.status !== "ASSEMBLING";
  const clipIds = episodes.map(e => e.flow_clip_id).filter((v): v is string => Boolean(v));
  const clips = clipIds.length ? ((await client.from("flow_clips").select("id,status,storage_path").eq("owner_id", data.user.id).in("id", clipIds)).data ?? []) as Array<{ id: string; status: string; storage_path: string | null }> : [];
  const inLibrary = new Set(clips.filter(c => c.status === "READY" || c.status === "SCHEDULED").map(c => c.id));
  const posted = new Set(clips.filter(c => c.status === "POSTED").map(c => c.id));
  // Posted drama cuts keep their file, so finished episodes can be rewatched here.
  const watchable = new Set(clips.filter(c => c.storage_path && (inLibrary.has(c.id) || posted.has(c.id))).map(c => c.id));
  const byNumber = new Map(episodes.map(e => [e.number, e]));
  const accountIds = [series.flow_account_id].filter((v): v is string => Boolean(v));
  const pool = await repairPool(createAdminClient(), data.user.id).catch(() => []), poolLeft = pool.reduce((sum, a) => sum + repairShotsLeft(a), 0);
  const google = accountIds.length ? ((await client.from("flow_accounts").select("id,label").eq("owner_id", data.user.id).in("id", accountIds)).data ?? []) as Array<{ id: string; label: string }> : [];
  const accountLabel = (id: string | null) => google.find(g => g.id === id)?.label ?? null;
  const mainLabel = accountLabel(series.flow_account_id);

  return <div className="manual-page drama-page">
    <ClipStudioTabs />
    <header className="manual-hero"><div><p className="manual-eyebrow">Drama Studio · {dramaGenreLabels[series.genre]} · {seriesStatusLabels[series.status]}</p><h1>{series.title}</h1>
      <p>{series.logline}</p></div>
      <Link className="manual-back" href="/drama">← ละครทั้งหมด</Link></header>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}

    <div className="drama-controls">
      {series.status === "ACTIVE" && <form action={seriesStatusAction}><input type="hidden" name="id" value={series.id} /><input type="hidden" name="status" value="PAUSED" />
        <button className="manual-secondary" type="submit">พักการผลิต</button></form>}
      {series.status === "PAUSED" && <form action={startNextEpisodeAction}><input type="hidden" name="id" value={series.id} />
        <button className="manual-primary" type="submit">สร้างตอนต่อไป</button></form>}
      {series.status === "COMPLETED" && <form action={newStoryAction}><input type="hidden" name="id" value={series.id} />
        <button className="manual-primary" type="submit">สร้างเรื่องใหม่ (แนวเดิม)</button></form>}
      {series.status !== "ARCHIVED" && <form action={seriesStatusAction}><input type="hidden" name="id" value={series.id} /><input type="hidden" name="status" value="ARCHIVED" />
        <button className="manual-secondary" type="submit">เก็บเข้ากรุ</button></form>}
      <span className="manual-muted">ตอนละ {series.shots_per_episode} ช็อต · {series.episodes_per_day} ตอน/วัน · ตัวเขียนบท {series.writer}
        {mainLabel && ` · บัญชีหลัก ${mainLabel}`}{series.flow_account_id && (pool.length === 0 ? " · ไม่มีบัญชีซ่อม" : poolLeft > 0 ? ` · บัญชีซ่อมกองกลาง ${pool.length} บัญชี ซ่อมได้อีก ${poolLeft} ช็อตวันนี้` : ` · บัญชีซ่อม ${pool.length} บัญชี เครดิตหมดแล้ว`)}
        {series.auto_next && series.flow_account_id ? " · จบแล้วเริ่มเรื่องใหม่แนวเดิมให้เอง" : ""}</span>
    </div>

    <section className="manual-panel" aria-labelledby="arc-title">
      <h2 id="arc-title">แผนทั้งซีซัน ({series.total_episodes} ตอน)</h2>
      <ol className="drama-arc">{bible.arc.map((phase: EpisodePhase, i: number) => {
        const episode = byNumber.get(i + 1), state = episode?.status ?? (i + 1 < series.next_episode_number ? "READY" : "PLANNED");
        const target = episode?.status === "READY" ? `#ep-${i + 1}` : episode && episode.id === current?.id ? "#current-title" : null;
        const tile = <><span>{i + 1}</span><small>{episodePhaseLabels[phase]}</small></>;
        return <li key={i} className={`drama-arc-${state.toLowerCase()}`} title={`ตอนที่ ${i + 1} · ${episodePhaseLabels[phase]}${episode ? ` · ${episode.title}` : ""}`}>
          {target ? <a href={target} aria-label={`ดูตอนที่ ${i + 1}`}>{tile}</a> : tile}</li>;
      })}</ol>
      <p className="manual-muted">ตอนจบถูกล็อกไว้ตั้งแต่วันแรก: {bible.ending}</p>
    </section>

    {current && <section className="manual-panel" aria-labelledby="current-title">
      <OneVideoAtATime />
      <div className="manual-section-head"><h2 id="current-title">ตอนที่ {current.number}: {current.title}{current.take > 1 ? ` · เวอร์ชัน ${current.take}` : ""}</h2>
        <span className="drama-status">{current.status === "READY" ? "ตัดต่อเสร็จ รอคุณตรวจ" : episodeStatusLabels[current.status]}</span></div>
      <p className="manual-muted">{episodePhaseLabels[current.phase as EpisodePhase] ?? current.phase} · {current.summary}</p>
      {current.error && <p className="manual-warning">{current.error}</p>}
      <p className="drama-meta">ดูทีละช็อตได้ก่อนรวมคลิป ช็อตไหนไม่ดี กด “ทำช็อตนี้ใหม่” ระบบทำแค่ช็อตนั้นแล้วตัดต่อใหม่ให้เอง (1 เวอร์ชันใช้ได้ไม่เกิน 100 เครดิต)</p>
      {waitingCredits && <form action={continueAfterCreditsAction} className="drama-continue"><input type="hidden" name="id" value={series.id} />
        <p className="manual-warning">เครดิตหมดระหว่างตอน ระบบจะทำต่อเองเมื่อเครดิตรอบใหม่มา ถ้าเครดิตกลับมาแล้ว กดทำต่อได้เลย</p>
        <button className="manual-primary" type="submit">เครดิตมาแล้ว ทำต่อเลย</button></form>}
      <ol className="drama-shots">{currentShots.map(shot => {
        const redoable = canRedo && (shot.status === "FAILED" || shot.status === "SKIPPED" || (shot.status === "DONE" && Boolean(shot.video_path)));
        return <li key={shot.id} className={`drama-shot drama-shot-${shot.status.toLowerCase()}`}>
        <div><strong>ช็อต {shot.position}</strong> <span className="drama-status">{shotNow(shot, Boolean(shot.flow_clip_id && generating.has(shot.flow_clip_id)))}</span>{shot.route === "REPAIR" && <span className="drama-status drama-repair">บัญชีซ่อม</span>}
          <small>{shot.reference_mode === "PREVIOUS_FRAME" ? "ต่อจากเฟรมสุดท้ายของช็อตก่อน" : shot.reference_mode === "KEY_STILL" ? "ใช้ภาพตัวละครหลักของเรื่อง" : "ช็อตเปิดตัวละคร (สร้างภาพหลักของเรื่อง)"}</small></div>
        {shot.subtitle && <p className="drama-line">“{shot.subtitle}”</p>}
        {shot.video_path && <video className="drama-shot-player" controls playsInline preload="metadata" src={`/api/drama/shots/${shot.id}/video#t=0.1`} aria-label={`ช็อต ${shot.position}`} />}
        {shotError(shot.error) && shot.status !== "DONE" && <p className="manual-warning">{shotError(shot.error)}{shot.attempts ? ` · ลองแล้ว ${shot.attempts} ครั้ง` : ""}</p>}
        <div className="drama-review-buttons">
          {redoable && <form action={redoShotAction}><input type="hidden" name="seriesId" value={series.id} /><input type="hidden" name="shotId" value={shot.id} />
            <button className="manual-secondary" type="submit">ทำช็อตนี้ใหม่</button></form>}
          {(shot.status === "FAILED" || (shot.status === "PLANNED" && shot.attempts > 0)) && <form action={skipShotAction}><input type="hidden" name="seriesId" value={series.id} />
            <input type="hidden" name="shotId" value={shot.id} /><button className="manual-secondary" type="submit">ข้ามช็อตนี้</button></form>}
        </div>
        <details><summary>คำสั่งที่ส่งให้ Flow</summary><pre className="drama-prompt">{shot.prompt}</pre></details>
      </li>; })}</ol>
      <div className="drama-review-buttons">
        {current.status === "FAILED" && <form action={retryEpisodeAction}><input type="hidden" name="id" value={series.id} />
          <button className="manual-primary" type="submit">ลองใหม่ (ใช้เครดิต Flow อีกครั้ง)</button></form>}
        {current.status === "READY" ? <form action={reviewEpisodeAction}><input type="hidden" name="seriesId" value={series.id} />
          <input type="hidden" name="episodeId" value={current.id} /><input type="hidden" name="back" value="series" />
          <button className="library-link danger" name="verdict" value="REJECT" type="submit">สร้างใหม่ทั้งตอน (เก็บเวอร์ชันนี้ไว้เทียบ)</button></form>
          : current.status !== "ASSEMBLING" && <form action={remakeTakeAction}><input type="hidden" name="id" value={series.id} />
          <button className="library-link danger" type="submit" disabled={busy}>สร้างใหม่ทั้งตอน (ทิ้งช็อตที่ทำไว้)</button></form>}
      </div>
      {busy && current.status !== "READY" && <p className="drama-meta">มีช็อตอยู่ใน Flow ตอนนี้ กด “สร้างใหม่ทั้งตอน” ได้เมื่อช็อตนั้นเสร็จ</p>}
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
        <div className="drama-episodes">{episodes.filter(e => e.status === "READY").toReversed().map(e => <article key={e.id} id={e.review === "REJECTED" ? undefined : `ep-${e.number}`} className="drama-episode">
          {e.flow_clip_id && watchable.has(e.flow_clip_id) && <video controls playsInline preload="metadata" src={`/api/library/${e.flow_clip_id}/video#t=0.1`} aria-label={e.title} />}
          <h3>EP.{e.number} {e.title}{e.take > 1 || e.review === "REJECTED" ? ` · เวอร์ชัน ${e.take}` : ""}</h3>
          <p className="drama-meta">{e.review === "APPROVED" ? "✓ ผ่านแล้ว" : e.review === "REJECTED" ? "ไม่ผ่าน · เก็บไว้เทียบ" : "รอคุณตรวจ"}</p>
          {e.review === "REJECTED" && <form action={takeAction} className="drama-review-buttons"><input type="hidden" name="seriesId" value={series.id} />
            <input type="hidden" name="episodeId" value={e.id} /><input type="hidden" name="back" value="series" />
            <button className="manual-primary" name="op" value="CHOOSE" type="submit">เลือกเวอร์ชันนี้ (ลบเวอร์ชันอื่น)</button>
            <button className="library-link danger" name="op" value="DELETE" type="submit">ลบเวอร์ชันนี้</button></form>}
          {e.review === "PENDING" && <form action={reviewEpisodeAction} className="drama-review-buttons"><input type="hidden" name="seriesId" value={series.id} />
            <input type="hidden" name="episodeId" value={e.id} /><input type="hidden" name="back" value="series" />
            <button className="manual-primary" name="verdict" value="APPROVE" type="submit">ผ่าน</button>
            <button className="manual-secondary" name="verdict" value="REJECT" type="submit">ไม่ผ่าน ทำเวอร์ชันใหม่</button></form>}
          <p className="manual-muted">{e.summary}</p>
          <p className="drama-meta">{e.flow_clip_id && posted.has(e.flow_clip_id) ? (watchable.has(e.flow_clip_id) ? "โพสต์แล้ว · เก็บไฟล์ไว้ดูย้อนหลัง" : <>โพสต์แล้ว · ไฟล์ถูกลบจากระบบแล้ว <RestoreCut clipId={e.flow_clip_id} /></>) : e.review === "REJECTED" ? "เทียบกับเวอร์ชันอื่นได้ที่การ์ดละคร" : e.flow_clip_id && inLibrary.has(e.flow_clip_id) ? <Link href="/drama#library">อยู่ในคลังละคร รอโพสต์ →</Link> : "ไฟล์ถูกลบจากคลังแล้ว"}</p>
        </article>)}</div>}
    </section>
  </div>;
}
