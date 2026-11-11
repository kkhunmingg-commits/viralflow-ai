import { describe, expect, it } from "vitest";
import { assertPostableAccount, assertPrivatePostAccess, PRIVATE_POST_CAPTION_MAX, privatePostCaption, privatePostSettings, directPostSettings, UNAUDITED_PUBLIC_ACCOUNT } from "./private-post";

const access = { ownerId: "o", accountOwner: "o", authorized: true, mock: false, scopes: ["user.info.basic", "video.publish"], official: true,
  productionApproved: false, sandboxEnabled: true, accountIdentity: "open-1", sandboxIdentity: "open-1" };
const creator = { privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], commentDisabled: false, duetDisabled: true, stitchDisabled: false };

describe("assertPrivatePostAccess", () => {
  it("allows the sandbox target account with video.publish", () => expect(() => assertPrivatePostAccess(access)).not.toThrow());
  it("asks to reconnect without video.publish", () => expect(() => assertPrivatePostAccess({ ...access, scopes: ["video.upload"] })).toThrow("publish_reconnect_required"));
  it("refuses another owner, a mock or a non-sandbox account before approval", () => {
    expect(() => assertPrivatePostAccess({ ...access, accountOwner: "x" })).toThrow("account_unavailable");
    expect(() => assertPrivatePostAccess({ ...access, mock: true })).toThrow("account_unavailable");
    expect(() => assertPrivatePostAccess({ ...access, accountIdentity: "open-2" })).toThrow("publish_not_available");
  });
  it("allows any account once production is approved", () =>
    expect(() => assertPrivatePostAccess({ ...access, sandboxEnabled: false, sandboxIdentity: null, productionApproved: true })).not.toThrow());
});

describe("privatePostCaption", () => {
  it("joins the caption and hashtags", () => expect(privatePostCaption(" แมวบาริสต้า ", ["#แมว", "#fyp"])).toBe("แมวบาริสต้า\n#แมว #fyp"));
  it("stays within TikTok's limit, cutting at a word", () => {
    const text = privatePostCaption("คำ ".repeat(1500), ["#tag"]);
    expect([...text].length).toBeLessThanOrEqual(PRIVATE_POST_CAPTION_MAX);
    expect(text.endsWith("คำ")).toBe(true);
  });
});

describe("privatePostSettings", () => {
  it("posts as only me with the AI label and the creator's own interaction limits", () =>
    expect(privatePostSettings("hi", creator)).toEqual({ caption: "hi", privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true, disableStitch: false, isAigc: true, commercialContent: {} }));
  it("refuses when the creator cannot post privately", () =>
    expect(() => privatePostSettings("hi", { ...creator, privacyLevelOptions: ["PUBLIC_TO_EVERYONE"] })).toThrow("self_only_not_available"));
});

// 1 Nov: every private post failed at TikTok with unaudited_client_can_only_post_to_private_accounts because the
// account is public. This is caught before sending, and the button falls back to a draft.
describe("assertPostableAccount", () => {
  it("refuses a public account while the app is unaudited", () =>
    expect(() => assertPostableAccount(creator, false)).toThrow(UNAUDITED_PUBLIC_ACCOUNT));
  it("allows a private account (no PUBLIC_TO_EVERYONE option) while unaudited", () =>
    expect(() => assertPostableAccount({ privacyLevelOptions: ["FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"] }, false)).not.toThrow());
  it("allows a public account once audited", () => expect(() => assertPostableAccount(creator, true)).not.toThrow());
});

describe("directPostSettings", () => {
  const choice = { caption: "hi", privacyLevel: "SELF_ONLY", allowComment: true, allowDuet: true, allowStitch: false,
    commercial: { enabled: false, yourBrand: false, brandedContent: false } };
  it("uses exactly what the creator chose, keeping interactions the creator disabled off", () =>
    expect(directPostSettings(choice, creator)).toEqual({ caption: "hi", privacyLevel: "SELF_ONLY", disableComment: false, disableDuet: true,
      disableStitch: true, isAigc: true, commercialContent: {} }));
  it("refuses a privacy level creator_info does not offer", () =>
    expect(() => directPostSettings({ ...choice, privacyLevel: "FOLLOWER_OF_CREATOR" }, creator)).toThrow("privacy_level_invalid"));
  it("requires a commercial type once disclosure is on", () =>
    expect(() => directPostSettings({ ...choice, commercial: { enabled: true, yourBrand: false, brandedContent: false } }, creator)).toThrow("commercial_type_required"));
  it("never posts branded content as only me", () =>
    expect(() => directPostSettings({ ...choice, commercial: { enabled: true, yourBrand: false, brandedContent: true } }, creator)).toThrow("branded_content_not_private"));
  it("sends the disclosure toggles TikTok expects", () =>
    expect(directPostSettings({ ...choice, privacyLevel: "PUBLIC_TO_EVERYONE", commercial: { enabled: true, yourBrand: true, brandedContent: true } }, creator).commercialContent)
      .toEqual({ brand_organic_toggle: true, brand_content_toggle: true }));
});
