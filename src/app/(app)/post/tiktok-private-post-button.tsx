"use client";
import { useEffect, useState } from "react";

const errors: Record<string, string> = {
  publish_reconnect_required: "บัญชีนี้ยังไม่ได้อนุญาตให้โพสต์ กด “อนุญาตส่งเข้า TikTok” อีกครั้ง",
  publish_not_available: "แอป TikTok ของเรายังไม่ได้รับอนุมัติให้โพสต์เข้าบัญชีนี้ (ตอนนี้ใช้ได้เฉพาะบัญชีทดสอบ Sandbox)",
  account_unavailable: "บัญชี TikTok นี้ยังไม่ได้เชื่อมแบบจริง หรือหมดอายุ เชื่อมบัญชีใหม่ก่อน",
  CLIP_NOT_IN_LIBRARY: "คลิปนี้ไม่อยู่ในคลังแล้ว", CLIP_BUSY_OR_GONE: "คลิปนี้กำลังโพสต์อยู่ หรือไม่อยู่ในคลังแล้ว รีโหลดหน้า",
  invalid_mp4: "ไฟล์คลิปนี้ไม่ใช่ MP4 ที่ TikTok รับได้", self_only_not_available: "บัญชีนี้โพสต์แบบ “เฉพาะฉัน” ไม่ได้",
  video_too_long: "คลิปยาวเกินที่บัญชีนี้โพสต์ได้", affiliate_use_draft: "คลิปขายของต้องส่งแบบร่าง เพื่อเปิดป้ายเนื้อหาแบรนด์ในแอป",
  spam_risk_too_many_posts: "วันนี้โพสต์ผ่านแอปครบโควตาของ TikTok แล้ว ลองพรุ่งนี้",
  spam_risk_user_banned_from_posting: "TikTok ระงับการโพสต์ของบัญชีนี้ชั่วคราว",
  unaudited_client_can_only_post_to_private_accounts: "บัญชี TikTok นี้เป็นสาธารณะ ซึ่ง TikTok ยังไม่ให้แอปเราโพสต์ตรงได้ (ต้องเป็นบัญชีส่วนตัวจนกว่าแอปผ่านการตรวจ)",
  post_uncertain: "ไม่แน่ใจว่า TikTok ได้คลิปแล้วหรือยัง เปิดโปรไฟล์ในแอปดูก่อน ถ้าไม่มีค่อยกดใหม่",
  privacy_level_invalid: "Choose who can view this video · เลือกการรับชมก่อน",
  commercial_type_required: "You need to indicate if your content promotes yourself, a third party, or both.",
  branded_content_not_private: "Branded content visibility cannot be set to private.",
  creator_info_unavailable: "Couldn't load your TikTok account info. Try again. · โหลดข้อมูลบัญชี TikTok ไม่ได้ ลองอีกครั้ง",
};
const labels: Record<string, string> = {
  PROCESSING_UPLOAD: "TikTok is receiving the video… · TikTok กำลังรับไฟล์…", PROCESSING_DOWNLOAD: "TikTok is receiving the video… · TikTok กำลังรับไฟล์…",
  SEND_TO_USER_INBOX: "TikTok is preparing the post… · TikTok กำลังเตรียมโพสต์…",
  PUBLISH_COMPLETE: "✓ Posted to TikTok. Open your TikTok profile to see it. · โพสต์ลง TikTok แล้ว เปิดโปรไฟล์ในแอปเพื่อดูคลิป",
  FAILED: "TikTok couldn't post this video. · TikTok โพสต์คลิปนี้ไม่สำเร็จ",
};
const privacyNames: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone · ทุกคน", MUTUAL_FOLLOW_FRIENDS: "Friends · เพื่อน", FOLLOWER_OF_CREATOR: "Followers · ผู้ติดตาม", SELF_ONLY: "Only me · เฉพาะฉัน",
};
const MUSIC = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED = "https://www.tiktok.com/legal/page/global/bc-policy/en";

type Creator = {
  nickname: string; username: string; avatarUrl: string | null; privacyLevelOptions: string[]; commentDisabled: boolean;
  duetDisabled: boolean; stitchDisabled: boolean; maxVideoPostDurationSec: number; durationSec: number | null; audited: boolean;
};

/**
 * "Post to TikTok": opens TikTok's required Direct Post screen. It loads creator_info fresh, shows the destination
 * account, lets the creator edit the caption, pick who can view (no default), allow comments/duet/stitch (off by
 * default, greyed out when the account disables them), disclose commercial content, and shows the Music Usage
 * Confirmation before the creator presses Post.
 */
export function TikTokPrivatePostButton({ clipId, caption }: { clipId: string; caption: string }) {
  const [open, setOpen] = useState(false);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(caption);
  const [privacy, setPrivacy] = useState("");
  const [allow, setAllow] = useState({ comment: false, duet: false, stitch: false });
  const [disclose, setDisclose] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [post, setPost] = useState<{ publishId: string; account: string } | null>(null);

  useEffect(() => {
    if (!post) return;
    let timer: ReturnType<typeof setTimeout>, attempts = 0;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/library/${clipId}/tiktok-private-post?account=${encodeURIComponent(post.account)}&publish_id=${encodeURIComponent(post.publishId)}`,
          { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (response.ok) {
          setMessage(labels[body.status] ?? labels.SEND_TO_USER_INBOX);
          if (body.status === "PUBLISH_COMPLETE" || body.status === "FAILED") return;
        }
      } catch { /* Try again below. */ }
      if (!controller.signal.aborted && ++attempts < 10) timer = setTimeout(poll, Math.min(3000 * 2 ** attempts, 30000));
    };
    timer = setTimeout(poll, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [post, clipId]);

  async function openScreen() {
    setOpen(true); setLoading(true); setMessage(""); setCreator(null);
    try {
      const response = await fetch(`/api/library/${clipId}/tiktok-private-post?creator=1`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(errors[body.error] ?? errors.creator_info_unavailable); return; }
      setCreator(body);
    } catch { setMessage(errors.creator_info_unavailable); }
    finally { setLoading(false); }
  }

  const tooLong = !!creator && creator.durationSec !== null && creator.durationSec > creator.maxVideoPostDurationSec;
  const needsType = disclose && !yourBrand && !branded;
  const brandedPrivate = disclose && branded && privacy === "SELF_ONLY";
  const canPost = !!creator && !!privacy && !tooLong && !needsType && !brandedPrivate && !busy && !post;
  const privacyLocked = (option: string) => (!creator?.audited && option !== "SELF_ONLY") || (disclose && branded && option === "SELF_ONLY");

  async function send() {
    if (!canPost) return;
    setBusy(true); setMessage("");
    const copied = title ? await navigator.clipboard.writeText(title).then(() => true, () => false) : false;
    try {
      const response = await fetch(`/api/library/${clipId}/tiktok-private-post`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: title, privacyLevel: privacy, allowComment: allow.comment, allowDuet: allow.duet, allowStitch: allow.stitch,
          commercial: { enabled: disclose, yourBrand: disclose && yourBrand, brandedContent: disclose && branded }, consent: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && body.error === "unaudited_client_can_only_post_to_private_accounts") { await sendDraft(copied); return; }
      if (!response.ok) { setMessage(errors[body.error] ?? "Post failed, try again · โพสต์ไม่สำเร็จ ลองอีกครั้ง"); return; }
      setPost({ publishId: body.publishId, account: body.account });
      setMessage("Sent. It may take a few minutes for the video to process and appear on your profile. · ส่งแล้ว อาจใช้เวลาสักครู่กว่าคลิปจะขึ้นโปรไฟล์");
    } catch { setMessage("Post failed, try again · โพสต์ไม่สำเร็จ ลองอีกครั้ง"); }
    finally { setBusy(false); }
  }

  /** TikTok refuses direct posts to a public account until the app is audited, so the same click delivers a draft instead. */
  async function sendDraft(copied: boolean) {
    const response = await fetch(`/api/library/${clipId}/tiktok-draft`, { method: "POST" }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    const reason = errors.unaudited_client_can_only_post_to_private_accounts;
    if (!response?.ok) { setMessage(`${reason} และส่งเป็นแบบร่างแทนไม่สำเร็จ (${body.error ?? "ลองอีกครั้ง"})`); return; }
    setMessage(`${reason} จึงส่งเข้าแบบร่างใน TikTok แทนแล้ว เปิดแอป TikTok ดูการแจ้งเตือน (Inbox)${copied ? " วางคำบรรยายที่คัดลอกไว้แล้ว" : ""} แล้วกดโพสต์`);
  }

  if (!open) return <div className="library-draft">
    <button className="manual-primary" type="button" onClick={openScreen}>Post to TikTok · โพสต์ลง TikTok</button>
    <small>Review the account, caption, privacy and settings before posting · ตรวจบัญชี คำบรรยาย และการรับชมก่อนโพสต์</small>
  </div>;

  return <div className="tt-post" role="group" aria-label="Post to TikTok">
    <div className="tt-post-head"><b>Post to TikTok</b><button type="button" className="library-link" onClick={() => setOpen(false)} disabled={busy}>Cancel · ยกเลิก</button></div>
    {loading && <p className="tt-post-note">Loading your TikTok account… · กำลังโหลดบัญชี TikTok…</p>}
    {creator && <>
      <div className="tt-post-creator">
        {creator.avatarUrl ? <img src={creator.avatarUrl} alt="" width={40} height={40} /> : <span aria-hidden="true">♪</span>}
        <div><small>Posting to · โพสต์ไปที่บัญชี</small><b>{creator.nickname}</b><small>@{creator.username}</small></div>
      </div>

      <label className="tt-post-field">Caption · คำบรรยาย
        <textarea rows={4} maxLength={2200} value={title} onChange={event => setTitle(event.target.value)} disabled={!!post} />
      </label>

      <label className="tt-post-field">Who can view this video · ใครดูวิดีโอนี้ได้
        <select value={privacy} onChange={event => setPrivacy(event.target.value)} disabled={!!post} required>
          <option value="" disabled>Select · เลือก</option>
          {creator.privacyLevelOptions.map(option => <option key={option} value={option} disabled={privacyLocked(option)}>{privacyNames[option] ?? option}</option>)}
        </select>
        {!creator.audited && <small>While this app is under TikTok review, posts can only be “Only me”. · ระหว่างแอปรอ TikTok ตรวจ โพสต์ได้เฉพาะ “เฉพาะฉัน”</small>}
      </label>

      <fieldset className="tt-post-field" disabled={!!post}>
        <legend>Allow users to · อนุญาตให้ผู้ชม</legend>
        {([["comment", "Comment · คอมเมนต์", creator.commentDisabled], ["duet", "Duet", creator.duetDisabled], ["stitch", "Stitch", creator.stitchDisabled]] as const).map(([key, name, off]) =>
          <label key={key} className={off ? "tt-post-off" : ""}><input type="checkbox" checked={!off && allow[key]} disabled={off}
            onChange={event => setAllow(current => ({ ...current, [key]: event.target.checked }))} />{name}{off && <small> (turned off in your TikTok settings)</small>}</label>)}
      </fieldset>

      <fieldset className="tt-post-field" disabled={!!post}>
        <legend>Disclose video content · ระบุเนื้อหาเชิงพาณิชย์</legend>
        <label><input type="checkbox" checked={disclose} onChange={event => { setDisclose(event.target.checked); if (!event.target.checked) { setYourBrand(false); setBranded(false); } }} />
          This video promotes a brand, product or service · วิดีโอนี้โปรโมตแบรนด์ สินค้า หรือบริการ</label>
        {disclose && <>
          <label><input type="checkbox" checked={yourBrand} onChange={event => setYourBrand(event.target.checked)} />Your brand · แบรนด์ของคุณเอง</label>
          <label><input type="checkbox" checked={branded} onChange={event => { setBranded(event.target.checked); if (event.target.checked && privacy === "SELF_ONLY") setPrivacy(""); }} />Branded content · เนื้อหาที่ได้รับการสนับสนุน</label>
          {needsType && <small className="tt-post-warn">{errors.commercial_type_required}</small>}
          {branded ? <small>Your video will be labeled as “Paid partnership”. Branded content visibility cannot be set to private.</small>
            : yourBrand ? <small>Your video will be labeled as “Promotional content”.</small> : null}
        </>}
      </fieldset>

      <p className="tt-post-note">This AI-made video will carry TikTok’s “AI-generated” label. · คลิปนี้จะติดป้าย “สร้างด้วย AI” ของ TikTok</p>
      {tooLong && <p className="tt-post-warn">This video is longer than your account allows ({creator.maxVideoPostDurationSec}s). · คลิปยาวเกินที่บัญชีนี้โพสต์ได้</p>}

      <p className="tt-post-consent">By posting, you agree to TikTok’s {disclose && branded && <><a href={BRANDED} target="_blank" rel="noreferrer">Branded Content Policy</a> and </>}
        <a href={MUSIC} target="_blank" rel="noreferrer">Music Usage Confirmation</a>.</p>
      {!post && <button className="manual-primary" type="button" disabled={!canPost} onClick={send}>{busy ? "Posting… · กำลังโพสต์…" : "Post · โพสต์"}</button>}
    </>}
    {message && <small role="status" aria-live="polite" className="tt-post-status">{message}</small>}
  </div>;
}
