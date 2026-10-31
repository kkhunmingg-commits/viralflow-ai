import { z } from "zod";
import { NextResponse } from "next/server";
import { buildChunkSource, OfficialTikTokPublishingProvider } from "@/features/publishing/provider";
import { createTikTokProvider, TikTokTokenService } from "@/features/tiktok/services";
import { sandboxPrivatePostAccountId } from "@/features/tiktok/sandbox-private-post";
import { assertPrivatePostAccess, PRIVATE_POST_UNCERTAIN, PRIVATE_POSTING, privatePostCaption, privatePostSettings } from "@/features/tiktok/private-post";
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
  "invalid_mp4", "self_only_not_available", "video_too_long", "affiliate_use_draft", "spam_risk_too_many_posts", "spam_risk_user_banned_from_posting"]);
const uuid = z.uuid();

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
    const clip = await claimPrivatePost(admin, ownerId, id, PRIVATE_POSTING);
    claimed = id;
    // Paid promotion must be disclosed as branded content, which TikTok never allows as "only me"; those go as drafts.
    if (clip.kind === "AFFILIATE") throw new Error("affiliate_use_draft");
    const token = await publishToken(ownerId, clip.tiktok_account_id);
    const video = await clipVideo(admin, ownerId, id);
    assertInboxMedia(video.bytes, "video/mp4", LIBRARY_INBOX_MAX_BYTES);
    const creator = await createTikTokProvider().queryCreatorInfo(token);
    const duration = await clipDuration(admin, ownerId, id);
    if (duration !== null && duration > creator.maxVideoPostDurationSec) throw new Error("video_too_long");
    const settings = privatePostSettings(privatePostCaption(clip.caption, clip.hashtags ?? []), creator);
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

/** Where TikTok is with a private post: processing, done, or failed. */
export async function GET(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
    const ownerId = await owner();
    if (!ownerId) return NextResponse.json({ error: "login_required" }, { status: 401, headers });
    await enforceOwnerMutationRateLimit("tiktok-private-post-status", ownerId);
    const params = new URL(request.url).searchParams;
    const publishId = params.get("publish_id") ?? "";
    if (!/^v_pub_[a-zA-Z0-9~._-]{1,58}$/.test(publishId)) throw new Error("publish_id_invalid");
    const status = await publisher().fetchPublishStatus(await publishToken(ownerId, uuid.parse(params.get("account"))), publishId);
    return NextResponse.json({ status: status.status, failReason: status.failReason }, { headers });
  } catch { return NextResponse.json({ error: "status_unavailable" }, { status: 400, headers }); }
}
