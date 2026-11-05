import type { LibraryClip } from "@/features/flow-farm/service";
import { discardClipAction, markPostedAction, scheduleClipAction, unscheduleClipAction } from "./flow-actions";
import { TikTokPrivatePostButton } from "./tiktok-private-post-button";
import { ClipPhoneActions } from "./clip-phone-actions";
import { LeaveOnSubmit } from "./leave-on-submit";

const bangkokTime = (iso: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/**
 * Clips waiting to be posted, with share, private post, schedule and discard. The clip studio shows promo clips; the
 * drama menu shows cut episodes (studio "drama" sends every action back there).
 */
export function ClipLibrary({ library, now, back, studio, publishable, eyebrow, title, empty }: {
  library: LibraryClip[]; now: number; back?: string; studio?: "drama"; publishable: string[]; eyebrow: string; title: string; empty: string;
}) {
  const hidden = <>{back && <input type="hidden" name="back" value={back} />}{studio && <input type="hidden" name="studio" value={studio} />}</>;
  const kindLabel = (kind: LibraryClip["kind"]) => kind === "AFFILIATE" ? "ขายของ" : kind === "DRAMA" ? "ละครซีรีส์" : "ปั้นช่อง";
  return (
      <section className="manual-panel library-section" id="library" aria-labelledby="library-title">
        <div className="manual-section-head"><div><p className="manual-eyebrow">{eyebrow}</p><h2 id="library-title">{title} ({library.length})</h2></div></div>
        {library.length === 0 ? <div className="manual-empty"><h3>ยังไม่มีคลิปรอโพสต์</h3><p>{empty}</p></div>
          : <><p className="library-phone-tip">โพสต์จากมือถือ: เปิดหน้านี้ในมือถือ กด <b>📲 แชร์/บันทึกคลิป</b> ระบบคัดลอกคำบรรยาย + แฮชแท็กให้ แล้วเลือก TikTok (หรือ “บันทึกวิดีโอ”) จากนั้นวางคำบรรยายตอนโพสต์</p>
          <div className="library-grid">{library.map(clip => {
            const due = clip.status === "SCHEDULED" && clip.scheduled_at && Date.parse(clip.scheduled_at) <= now;
            const caption = [clip.caption, clip.hashtags.join(" ")].filter(Boolean).join("\n");
            return <article key={clip.id} className="library-clip">
              <video controls playsInline preload="metadata" src={`/api/library/${clip.id}/video#t=0.1`} aria-label={clip.title} />
              <div className="library-clip-body">
                <h3>{clip.title}</h3>
                <p className="library-meta">{kindLabel(clip.kind)}{clip.duration_seconds ? ` · ${Number(clip.duration_seconds).toFixed(0)} วิ` : ""} · สร้างด้วย Google Flow</p>
                {clip.status === "SCHEDULED" && clip.scheduled_at && <p className={due ? "library-due" : "library-scheduled"}>{due ? "ถึงเวลาโพสต์แล้ว · " : "ตั้งเวลาไว้ · "}{bangkokTime(clip.scheduled_at)}</p>}
                <textarea className="library-caption" readOnly rows={3} defaultValue={caption} aria-label="คำบรรยายสำหรับคัดลอก" />
                <ClipPhoneActions clipId={clip.id} caption={caption} />
                <div className="library-actions">
                  {publishable.includes(clip.tiktok_account_id) && clip.kind !== "AFFILIATE" && <TikTokPrivatePostButton clipId={clip.id} caption={caption} />}
                  <form action={markPostedAction} className="library-inline"><input type="hidden" name="id" value={clip.id} />{hidden}
                    <input name="url" type="url" placeholder="ลิงก์โพสต์ TikTok (ไม่บังคับ)" aria-label="ลิงก์โพสต์ TikTok" />
                    <button className="manual-secondary" type="submit">โพสต์แล้ว · ลบไฟล์</button><LeaveOnSubmit /></form>
                  <details className="library-more"><summary>ดาวน์โหลด · ตั้งเวลา · ทิ้งคลิป</summary>
                    <a className="manual-secondary" href={`/api/library/${clip.id}/video?download=1`}>ดาวน์โหลด MP4</a>
                    <form action={scheduleClipAction} className="library-inline"><input type="hidden" name="id" value={clip.id} />{hidden}
                      <input name="at" type="datetime-local" required aria-label="เวลาโพสต์ (เวลาไทย)" />
                      <button className="manual-secondary" type="submit">ตั้งเวลา</button></form>
                    <div className="library-inline">
                      {clip.status === "SCHEDULED" && <form action={unscheduleClipAction}><input type="hidden" name="id" value={clip.id} />{hidden}<button className="library-link" type="submit">ยกเลิกเวลา</button></form>}
                      <form action={discardClipAction}><input type="hidden" name="id" value={clip.id} />{hidden}<button className="library-link danger" type="submit">ทิ้งคลิปนี้</button><LeaveOnSubmit /></form>
                    </div>
                  </details>
                </div>
              </div>
            </article>;
          })}</div></>}
        <p className="manual-muted">โพสต์ใน TikTok แล้วเปิดป้าย “เนื้อหาที่สร้างด้วย AI” ทุกครั้ง กด “📲 แชร์/บันทึกคลิป + คัดลอกคำบรรยาย” แล้วเลือก TikTok วางคำบรรยายแล้วกดโพสต์ แชร์สำเร็จระบบลบคลิปออกจากคลังให้เอง หรือกด “โพสต์แบบส่วนตัว (มีคำบรรยาย)” คลิปจะขึ้นโปรไฟล์เป็น “เฉพาะฉัน” พร้อมคำบรรยาย แฮชแท็ก และป้าย AI แล้วเปลี่ยนเป็น “ทุกคน” ในแอป (คลิปขายของใช้ปุ่มแชร์) ถ้าโพสต์ด้วยวิธีอื่นให้กลับมากด “โพสต์แล้ว” ระบบลบไฟล์ออกจากคลังทันที การตั้งเวลาตอนนี้เป็นการเตือนในคลัง เมื่อ TikTok อนุมัติ API โพสต์อัตโนมัติ คลิปที่ตั้งเวลาไว้จะโพสต์เองแล้วลบไฟล์</p>
      </section>
  
  );
}
