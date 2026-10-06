"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

interface ReviewSettings {
  caption: string; privacyOptions: string[]; requiresPrivacy: boolean;
  disableCommentRequired: boolean; disableDuetRequired: boolean; disableStitchRequired: boolean; aiDisclosureRequired: boolean;
}
const privacyLabels: Record<string, string> = { SELF_ONLY: "เฉพาะฉัน", PUBLIC_TO_EVERYONE: "ทุกคน", MUTUAL_FOLLOW_FRIENDS: "เพื่อน", FOLLOWER_OF_CREATOR: "ผู้ติดตาม" };
export function PostReviewControl({ reviewUrl }: { reviewUrl: string }) {
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const headingId = useId();
  const router = useRouter();
  async function openReview() {
    setPending(true); setMessage("");
    try {
      const response = await fetch(reviewUrl, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("review_unavailable");
      const value = await response.json();
      if (!Array.isArray(value.privacyOptions) || typeof value.caption !== "string") throw new Error("review_unavailable");
      setSettings(value);
    } catch { setMessage("ยังเปิดการตรวจคลิปไม่ได้ กรุณาตรวจความพร้อมของบัญชี"); }
    finally { setPending(false); }
  }
  async function confirmReview(formData: FormData) {
    if (!settings || formData.get("confirmed") !== "on") return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(reviewUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        caption: formData.get("caption"), privacyLevel: settings.requiresPrivacy ? formData.get("privacyLevel") : null,
        disableComment: settings.disableCommentRequired || formData.get("disableComment") === "on",
        disableDuet: settings.disableDuetRequired || formData.get("disableDuet") === "on",
        disableStitch: settings.disableStitchRequired || formData.get("disableStitch") === "on",
        isAigc: settings.aiDisclosureRequired || formData.get("isAigc") === "on", commercialContent: {
          brand_content_toggle: formData.get("paidPromotion") === "on", brand_organic_toggle: formData.get("ownPromotion") === "on",
        },
      }) });
      if (!response.ok) throw new Error("review_not_saved");
      setSettings(null); setMessage("ยืนยันคลิปแล้ว ระบบจะดำเนินการตามวิธีและเวลาที่ตั้งไว้"); router.refresh();
    } catch { setMessage("ยังยืนยันคลิปไม่ได้ กรุณาตรวจสิทธิ์ของบัญชีแล้วลองใหม่"); }
    finally { setPending(false); }
  }
  return <div className="customer-review-control">
    <button className="customer-text-button" type="button" onClick={openReview} disabled={pending}>{pending ? "กำลังตรวจ…" : "ตรวจและยืนยันคลิป"}</button>
    {settings ? <section className="customer-review-panel" aria-labelledby={headingId}>
      <h4 id={headingId}>ยืนยันคลิปนี้</h4>
      <form action={confirmReview} className="customer-review-form">
        <label>คำบรรยาย<textarea name="caption" defaultValue={settings.caption} maxLength={2200} required disabled={pending} /></label>
        {settings.requiresPrivacy ? <label>ผู้ที่เห็นโพสต์<select name="privacyLevel" defaultValue="" required disabled={pending}>
          <option value="" disabled>เลือกผู้ที่เห็นโพสต์</option>{settings.privacyOptions.map((value) => <option key={value} value={value}>{privacyLabels[value] ?? "ตัวเลือกอื่น"}</option>)}
        </select></label> : null}
        <label><input name="disableComment" type="checkbox" defaultChecked={settings.disableCommentRequired} disabled={pending || settings.disableCommentRequired} />ปิดความคิดเห็น</label>
        <label><input name="disableDuet" type="checkbox" defaultChecked={settings.disableDuetRequired} disabled={pending || settings.disableDuetRequired} />ปิดดูเอต</label>
        <label><input name="disableStitch" type="checkbox" defaultChecked={settings.disableStitchRequired} disabled={pending || settings.disableStitchRequired} />ปิดสติทช์</label>
        <label><input name="isAigc" type="checkbox" defaultChecked={settings.aiDisclosureRequired} disabled={pending || settings.aiDisclosureRequired} />แจ้งว่ามีเนื้อหาที่สร้างด้วย AI</label>
        <label><input name="paidPromotion" type="checkbox" disabled={pending} />โปรโมตสินค้าที่ได้รับค่าจ้างหรือสิ่งตอบแทน</label>
        <label><input name="ownPromotion" type="checkbox" disabled={pending} />โปรโมตธุรกิจของฉันเอง</label>
        <label><input name="confirmed" type="checkbox" required disabled={pending} />ฉันตรวจวิดีโอและยืนยันให้ดำเนินการคลิปนี้แล้ว</label>
        <div className="customer-review-buttons"><button className="customer-text-button" type="button" onClick={() => setSettings(null)} disabled={pending}>ยกเลิก</button>
          <button className="customer-primary-button" type="submit" disabled={pending}>ยืนยันคลิป</button></div>
      </form>
    </section> : null}
    {message ? <p role="status" className="customer-action-result">{message}</p> : null}
  </div>;
}
