import type { TikTokAccount } from "@/features/accounts/types";

export type AccountHealthSnapshot = {
  tiktok_account_id: string;
  health_status: "READY" | "LIMITED" | "PAUSED" | "BLOCKED" | "DISCONNECTED";
  updated_at: string;
};

export type ShopSnapshot = {
  tiktok_account_id: string;
  attachment_available: boolean;
  synced_at: string | null;
};

export type AccountBadge = { label: string; tone: "good" | "running" | "setup" | "warning" | "blocked" | "neutral" };

const healthLabels: Record<AccountHealthSnapshot["health_status"], AccountBadge> = {
  READY: { label: "พร้อม", tone: "good" },
  LIMITED: { label: "มีข้อจำกัด", tone: "warning" },
  PAUSED: { label: "พักการทำงาน", tone: "warning" },
  BLOCKED: { label: "ถูกระงับ", tone: "blocked" },
  DISCONNECTED: { label: "ไม่ได้เชื่อมต่อ", tone: "neutral" },
};

export function presentAccount(account: TikTokAccount, health?: AccountHealthSnapshot, shop?: ShopSnapshot) {
  const authorizationReady = account.authorization_status === "authorized";
  const connection: AccountBadge = account.is_mock
    ? { label: "บัญชีจำลอง", tone: "neutral" }
    : account.connection_status === "DISCONNECTED" || account.authorization_status === "revoked" || account.authorization_status === "disconnected"
      ? { label: "ยกเลิกการเชื่อมต่อแล้ว", tone: "neutral" }
      : account.connection_status === "REAUTH_REQUIRED" || ["expired", "error"].includes(account.authorization_status)
        ? { label: "ต้องเชื่อมต่อใหม่", tone: "setup" }
        : !authorizationReady
          ? { label: "รอการอนุญาต", tone: "setup" }
          : health?.health_status === "READY"
          ? { label: "พร้อม", tone: "good" }
          : health?.health_status === "BLOCKED"
            ? { label: "ถูกระงับ", tone: "blocked" }
            : health?.health_status === "LIMITED" || health?.health_status === "PAUSED"
              ? { label: "ต้องตรวจสอบ", tone: "warning" }
              : account.connection_status === "READY_FOR_UPLOAD" || account.connection_status === "READY_FOR_DIRECT_POST" || account.connection_status === "CONNECTED"
                ? { label: "เชื่อมแล้ว", tone: "running" }
                : { label: "ยังไม่มีผลตรวจ", tone: "neutral" };

  const publishing: AccountBadge = account.is_mock
    ? { label: "ข้อมูลทดสอบ", tone: "neutral" }
    : !authorizationReady || health?.health_status === "BLOCKED" || health?.health_status === "DISCONNECTED" || health?.health_status === "PAUSED"
      ? { label: "ยังไม่พร้อม", tone: "setup" }
    : health?.health_status === "READY" && account.direct_post_status === "READY"
      ? { label: "Direct Post พร้อม", tone: "good" }
      : health?.health_status === "READY" && account.upload_status === "READY"
        ? { label: "Upload พร้อม", tone: "good" }
        : account.direct_post_status === "READY" || account.upload_status === "READY"
          ? { label: "รอผลตรวจความพร้อม", tone: "neutral" }
        : account.direct_post_status || account.upload_status
          ? { label: "ยังไม่พร้อม", tone: "setup" }
          : { label: "ยังไม่มีข้อมูล", tone: "neutral" };

  const accountHealth: AccountBadge = health
    ? healthLabels[health.health_status]
    : account.account_status === "active"
      ? { label: "ปกติ", tone: "good" }
      : account.account_status === "restricted"
        ? { label: "มีข้อจำกัด", tone: "warning" }
        : account.account_status === "suspended"
          ? { label: "ถูกระงับ", tone: "blocked" }
          : account.account_status === "disconnected"
            ? { label: "ไม่ได้เชื่อมต่อ", tone: "neutral" }
            : { label: "ยังไม่มีข้อมูล", tone: "neutral" };

  const shopStatus: AccountBadge = !shop
    ? { label: "ยังไม่มีข้อมูล", tone: "neutral" }
    : shop.attachment_available
      ? { label: "พร้อมใช้งาน", tone: "good" }
      : { label: "ยังไม่พร้อม", tone: "setup" };

  const activity = [account.creator_info_sync_at, account.last_synced_at, health?.updated_at, shop?.synced_at]
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  return { connection, publishing, accountHealth, shopStatus, activity };
}
