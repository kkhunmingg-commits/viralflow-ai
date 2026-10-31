import type { PublishSettings } from "@/features/publishing/types";

/** TikTok's limit for a Direct Post caption (title), counted in characters. */
export const PRIVATE_POST_CAPTION_MAX = 2200;
/** Marks a clip whose private post has started, so a second click cannot post it twice. */
export const PRIVATE_POSTING = "TIKTOK_PRIVATE_POSTING";
/** TikTok may or may not have the video; the owner checks the app before trying again. */
export const PRIVATE_POST_UNCERTAIN = "TIKTOK_PRIVATE_POST_UNCERTAIN";

/**
 * Direct Post to the creator's own profile as "only me", with the caption. Until TikTok audits the app this is the only
 * privacy it allows; the owner switches the post to Everyone in the TikTok app. Same identity gate as inbox drafts.
 */
export function assertPrivatePostAccess(input: {
  ownerId: string; accountOwner: string; authorized: boolean; mock: boolean; scopes: string[]; official: boolean;
  productionApproved: boolean; sandboxEnabled: boolean; accountIdentity: string | null; sandboxIdentity: string | null;
}) {
  if (input.ownerId !== input.accountOwner || !input.authorized || input.mock || !input.official) throw new Error("account_unavailable");
  if (!input.scopes.includes("video.publish")) throw new Error("publish_reconnect_required");
  const sandboxAllowed = input.sandboxEnabled && !!input.accountIdentity && input.accountIdentity === input.sandboxIdentity;
  if (!input.productionApproved && !sandboxAllowed) throw new Error("publish_not_available");
}

/** Caption and hashtags as one TikTok caption; trimmed at the last whole word that fits. */
export function privatePostCaption(caption: string, hashtags: string[]) {
  const text = [caption.trim(), hashtags.join(" ").trim()].filter(Boolean).join("\n");
  const chars = [...text];
  if (chars.length <= PRIVATE_POST_CAPTION_MAX) return text;
  const cut = chars.slice(0, PRIVATE_POST_CAPTION_MAX).join("");
  const space = cut.search(/\s\S*$/);
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/** Library clips are AI-made, so TikTok's AI-generated label is always on; nothing commercial is declared. */
export function privatePostSettings(caption: string, creator: { privacyLevelOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean }): PublishSettings {
  if (!creator.privacyLevelOptions.includes("SELF_ONLY")) throw new Error("self_only_not_available");
  return { caption, privacyLevel: "SELF_ONLY", disableComment: creator.commentDisabled, disableDuet: creator.duetDisabled,
    disableStitch: creator.stitchDisabled, isAigc: true, commercialContent: {} };
}
