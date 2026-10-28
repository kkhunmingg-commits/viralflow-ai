import { CADENCE_POLICY } from "@/features/multi-account/cadence-policy";

/** Followers an account needs before auto mode switches from warming up to selling. */
export const SELLING_FOLLOWER_THRESHOLD = 1000;

export type AccountPhase = "WARMUP" | "WAITING_SHOP" | "SELLING";

export interface AccountPhaseView {
  phase: AccountPhase;
  label: string;
  /** What auto mode does for this account right now, in one sentence. */
  plan: string;
  clipsPerDay: string;
  followers: number;
  followersToGo: number;
  /** 0–100 progress toward the selling threshold. */
  progress: number;
}

/**
 * Plain-language view of where an account is in auto mode: warming up below 1,000 followers,
 * waiting for verified TikTok Shop permission, or selling. Selling follows the effective mode,
 * so follower count alone never claims Shop access the account does not have.
 */
export function accountPhase(account: { follower_count: number | null | undefined; effective_mode: string | null | undefined }): AccountPhaseView {
  const followers = Math.max(0, Math.floor(Number(account.follower_count) || 0));
  const followersToGo = Math.max(0, SELLING_FOLLOWER_THRESHOLD - followers);
  const progress = Math.min(100, Math.round((followers / SELLING_FOLLOWER_THRESHOLD) * 100));
  const growth = `${CADENCE_POLICY.growth.min}–${CADENCE_POLICY.growth.max} คลิป/วัน`;
  if (account.effective_mode === "AFFILIATE") return {
    phase: "SELLING", label: "ช่วงขายสินค้า", clipsPerDay: `สูงสุด ${CADENCE_POLICY.platformTypicalCreatorCap} คลิป/วัน`,
    plan: "ทำคลิปขายสินค้าขายดีจาก TikTok Shop และค่อย ๆ เพิ่มจำนวนคลิปเมื่อบัญชีปกติ",
    followers, followersToGo, progress,
  };
  if (followersToGo === 0) return {
    phase: "WAITING_SHOP", label: "รอสิทธิ์ TikTok Shop", clipsPerDay: growth,
    plan: "ผู้ติดตามครบแล้ว ระบบยังทำคลิปปั้นช่องต่อจนกว่าบัญชีจะมีสิทธิ์ขายสินค้าและตะกร้า",
    followers, followersToGo, progress,
  };
  return {
    phase: "WARMUP", label: "ช่วงอุ่นเครื่อง", clipsPerDay: growth,
    plan: `ทำคลิปให้คนกดติดตาม อีก ${followersToGo.toLocaleString("th-TH")} คนจะเริ่มขายสินค้า`,
    followers, followersToGo, progress,
  };
}
