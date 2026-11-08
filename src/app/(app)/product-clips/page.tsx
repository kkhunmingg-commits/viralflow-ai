import Link from "next/link";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ClipStudioTabs } from "@/components/clip-studio-tabs";
import { flowClipStatusLabels, flowErrorLabel, type FlowClipStatus } from "@/features/flow-farm/contracts";
import { workerLastSeen } from "@/features/flow-farm/service";
import { listProductClips, tickProductClips, type ProductClipView } from "@/features/product-links/service";
import { SOCIAL_LABEL, SOCIAL_PLATFORMS, socialReadiness } from "@/features/social-publish/config";
import { postErrorLabel } from "@/features/social-publish/publishers";
import { ClipPhoneActions } from "../post/clip-phone-actions";
import { ProductLinkForm } from "./link-form";
import { deleteProductClipAction, remakeProductClipAction, reviewProductClipAction } from "./actions";
import "../post/post.css";
import "./product-clips.css";

export const metadata = { title: "คลิปสินค้าจากลิงก์ · Viral Flow AI" };
export const dynamic = "force-dynamic";
// Opening the tab may cut a finished clip (ffmpeg) in the background.
export const maxDuration = 300;

const STATUS_TH: Record<ProductClipView["status"], string> = {
  PRODUCING: "กำลังสร้างช็อตใน Flow", ASSEMBLING: "กำลังตัดต่อ", REVIEW: "รอตรวจ", APPROVED: "อนุมัติแล้ว (โพสต์เอง)", PUBLISHING: "กำลังโพสต์",
  PUBLISHED: "โพสต์แล้ว", REJECTED: "ไม่ผ่าน", FAILED: "ไม่สำเร็จ",
};
const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

async function loadPage(client: Awaited<ReturnType<typeof createClient>>, owner: string) {
  const [jobs, lastSeen] = await Promise.all([
    listProductClips(client, owner).then(list => ({ list, available: true })).catch(() => ({ list: [] as ProductClipView[], available: false })),
    workerLastSeen(client, owner).catch(() => null),
  ]);
  return { ...jobs, lastSeen, now: Date.now() };
}

export default async function ProductClipsPage({ searchParams }: { searchParams: Promise<{ msg?: string; account?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/product-clips");
  const owner = data.user.id, { msg, account } = await searchParams;
  // Each visit also moves the queue on (the worker's poll does the same every minute).
  after(() => tickProductClips(createAdminClient(), owner).catch(() => {}));
  const accountsResult = await client.from("tiktok_accounts").select("id,display_name,is_mock").eq("owner_id", owner).is("hidden_at", null).order("created_at", { ascending: true });
  const accounts = ((accountsResult.data ?? []) as Array<{ id: string; display_name: string; is_mock: boolean | null }>)
    .filter(a => process.env.NODE_ENV !== "production" || !a.is_mock).map(a => ({ id: a.id, name: a.display_name }));
  const initialAccount = z.uuid().safeParse(account).success && accounts.some(a => a.id === account) ? account! : accounts[0]?.id ?? "";
  const { list, available, lastSeen, now } = await loadPage(client, owner);
  const readiness = socialReadiness(owner);
  const online = lastSeen !== null && now - Date.parse(lastSeen) < 3 * 60_000;
  const review = list.filter(j => j.status === "REVIEW"), working = list.filter(j => ["PRODUCING", "ASSEMBLING", "PUBLISHING"].includes(j.status)),
    finished = list.filter(j => ["APPROVED", "PUBLISHED", "FAILED", "REJECTED"].includes(j.status));

  return <div className="manual-page">
    <ClipStudioTabs />
    <header className="manual-hero"><div><p className="manual-eyebrow">Viral Flow AI · Shopee · Lazada · Reels · Shorts</p><h1>คลิปสินค้าจากลิงก์</h1>
      <p>วางลิงก์สินค้า ระบบดึงรูปและข้อมูล เขียนสคริปต์ที่พูดเฉพาะสิ่งที่หน้าร้านบอก ไม่เวอร์ ไม่อ้างเกินจริง สร้างคลิปด้วยเครดิตฟรีของ Google Flow แล้วรอให้คุณตรวจ ผ่านแล้วโพสต์ Facebook Reels, Instagram Reels, YouTube Shorts พร้อมคอมเมนต์ลิงก์ให้เอง</p></div></header>
    <ol className="manual-steps" aria-label="ขั้นตอน"><li><span>1</span>วางลิงก์ + เลือก 8/16/32 วิ</li><li><span>2</span>Flow สร้างช็อตเอง</li><li><span>3</span>ตรวจคลิป</li><li><span>4</span>โพสต์ + คอมเมนต์ลิงก์อัตโนมัติ</li></ol>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}
    {!available && <p className="manual-warning">ฐานข้อมูลยังไม่มีตาราง product_link_clips: รันไฟล์ supabase/migrations/20261108160000_product_link_clips.sql ใน Supabase SQL Editor ก่อน แล้วหน้านี้จะใช้ได้</p>}
    <p className={online ? "flow-worker online" : "flow-worker"} role="status"><span aria-hidden="true">●</span>
      {online ? "เครื่องสร้างคลิปออนไลน์ ช็อตที่เข้าคิวจะเริ่มทำเอง" : <>เครื่องสร้างคลิปไม่ได้ทำงาน{lastSeen ? ` (เห็นล่าสุด ${bangkokTime(lastSeen)})` : ""} เปิดคอมที่ติดตั้งไว้ หรือติดตั้งที่ <Link href="/post">หน้าคลิปโปรโมท</Link></>}</p>

    <section className="manual-panel" aria-labelledby="pl-new">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 1</p><h2 id="pl-new">ทำคลิปจากลิงก์สินค้า</h2></div></div>
      {accounts.length ? <ProductLinkForm accounts={accounts} initialAccount={initialAccount} />
        : <p className="manual-warning">ต้องมีบัญชี TikTok ที่ผูกบัญชี Google Flow ไว้ก่อน (ใช้คิวเดียวกับคลิปโปรโมท) <Link href="/accounts">เชื่อมบัญชี →</Link></p>}
    </section>

    <section className="manual-panel" aria-labelledby="pl-review">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 3 · ไม่มีอะไรโพสต์จนกว่าจะกดผ่าน</p><h2 id="pl-review">คลิปรอตรวจ ({review.length})</h2></div></div>
      {review.length === 0 ? <p className="manual-muted">คลิปที่ตัดต่อเสร็จจะมารอตรงนี้</p> : <div className="pl-cards">{review.map(job => <ReviewCard key={job.id} job={job} ready={readiness.ready} />)}</div>}
    </section>

    {working.length > 0 && <section className="manual-panel" aria-labelledby="pl-working">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 2</p><h2 id="pl-working">กำลังทำ ({working.length})</h2></div></div>
      <div className="pl-cards">{working.map(job => <WorkingCard key={job.id} job={job} />)}</div>
    </section>}

    {finished.length > 0 && <section className="manual-panel" aria-labelledby="pl-done">
      <div className="manual-section-head"><div><p className="manual-eyebrow">ขั้นที่ 4</p><h2 id="pl-done">โพสต์แล้ว / ประวัติ</h2></div></div>
      <div className="pl-cards">{finished.map(job => <DoneCard key={job.id} job={job} />)}</div>
    </section>}

    <details className="manual-panel" open={readiness.ready.length === 0}><summary><strong>ตั้งค่าโพสต์อัตโนมัติ</strong>
      <small>{readiness.ready.length ? `พร้อม: ${readiness.ready.map(p => SOCIAL_LABEL[p]).join(", ")}` : "ยังไม่ได้ตั้งค่าแพลตฟอร์มใด"}</small></summary>
      <ul className="pl-setup">{SOCIAL_PLATFORMS.map(p => <li key={p}><strong>{SOCIAL_LABEL[p]}</strong>{readiness.missing[p].length
        ? <> · ยังขาดค่าใน Vercel: <code>{readiness.missing[p].join(", ")}</code></> : readiness.ownerOk ? " · ✓ พร้อมโพสต์" : " · ตั้งค่าแล้ว แต่บัญชีเว็บนี้ไม่ได้รับอนุญาต (SOCIAL_PUBLISH_OWNER_IDS)"}</li>)}
        <li><strong>TikTok</strong> · ส่งเป็นแบบร่าง/แชร์จากมือถือเท่านั้น (API ของ TikTok ใส่ตะกร้าสินค้าไม่ได้)</li></ul>
      <p className="manual-muted">ขั้นตอนขอสิทธิ์ Meta และ Google อยู่ในคู่มือ docs/PRODUCT_LINK_CLIPS.md</p>
    </details>
  </div>;
}

function Script({ job }: { job: ProductClipView }) {
  return <details className="pl-script"><summary>สคริปต์ {job.script.shots.length} ช็อต · ฉาก “{job.script.setTh}”</summary>
    <ol>{job.script.shots.map(s => <li key={s.position}><strong>{s.roleTh}</strong> “{s.narration}”</li>)}</ol>
    {job.script.dropped.length > 0 && <p className="manual-muted">ตัดออก: {job.script.dropped.map(d => `“${d.text}” (${d.reason})`).join(" · ")}</p>}
    {job.script.compliance.issues.length > 0 && <p className="manual-warning">ตรวจกฎ: {job.script.compliance.issues.join(" · ")}</p>}
    <textarea className="library-caption" readOnly rows={5} defaultValue={job.script.caption} aria-label="แคปชัน" />
    <p className="manual-muted">คอมเมนต์แรก: {job.script.comment}</p>
  </details>;
}

function ReviewCard({ job, ready }: { job: ProductClipView; ready: string[] }) {
  return <article className="library-clip pl-card">
    {job.final_clip_id && <video controls playsInline preload="metadata" src={`/api/library/${job.final_clip_id}/video#t=0.1`} aria-label={job.title} />}
    <div className="library-clip-body">
      <h3>{job.script.shortName}</h3>
      <p className="library-meta">{job.platform === "SHOPEE" ? "Shopee" : "Lazada"} · {job.length_seconds} วิ · <a href={job.link} target="_blank" rel="noreferrer noopener">เปิดหน้าสินค้า</a></p>
      <p className="manual-muted">ตรวจ: สินค้าในคลิปหน้าตาตรงกับของจริง ตัวหนังสือ/โลโก้ไม่เพี้ยน และเสียงพูดไม่เกินจากหน้าร้าน</p>
      <Script job={job} />
      <form action={reviewProductClipAction} className="pl-review">
        <input type="hidden" name="id" value={job.id} />
        <fieldset><legend>โพสต์อัตโนมัติไปที่</legend>{SOCIAL_PLATFORMS.map(p => <label key={p} className="manual-check">
          <input type="checkbox" name="target" value={p} defaultChecked={ready.includes(p)} disabled={!ready.includes(p)} />
          {SOCIAL_LABEL[p]}{ready.includes(p) ? "" : " (ยังไม่ได้ตั้งค่า)"}</label>)}</fieldset>
        <div className="library-inline">
          <button className="manual-primary" name="decision" value="APPROVE" type="submit">ผ่าน · โพสต์</button>
          <button className="manual-secondary" name="decision" value="REJECT" type="submit">ไม่ผ่าน</button>
        </div>
      </form>
    </div>
  </article>;
}

function WorkingCard({ job }: { job: ProductClipView }) {
  return <article className="pl-row">
    <div><strong>{job.script.shortName}</strong> · {job.length_seconds} วิ · {STATUS_TH[job.status]}
      {job.status === "PRODUCING" && <ol className="pl-shots">{job.script.shots.map((shot, i) => {
        const state = job.shots[i];
        const label = state ? flowClipStatusLabels[state.status as FlowClipStatus] ?? state.status : "รอคิว";
        return <li key={i}>{shot.roleTh}: {label}{state?.error && state.status !== "READY" ? ` · ${flowErrorLabel(state.error)}` : ""}{(job.shot_attempts[i] ?? 1) > 1 ? ` (ครั้งที่ ${job.shot_attempts[i]})` : ""}</li>;
      })}</ol>}
      {job.status === "PUBLISHING" && <ul className="pl-shots">{job.posts.map(p => <li key={p.platform}>{SOCIAL_LABEL[p.platform]}: {p.status === "DONE" ? "✓ โพสต์แล้ว" : p.status === "FAILED" ? `✗ ${postErrorLabel(p.error)}` : "กำลังส่ง…"}</li>)}</ul>}
      {job.error && <p className="manual-warning">{job.error}</p>}
    </div>
    {job.status === "PRODUCING" && <form action={deleteProductClipAction}><input type="hidden" name="id" value={job.id} /><button className="library-link danger" type="submit">ยกเลิก</button></form>}
  </article>;
}

function DoneCard({ job }: { job: ProductClipView }) {
  const caption = job.script.caption;
  return <article className="pl-row">
    <div><strong>{job.script.shortName}</strong> · {job.length_seconds} วิ · {STATUS_TH[job.status]}{job.published_at ? ` · ${bangkokTime(job.published_at)}` : ""}
      {job.posts.length > 0 && <ul className="pl-shots">{job.posts.map(p => <li key={p.platform}>{SOCIAL_LABEL[p.platform]}: {p.status === "DONE"
        ? <>{p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener">✓ ดูโพสต์</a> : "✓ โพสต์แล้ว"}{p.commented ? " · คอมเมนต์ลิงก์แล้ว" : ` · ${postErrorLabel(p.error) ?? "ยังไม่ได้คอมเมนต์ลิงก์"}`}</>
        : `✗ ${postErrorLabel(p.error)}`}</li>)}</ul>}
      {job.error && <p className="manual-warning">{job.error}</p>}
      {job.final_clip_id && (job.status === "APPROVED" || job.status === "PUBLISHED") && <div className="pl-tiktok"><p className="manual-muted">TikTok: แชร์จากมือถือเป็นแบบร่าง แล้วปักตะกร้าในแอปเอง</p>
        <ClipPhoneActions clipId={job.final_clip_id} caption={caption} />
        <a className="manual-secondary" href={`/api/library/${job.final_clip_id}/video?download=1`}>ดาวน์โหลด MP4</a></div>}
    </div>
    <div className="library-inline">
      <form action={remakeProductClipAction}><input type="hidden" name="id" value={job.id} /><button className="manual-secondary" type="submit">ทำใหม่ (ฉากใหม่)</button></form>
      <form action={deleteProductClipAction}><input type="hidden" name="id" value={job.id} /><button className="library-link danger" type="submit">ลบ</button></form>
    </div>
  </article>;
}
