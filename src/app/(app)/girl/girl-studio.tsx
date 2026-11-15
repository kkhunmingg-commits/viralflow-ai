import { createAdminClient } from "@/lib/supabase/admin";
import { characterStatusLabels, MAX_FACES_SHOWN, randomNickname } from "@/features/channel-girl/plan";
import { sampleArcs } from "@/features/channel-girl/stories";
import { faceLinks, readGirl } from "@/features/channel-girl/service";
import { createGirlAction, pickFaceAction, renameGirlAction, resetOldClipsAction } from "./actions";
import "./girl.css";

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Reads outside render (the clock included). */
async function loadGirlStudio(owner: string) {
  const admin = createAdminClient();
  const state = await readGirl(admin, owner);
  const links = await faceLinks(admin, state.character).catch(() => ({} as Record<string, string>));
  return { state, links, nickname: randomNickname(), samples: sampleArcs(Math.random) };
}

/**
 * The AI girl inside the clip page (16 Nov owner: she replaces the old warm-up clips on this page): make a face one
 * at a time, pick one, see the story being told, and clear the old clips.
 */
export async function GirlStudio({ owner }: { owner: string }) {
  const { state, links, nickname, samples } = await loadGirlStudio(owner);
  const character = state.character;
  const chosen = character?.facePath ? links[character.facePath] : null;
  const busy = Boolean(character?.candidates.some(c => c.status === "QUEUED"));

  return <div id="girl" className="girl-page">
    <section className="girl-card" aria-label="น้องประจำช่อง">
      {character?.status === "READY" || (character && chosen) ? <div className="girl-chosen">
        {chosen ? <img src={chosen} alt={`หน้าของ${character.name}`} /> : null}
        <div>
          <h2>{character.name}</h2>
          <p className="girl-status ok">{character.status === "READY" ? "พร้อมทำคลิป · คลิปใหม่ทุกคลิปใช้หน้านี้" : "หน้าที่ใช้อยู่ตอนนี้"}</p>
          <a className="girl-button" href="#make-title">ไปกด “สร้างคลิป” ด้านล่าง</a>
        </div>
      </div> : null}

      {character?.candidates.length ? <div className="girl-faces">
        <h2>{characterStatusLabels[character.status]}: {character.name}</h2>
        <p className="girl-note">สร้างทีละ 1 แบบ (10 เครดิต) ไม่ชอบก็กด “สร้างหน้าใหม่” แบบเก่ายังอยู่ให้เลือก · แต่ละหน้าใช้เวลาประมาณ 2–5 นาที รีเฟรชหน้านี้เพื่อดู</p>
        {character.candidates.at(-1)?.status === "FAILED" ? <p className="girl-note">หน้าล่าสุดสร้างไม่สำเร็จ: Flow ทำไม่ผ่าน (ไม่เสียเครดิต) กดสร้างหน้าใหม่ได้เลย</p> : null}
        <div className="girl-grid">
          {character.candidates.filter(c => c.status !== "FAILED").slice(-MAX_FACES_SHOWN).toReversed().map(c => <form key={c.key} action={pickFaceAction} className="girl-face">
            <input type="hidden" name="key" value={c.key} />
            {c.stillPath && links[c.stillPath] ? <img src={links[c.stillPath]} alt={`หน้าแบบที่ ${c.key.split("-")[1]}`} />
              : <div className="girl-face-empty">กำลังสร้าง…</div>}
            <button type="submit" disabled={c.status !== "DONE" || c.stillPath === character.facePath}>
              {c.stillPath && c.stillPath === character.facePath ? "ใช้หน้านี้อยู่" : `เลือกแบบที่ ${c.key.split("-")[1]}`}</button>
          </form>)}
        </div>
      </div> : null}

      <form action={createGirlAction} className="girl-form">
        <h2>{character ? "สร้างหน้าใหม่ 1 แบบ" : "เริ่ม: สร้างหน้าน้อง 1 แบบ"}</h2>
        <label>ชื่อน้อง (สุ่มฉายาให้แล้ว แก้ได้)<input name="name" required maxLength={40} defaultValue={character?.name ?? nickname} /></label>
        <label>ลุค (ไม่ใส่ก็ได้ ระบบเปลี่ยนลุคให้ทุกครั้งที่กด)
          <textarea name="look" maxLength={300} rows={2} placeholder="เช่น long straight dark-brown hair, fair skin, sweet smile" defaultValue={character?.look ?? ""} />
        </label>
        <label className="girl-check"><input type="checkbox" name="credits" required /> ใช้เครดิต Flow 10 เครดิต (1 หน้า)</label>
        <button type="submit" className="girl-button" disabled={busy}>{busy ? "กำลังสร้างหน้าอยู่…" : "สร้างหน้า 1 แบบ"}</button>
        <p className="girl-note">เป็นหน้าคนใหม่ที่ AI สร้าง ไม่ลอกหน้าคนจริงหรือดาราคนไหน ตอนโพสต์ให้เปิด “ป้ายเนื้อหา AI” ใน TikTok ทุกครั้ง</p>
      </form>
      {character ? <form action={renameGirlAction} className="girl-form girl-rename">
        <label>เปลี่ยนชื่อ (ไม่เสียเครดิต)<input name="name" required maxLength={40} defaultValue={character.name} /></label>
        <button type="submit" className="girl-button secondary">บันทึกชื่อ</button>
        <p className="girl-note">ไอเดียชื่อ: {nickname}</p>
      </form> : null}
    </section>

    <section className="girl-card" aria-label="แนวคลิป">
      <h2>คลิปมาเป็นเรื่องต่อเนื่อง ตอนละ 3–5 คลิป ไม่ซ้ำ</h2>
      <p className="girl-note">วันละ 2–3 คลิป เรื่องเล่าต่อจากเมื่อวาน จบเรื่องแล้วขึ้นเรื่องใหม่คนละแนว สุ่มจากสถานที่ ชุด อาหาร และท่าเต้นเป็นหมื่นแบบ ตัวอย่างเรื่องที่สุ่มได้:</p>
      {state.arc ? <p className="girl-msg">เรื่องที่กำลังเล่าอยู่: <strong>{state.arc.name}</strong> (ทำไปแล้ว {state.arc.next}/{state.arc.episodes.length} ตอน)</p> : null}
      <ul className="girl-series">
        {samples.map(arc => <li key={arc.series}><strong>{arc.series}: {arc.name}</strong>
          <span>{arc.episodes.map((e, i) => `${i + 1}. ${e.label}`).join(" → ")}</span></li>)}
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
