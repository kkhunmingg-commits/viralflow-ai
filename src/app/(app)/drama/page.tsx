import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listLibrary, workerLastSeen, type LibraryClip } from "@/features/flow-farm/service";
import { ClipLibrary } from "../post/clip-library";
import { DramaHome } from "./drama-home";
import { ClipStudioTabs } from "@/components/clip-studio-tabs";
import "../post/post.css";
export const metadata = { title: "ละครซีรีส์ · Viral Flow AI" };
export const dynamic = "force-dynamic";

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Reads outside render (the clock included). */
async function loadDramaPage(client: Awaited<ReturnType<typeof createClient>>, owner: string) {
  const [all, lastSeen, accounts, rejected] = await Promise.all([
    listLibrary(client, owner, undefined, ["DRAMA"]).catch(() => [] as LibraryClip[]),
    workerLastSeen(client, owner).catch(() => null),
    client.from("tiktok_accounts").select("id,is_mock,authorization_status,granted_scopes").eq("owner_id", owner).is("hidden_at", null),
    client.from("drama_episodes").select("flow_clip_id").eq("owner_id", owner).eq("review", "REJECTED"),
  ]);
  // Rejected takes are compared on their series card, not posted.
  const takes = new Set(((rejected.data ?? []) as Array<{ flow_clip_id: string | null }>).map(r => r.flow_clip_id).filter(Boolean));
  const library = all.filter(clip => !takes.has(clip.id));
  // Private posting needs TikTok's publish scope on the episode's channel.
  const publishable = ((accounts.data ?? []) as Array<{ id: string; is_mock: boolean | null; authorization_status: string; granted_scopes: string[] | null }>)
    .filter(a => !a.is_mock && a.authorization_status === "authorized" && (a.granted_scopes ?? []).includes("video.publish")).map(a => a.id);
  const now = Date.now();
  return { library, lastSeen, publishable, now, online: lastSeen !== null && now - Date.parse(lastSeen) < 3 * 60_000 };
}

/** Drama's own menu: every series and its production status, the cut episodes waiting to be posted, and new series. */
export default async function DramaPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/drama");
  const owner = data.user.id, { msg } = await searchParams;
  const { library, lastSeen, publishable, now, online } = await loadDramaPage(client, owner);

  return <div className="manual-page">
    <ClipStudioTabs />
    <header className="manual-hero"><div><p className="manual-eyebrow">Viral Flow AI · Drama Studio</p><h1>ละครซีรีส์</h1>
      <p>เลือกแนวละครกับบัญชี Google แล้ว AI จะคิดเรื่อง ตัวละคร และตอนจบให้ทั้งซีซัน ทุกวันสร้างตอนใหม่ต่อจากตอนที่แล้ว ตรวจทุกช็อต ตัดต่อพร้อมซับไทย แคปชัน และแฮชแท็ก แล้วเก็บไว้ในคลังละครรอโพสต์ (คลิปโปรโมทอยู่ในแท็บ “สร้างคลิปโปรโมท” ด้านบน)</p></div>
      <Link className="manual-back" href="/auto">← กลับหน้าหลัก</Link></header>
    {msg && <p className="library-message" role="status">{msg.slice(0, 300)}</p>}
    <p className={online ? "flow-worker online" : "flow-worker"} role="status"><span aria-hidden="true">●</span>
      {online ? "เครื่องสร้างคลิปออนไลน์ กำลังรอ/ทำงานเบื้องหลัง"
        : lastSeen ? `เครื่องสร้างคลิปไม่ได้ทำงาน (เห็นล่าสุด ${bangkokTime(lastSeen)}) เปิดคอมเครื่องที่ติดตั้งไว้`
          : <>ยังไม่ได้ติดตั้งเครื่องสร้างคลิป ติดตั้งได้ที่ <Link href="/post">สร้างคลิปโปรโมท</Link></>}</p>
    <DramaHome client={client} owner={owner} library={<ClipLibrary library={library} now={now} studio="drama" publishable={publishable}
      eyebrow="ตอนที่ตัดต่อเสร็จ · รอโพสต์" title="คลังละคร" empty="ตอนที่ตัดต่อเสร็จจะมาอยู่ตรงนี้ กด “ผ่าน” ที่การ์ดละครด้านบนเพื่อไปตอนถัดไป แล้วโพสต์จากคลังนี้" />} />
  </div>;
}
