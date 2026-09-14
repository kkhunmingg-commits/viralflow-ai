import type { TikTokAccount } from "@/features/accounts/types";

export function AccountFields({ account }: { account?: TikTokAccount }) {
  const value = account ?? {
    display_name: "",
    username: "",
    follower_count: 0,
    following_count: 0,
    mode: "AUTO",
    ecommerce_permission: null,
    cart_enabled: null,
    shop_creator_eligible: null,
    daily_post_target: 3,
    daily_post_hard_limit: 15,
    account_status: "active",
    authorization_status: "disconnected",
    preferred_categories: [],
    account_notes: "",
  };

  const triStateValue = (input: boolean | null) =>
    input === null ? "unknown" : String(input);

  return (
    <div className="account-form-grid">
      <label>ชื่อแสดง<input name="display_name" required maxLength={80} defaultValue={value.display_name} /></label>
      <label>Username<input name="username" required pattern="[A-Za-z0-9._]{2,32}" defaultValue={value.username} /></label>
      <label>ผู้ติดตาม<input name="follower_count" type="number" min="0" required defaultValue={value.follower_count} /></label>
      <label>กำลังติดตาม<input name="following_count" type="number" min="0" required defaultValue={value.following_count} /></label>
      <label>โหมด<select name="mode" defaultValue={value.mode}><option>AUTO</option><option>GROWTH</option><option>AFFILIATE</option></select></label>
      <label>E-commerce<select name="ecommerce_permission" defaultValue={triStateValue(value.ecommerce_permission)}><option value="unknown">ยังไม่ทราบ</option><option value="true">พร้อม</option><option value="false">ไม่พร้อม</option></select></label>
      <label>Product cart<select name="cart_enabled" defaultValue={triStateValue(value.cart_enabled)}><option value="unknown">ยังไม่ทราบ</option><option value="true">พร้อม</option><option value="false">ไม่พร้อม</option></select></label>
      <label>Shop creator<select name="shop_creator_eligible" defaultValue={triStateValue(value.shop_creator_eligible)}><option value="unknown">ยังไม่ทราบ</option><option value="true">ผ่าน</option><option value="false">ไม่ผ่าน</option></select></label>
      <label>เป้าหมายโพสต์/วัน<input name="daily_post_target" type="number" min="0" max="20" required defaultValue={value.daily_post_target} /></label>
      <label>เพดานโพสต์/วัน<input name="daily_post_hard_limit" type="number" min="0" max="20" required defaultValue={value.daily_post_hard_limit} /></label>
      <label>สถานะบัญชี<select name="account_status" defaultValue={value.account_status}><option value="active">ปกติ</option><option value="unknown">ยังไม่ทราบ</option><option value="restricted">ถูกจำกัด</option><option value="suspended">ถูกระงับ</option><option value="disconnected">ตัดการเชื่อมต่อ</option></select></label>
      <label>การอนุญาต<select name="authorization_status" defaultValue={value.authorization_status}><option value="disconnected">ไม่ได้เชื่อมต่อ</option><option value="pending">กำลังรอ</option><option value="authorized">อนุญาตแล้ว</option><option value="expired">หมดอายุ</option><option value="revoked">ถูกเพิกถอน</option><option value="error">ผิดพลาด</option></select></label>
      <label className="wide">หมวดหมู่ที่ถนัด (คั่นด้วย comma)<input name="preferred_categories" defaultValue={value.preferred_categories.join(", ")} placeholder="beauty, home, fashion" /></label>
      <label className="wide">บันทึก<textarea name="account_notes" maxLength={1000} defaultValue={value.account_notes ?? ""} /></label>
    </div>
  );
}
