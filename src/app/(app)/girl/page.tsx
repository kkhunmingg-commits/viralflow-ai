import { redirect } from "next/navigation";
import { ClipStudioTabs } from "@/components/clip-studio-tabs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { characterStatusLabels, GIRL_CONCEPTS, GIRL_SERIES } from "@/features/channel-girl/plan";
import { faceLinks, readGirl } from "@/features/channel-girl/service";
import { workerLastSeen } from "@/features/flow-farm/service";
import { createGirlAction, pickFaceAction, resetOldClipsAction } from "./actions";
import "../post/post.css";
import "./girl.css";

export const metadata = { title: "สาว AI · Viral Flow AI" };
export const dynamic = "force-dynamic";

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Reads outside render (the clock included). */
async function loadGirlPage(client: Awaited<ReturnType<typeof createClient>>, owner: string) {
  const admin = createAdminClient();
  const [state, lastSeen] = await Promise.all([readGirl(admin, owner), workerLastSeen(client, owner).catch(() => null)]);
  const links = await faceLinks(admin, state.character).catch(() => ({} as Record<string, string>));
  return { state, links, online: lastSeen !== null && Date.now() - Date.parse(lastSeen) < 3 * 60_000 };
}

/** The channel's one AI girl: make 4 faces, pick one, and every new clip is her. Plus the "clear old clips" switch. */
export default async function GirlPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login?next=/girl");
  const owner = data.user.id, { msg } = await searchParams;
  const { state, links, online } = await loadGirlPage(client, owner);
  const character = state.character;
  const chosen = character?.facePath ? links[character.facePath] : null;

  return <div className="manual-page girl-page">
    <ClipStudioTabs />
    <header className="girl-head">
      <p className="eyebrow">ปั้นช่องด้วยสาวไทย AI</p>
      <h1>สาว AI ประจำช่อง</h1>
      <p>คนเดิมทุกคลิป: เปลี่ยนชุดวับ ก่อน/หลัง เต้นเพลงฮิต และชีวิตประจำวัน คนจะกดติดตาม “น้อง” ไม่ใช่ติดตามคลิป</p>
    </header>
    {msg ? <p className="girl-msg" role="status">{msg}</p> : null}
    {!online ? <p className="girl-warn">เครื่องสร้างคลิปบนคอมยังไม่ออนไลน์ เปิดตัวสร้างคลิป Flow บนคอมก่อน ระบบถึงจะทำหน้าและคลิปได้</p> : null}

    <section className="girl-card" aria-label="น้องประจำช่อง">
      {character?.status === "READY" || (character && chosen) ? <div className="girl-chosen">
        {chosen ? <img src={chosen} alt={`หน้าของ${character.name}`} /> : null}
        <div>
          <h2>{character.name}</h2>
          <p className="girl-status ok">{character.status === "READY" ? "พร้อมทำคลิป · คลิปใหม่ทุกคลิปใช้หน้านี้" : "หน้าที่ใช้อยู่ตอนนี้"}</p>
          <a className="girl-button" href="/post">ไปหน้าคลังคลิปเพื่อกด “สร้างคลิป”</a>
        </div>
      </div> : null}

      {character && character.status !== "READY" ? <div className="girl-faces">
        <h2>{characterStatusLabels[character.status]}: {character.name}</h2>
        <p className="girl-note">เริ่มเมื่อ {bangkokTime(character.createdAt)} · แต่ละหน้าใช้เวลาประมาณ 2–5 นาที หน้านี้รีเฟรชเพื่อดูความคืบหน้า</p>
        <div className="girl-grid">
          {character.candidates.map((c, i) => <form key={c.key} action={pickFaceAction} className="girl-face">
            <input type="hidden" name="key" value={c.key} />
            {c.stillPath && links[c.stillPath] ? <img src={links[c.stillPath]} alt={`หน้าแบบที่ ${i + 1}`} />
              : <div className="girl-face-empty">{c.status === "FAILED" ? `ไม่สำเร็จ${c.error ? `: ${c.error}` : ""}` : "กำลังสร้าง…"}</div>}
            <button type="submit" disabled={c.status !== "DONE"}>เลือกแบบที่ {i + 1}</button>
          </form>)}
        </div>
      </div> : null}

      <details className="girl-new" open={!character}>
        <summary>{character ? "สร้างหน้าใหม่อีก 4 แบบ" : "เริ่ม: สร้างหน้าน้องให้เลือก 4 แบบ"}</summary>
        <form action={createGirlAction} className="girl-form">
          <label>ชื่อน้อง<input name="name" required maxLength={40} defaultValue={character?.name ?? "น้องมายด์"} /></label>
          <label>ลุค (ไม่ใส่ก็ได้ ระบบจะสุ่มให้ 4 แบบไม่ซ้ำกัน)
            <textarea name="look" maxLength={300} rows={2} placeholder="เช่น long straight dark-brown hair, fair skin, sweet smile" defaultValue="" />
          </label>
          <label className="girl-check"><input type="checkbox" name="credits" required /> ใช้เครดิต Flow ประมาณ 40 เครดิต (4 คลิปหน้า)</label>
          <button type="submit" className="girl-button">สร้างหน้า 4 แบบ</button>
          <p className="girl-note">เป็นหน้าคนใหม่ที่ AI สร้าง ไม่ลอกหน้าคนจริงหรือดาราคนไหน ตอนโพสต์ให้เปิด “ป้ายเนื้อหา AI” ใน TikTok ทุกครั้ง</p>
        </form>
      </details>
    </section>

    <section className="girl-card" aria-label="แนวคลิป">
      <h2>แนวคลิปที่ระบบจะทำ ({GIRL_CONCEPTS.length} ไอเดีย หมุนเวียนไม่ซ้ำติดกัน)</h2>
      <ul className="girl-series">
        {GIRL_SERIES.map(series => <li key={series}><strong>{series}</strong>
          <span>{GIRL_CONCEPTS.filter(c => c.series === series).map(c => c.title).join(" · ")}</span></li>)}
      </ul>
      <p className="girl-note">ชุดน่ารัก ไม่โป๊ เพราะคลิปโป๊ TikTok ไม่ดันขึ้นหน้า For You และ Flow มักไม่ยอมสร้าง</p>
    </section>

    <section className="girl-card girl-reset" aria-label="ล้างคลิปเดิม">
      <h2>ล้างระบบคลิปเดิม</h2>
      <p>เอาคลิปแนวเดิมที่ยังไม่โพสต์ออกจากคิวและคลัง และเริ่มสถิติใหม่ เพื่อให้ระบบเรียนรู้จากคลิปน้องอย่างเดียว คลิปที่โพสต์ไปแล้วใน TikTok ไม่ถูกแตะ และระบบสำรองข้อมูลเดิมไว้ก่อนเสมอ</p>
      {state.resetAt ? <p className="girl-note">ล้างครั้งล่าสุด {bangkokTime(state.resetAt)}</p> : null}
      <form action={resetOldClipsAction} className="girl-form">
        <label className="girl-check"><input type="checkbox" name="confirm" required /> ยืนยันล้างคลิปและสถิติเดิม</label>
        <button type="submit" className="girl-button danger">ล้างคลิปเดิม</button>
      </form>
    </section>
  </div>;
}
