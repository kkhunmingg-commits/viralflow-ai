import { describe, expect, it } from "vitest";
import { assertSandboxPrivatePostAccount, sandboxPrivatePostAccountId } from "./sandbox-private-post";

const id = "75f5519c-7f30-4e70-b89d-b2569bf589ce";
const owner = "ccdcb9b6-3675-4d80-a160-19892cb3fc34";
const env = {
  TIKTOK_SANDBOX_PRIVATE_TEST_ENABLED: "true",
  TIKTOK_SANDBOX_PRIVATE_TEST_ACCOUNT_ID: id,
  TIKTOK_CLIENT_KEY: "sb-example",
  TIKTOK_PROVIDER: "official",
  TIKTOK_PUBLISHING_REAL_MODE: "false",
  TIKTOK_VIDEO_PUBLISH_APPROVED: "false",
  TIKTOK_DIRECT_POST_AUDIT_STATUS: "UNAUDITED",
};
const account = {
  id, owner_id: owner, is_mock: false, authorization_status: "authorized",
  granted_scopes: ["user.info.basic", "video.publish"],
  audit_status: "UNAUDITED", video_publish_approval_status: "NOT_APPROVED",
};

describe("Sandbox private Direct Post guard", () => {
  it("requires an explicit sandbox key, exact account and disabled production publishing", () => {
    expect(sandboxPrivatePostAccountId(env)).toBe(id);
    for (const patch of [
      { TIKTOK_SANDBOX_PRIVATE_TEST_ENABLED: "false" },
      { TIKTOK_CLIENT_KEY: "production-key" },
      { TIKTOK_PROVIDER: "mock" },
      { TIKTOK_PUBLISHING_REAL_MODE: "true" },
      { TIKTOK_VIDEO_PUBLISH_APPROVED: "true" },
      { TIKTOK_DIRECT_POST_AUDIT_STATUS: "AUDITED" },
      { TIKTOK_SANDBOX_PRIVATE_TEST_ACCOUNT_ID: "another-account" },
    ]) expect(sandboxPrivatePostAccountId({ ...env, ...patch })).toBeNull();
  });

  it("allows only the real, authorized, unaudited owner with video.publish", () => {
    expect(() => assertSandboxPrivatePostAccount(account, owner, id)).not.toThrow();
    expect(() => assertSandboxPrivatePostAccount(account, "other-owner", id)).toThrow();
    expect(() => assertSandboxPrivatePostAccount({ ...account, is_mock: true }, owner, id)).toThrow();
    expect(() => assertSandboxPrivatePostAccount({ ...account, granted_scopes: ["user.info.basic"] }, owner, id)).toThrow();
    expect(() => assertSandboxPrivatePostAccount({ ...account, audit_status: "AUDITED" }, owner, id)).toThrow();
    expect(() => assertSandboxPrivatePostAccount({ ...account, video_publish_approval_status: "APPROVED" }, owner, id)).toThrow();
  });
});
