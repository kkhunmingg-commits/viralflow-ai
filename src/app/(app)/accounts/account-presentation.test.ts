import { describe, expect, it } from "vitest";
import type { TikTokAccount } from "@/features/accounts/types";
import { presentAccount } from "./account-presentation";

const account = {
  display_name: "Fictional Shop",
  account_status: "unknown",
  authorization_status: "authorized",
  connection_status: "READY_FOR_DIRECT_POST",
  direct_post_status: "READY",
  upload_status: "READY",
  creator_info_sync_at: null,
  last_synced_at: null,
  is_mock: false,
} as TikTokAccount;

describe("account presentation", () => {
  it("does not claim publishing or Shop readiness without observed health and commerce data", () => {
    const state = presentAccount(account);
    expect(state.publishing.label).toBe("รอผลตรวจความพร้อม");
    expect(state.shopStatus.label).toBe("ยังไม่มีข้อมูล");
    expect(state.accountHealth.label).toBe("ยังไม่มีข้อมูล");
  });

  it("shows observed readiness and the latest real activity", () => {
    const state = presentAccount(account,
      { tiktok_account_id: "account", health_status: "READY", updated_at: "2026-09-22T00:00:00Z" },
      { tiktok_account_id: "account", attachment_available: true, synced_at: "2026-09-23T00:00:00Z" });
    expect(state.connection.tone).toBe("good");
    expect(state.publishing.label).toBe("Direct Post พร้อม");
    expect(state.shopStatus.label).toBe("พร้อมใช้งาน");
    expect(state.activity).toBe("2026-09-23T00:00:00Z");
  });

  it("does not mark blocked authorization ready even with stale provider fields", () => {
    const state = presentAccount({ ...account, authorization_status: "revoked" },
      { tiktok_account_id: "account", health_status: "READY", updated_at: "2026-09-22T00:00:00Z" });
    expect(state.connection.label).toBe("ยกเลิกการเชื่อมต่อแล้ว");
    expect(state.publishing.label).toBe("ยังไม่พร้อม");
  });

  it("shows expired authorization as requiring reconnection", () => {
    const state = presentAccount({ ...account, authorization_status: "expired", connection_status: "REAUTH_REQUIRED" });
    expect(state.connection.label).toBe("ต้องเชื่อมต่อใหม่");
  });
});
