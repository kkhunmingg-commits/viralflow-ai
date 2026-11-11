import { z } from "zod";
import { NextResponse } from "next/server";
import { buildChunkSource, OfficialTikTokPublishingProvider } from "@/features/publishing/provider";
import { createTikTokProvider, TikTokTokenService } from "@/features/tiktok/services";
import { sandboxPrivatePostAccountId } from "@/features/tiktok/sandbox-private-post";
import { assertPostableAccount, assertPrivatePostAccess, PRIVATE_POST_UNCERTAIN, UNAUDITED_PUBLIC_ACCOUNT, PRIVATE_POSTING, privatePostCaption, directPostSettings, PRIVATE_POST_CAPTION_MAX } from "@/features/tiktok/private-post";
import { assertInboxMedia, LIBRARY_INBOX_MAX_BYTES } from "@/features/tiktok/inbox-flow";
import { claimPrivatePost, clipVideo, closeClip, notePrivatePost } from "@/features/flow-farm/service";
import { serverEnv } from "@/lib/server-env";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
// Only reasons the owner can act on are passed through; everything else stays generic.
const reasons = new Set(["publish_reconnect_required", "publish_not_available", "account_unavailable", "CLIP_NOT_IN_LIBRARY", "CLIP_BUSY_OR_GONE",
  UNAUDITED_PUBLIC_ACCOUNT, "invalid_mp4", "self_only_not_available", "video_too_long", "affiliate_use_draft", "spam_risk_too_many_posts", "spam_risk_user_banned_from_posting",
  "privacy_level_invalid", "commercial_type_required", "branded_content_not_private", "consent_required", "choice_invalid"]);
const uuid = z.uuid();
/** The creator's explicit choices from the post screen (TikTok Direct Post UX rules: no defaults, consent required). */
const choiceSchema = z.object({
  caption: z.string().max(PRIVATE_POST_CAPTION_MAX),
  privacyLevel: z.string().min(1).max(40),
  allowComment: z.boolean(), allowDuet: z.boolean(), allowStitch: z.boolean(),
  commercial: z.object({ enabled: z.boolean(), yourBrand: z.boolean(), brandedContent: z.boolean() }),
  consent: z.literal(true),
});

async function readChoice(request: Request) {
  const body = await request.json().catch(() => null);
  if (body && typeof body === "object" && (body as { consent?: unknown }).consent !== true) throw new Error("consent_required");
  const parsed = choiceSchema.safeParse(body);
  if (!parsed.success) throw new Error("choice_invalid");
  return parsed.data;
}

async function owner() {
  const { data, error } = await (await createClient()).auth.getUser();
  return error || !data.user ? null : data.user.id;
}

/** Token for an account allowed to Direct Post: the Sandbox target account until TikTok approves the app. */
async function publishToken(ownerId: string, accountId: string) {
  const admin = createAdminClient();
  const { data: account, error } = await admin.from("tiktok_accounts").select("owner_id,open_id,is_mock,authorization_status,granted_scopes")
    .eq("owner_id", ownerId).eq("id", accountId).single();
  if (error || !account) throw new Error("account_unavailable");
  const target = sandboxPrivatePostAccountId();
  const { data: sandbox } = target ? await admin.from("tiktok_accounts").select("open_id").eq("id", target).single() : { data: null };
  assertPrivatePostAccess({
    ownerId, accountOwner: account.owner_id, authorized: account.authorization_status === "authorized", mock: account.is_mock,
    scopes: account.granted_scopes ?? [], official: serverEnv.tiktokProvider === "official",
    productionApproved: serverEnv.tiktokPublishingRealMode && serverEnv.tiktokVideoPublishApproved && !serverEnv.tiktokClientKey?.startsWith("sb"),
    sandboxEnabled: !!target, accountIdentity: account.open_id, sandboxIdentity: sandbox?.open_id ?? null,
  });
  return new TikTokTokenService(admin).getAccessToken(ownerId, accountId);
}

const publisher = () => new OfficialTikTokPublishingProvider(fetch, serverEnv.tiktokAllowedUploadHosts);

/**
 * Posts one library clip to the owner's TikTok profile as "only me", caption and hashtags included, with the AI label on.
 * The owner switches it to Everyone in the TikTok app. Once TikTok has the whole file the clip leaves the library.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let claimed: string | null = null, sent = false;
  const admin = createAdminClient();
  const ownerId = await owner();
  try {
    if (!serverEnv.appUrl || request.headers.get("origin") !== new URL(serverEnv.appUrl).origin) throw new Error("origin_required");
    if (!ownerId) return NextResponse.json({ error: "login_required" }, { status: 401, headers });
    await enforceOwnerMutationRateLimit("tiktok-private-post", ownerId);
    const id = uuid.parse((await context.params).id);
    const choice = await readChoice(request);
    const clip = await claimPrivatePost(admin, ownerId, id, PRIVATE_POSTING);
    claimed = id;
    // Paid promotion must be disclosed as branded content, which TikTok never allows as "only me"; those go as drafts.
    if (clip.kind === "AFFILIATE") throw new Error("affiliate_use_draft");
    const token = await publishToken(ownerId, clip.tiktok_account_id);
    const video = await clipVideo(admin, ownerId, id);
    assertInboxMedia(video.bytes, "video/mp4", LIBRARY_INBOX_MAX_BYTES);
    const creator = await createTikTokProvider().queryCreatorInfo(token);
    assertPostableAccount(creator, serverEnv.tiktokDirectPostAuditStatus === "AUDITED");
    const duration = await clipDuration(admin, ownerId, id);
    if (duration !== null && duration > creator.maxVideoPostDurationSec) throw new Error("video_too_long");
    const settings = directPostSettings({ ...choice, caption: choice.caption.trim() || privatePostCaption(clip.caption, clip.hashtags ?? []) }, creator);
    const media = new Blob([video.bytes], { type: "video/mp4" });
    const source = buildChunkSource(media.size);
    const provider = publisher();
    const initialized = await provider.directPost(token, settings, source);
    sent = true;
    if (!initialized.uploadUrl) throw new Error("upload_url_missing");
    await provider.uploadBinary(initialized.uploadUrl, media, source);
    // TikTok has the whole file: the library copy is removed, exactly as when the owner presses "posted".
    await closeClip(admin, ownerId, id, { posted: true, url: null });
    await notePrivatePost(admin, ownerId, id, null).catch(() => undefined);
    return NextResponse.json({ publishId: initialized.publishId, account: clip.tiktok_account_id }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    // Before TikTok answered the clip can simply be tried again; after that it may already be on the profile.
    if (claimed && ownerId) await notePrivatePost(admin, ownerId, claimed, sent ? PRIVATE_POST_UNCERTAIN : null).catch(() => undefined);
    console.warn(JSON.stringify({ event: "library_private_post", result: "ERROR", error_code: /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : "other", sent }));
    return NextResponse.json({ error: reasons.has(code) ? code : sent ? "post_uncertain" : "post_unavailable" }, { status: 400, headers });
  }
}

async function clipDuration(admin: ReturnType<typeof createAdminClient>, ownerId: string, id: string) {
  const { data } = await admin.from("flow_clips").select("duration_seconds").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  return data?.duration_seconds == null ? null : Number(data.duration_seconds);
}

/**
 * GET ?creator=1: the destination account's creator_info (nickname, avatar, privacy options, interaction limits, max
 * duration) for the post screen, fetched fresh each time it opens as TikTok requires.
 * GET ?publish_id=…&account=…: where TikTok is with a post: processing, done, or failed.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
    const ownerId = await owner();
    if (!ownerId) return NextResponse.json({ error: "login_required" }, { status: 401, headers });
    await enforceOwnerMutationRateLimit("tiktok-private-post-status", ownerId);
    const params = new URL(request.url).searchParams;
    if (params.get("creator")) return await creatorInfo(ownerId, uuid.parse((await context.params).id));
    const publishId = params.get("publish_id") ?? "";
    if (!/^v_pub_[a-zA-Z0-9~._-]{1,58}$/.test(publishId)) throw new Error("publish_id_invalid");
    const status = await publisher().fetchPublishStatus(await publishToken(ownerId, uuid.parse(params.get("account"))), publishId);
    return NextResponse.json({ status: status.status, failReason: status.failReason }, { headers });
  } catch { return NextResponse.json({ error: "status_unavailable" }, { status: 400, headers }); }
}

async function creatorInfo(ownerId: string, id: string) {
  const admin = createAdminClient();
  const { data: clip } = await admin.from("flow_clips").select("tiktok_account_id,duration_seconds").eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (!clip?.tiktok_account_id) return NextResponse.json({ error: "CLIP_NOT_IN_LIBRARY" }, { status: 400, headers });
  try {
    const creator = await createTikTokProvider().queryCreatorInfo(await publishToken(ownerId, clip.tiktok_account_id));
    return NextResponse.json({
      nickname: creator.nickname, username: creator.username, avatarUrl: creator.avatarUrl,
      privacyLevelOptions: creator.privacyLevelOptions, commentDisabled: creator.commentDisabled, duetDisabled: creator.duetDisabled,
      stitchDisabled: creator.stitchDisabled, maxVideoPostDurationSec: creator.maxVideoPostDurationSec,
      durationSec: clip.duration_seconds == null ? null : Number(clip.duration_seconds),
      audited: serverEnv.tiktokDirectPostAuditStatus === "AUDITED",
    }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: reasons.has(code) ? code : "creator_info_unavailable" }, { status: 400, headers });
  }
}
