import { createHash } from "node:crypto";
import { OfficialTikTokPublishingProvider, buildChunkSource } from "@/features/publishing/provider";
import { createTikTokProvider, TikTokTokenService } from "@/features/tiktok/services";
import { assertSandboxPrivatePostAccount, sandboxPrivatePostAccountId } from "@/features/tiktok/sandbox-private-post";
import { serverEnv } from "@/lib/server-env";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const sampleName = "tiktok-sandbox-private-test.mp4";
const sampleSha256 = "b43aed2a41613eb2dbb9fdb6db3eaadfc692df161ec0fe75b450c670437be26f";

function errorCode(error: unknown) {
  const code = error instanceof Error ? error.message : "sandbox_private_post_failed";
  return /^[a-z0-9_]{3,80}$/.test(code) ? code : "sandbox_private_post_failed";
}

async function context(request: Request) {
  const accountId = sandboxPrivatePostAccountId();
  if (!accountId) throw new Error("sandbox_private_post_disabled");
  if (!serverEnv.appUrl) throw new Error("app_url_missing");
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(serverEnv.appUrl).origin) {
    throw new Error("sandbox_origin_mismatch");
  }
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("authentication_required");
  const ownerId = data.user.id;
  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin.from("tiktok_accounts")
    .select("id,owner_id,is_mock,authorization_status,granted_scopes,audit_status,video_publish_approval_status")
    .eq("owner_id", ownerId).eq("id", accountId).maybeSingle();
  if (accountError || !account) throw new Error("sandbox_account_not_found");
  assertSandboxPrivatePostAccount(account, ownerId, accountId);
  return { admin, ownerId, accountId };
}

function provider() {
  return new OfficialTikTokPublishingProvider(fetch, serverEnv.tiktokAllowedUploadHosts);
}

export async function POST(request: Request) {
  let publishId: string | null = null;
  try {
    const { admin, ownerId, accountId } = await context(request);
    const form = await request.formData();
    if (form.get("consent") !== "SELF_ONLY") throw new Error("explicit_private_consent_required");
    await enforceOwnerMutationRateLimit("publishing", ownerId);

    const token = await new TikTokTokenService(admin).getAccessToken(ownerId, accountId);
    const creator = await createTikTokProvider().queryCreatorInfo(token);
    if (!creator.privacyLevelOptions.includes("SELF_ONLY")) throw new Error("self_only_not_available");
    if (creator.maxVideoPostDurationSec < 6) throw new Error("video_duration_exceeds_creator_limit");
    if (!serverEnv.appUrl) throw new Error("app_url_missing");

    const videoResponse = await fetch(new URL(`/${sampleName}`, serverEnv.appUrl), { cache: "no-store" });
    if (!videoResponse.ok) throw new Error("sandbox_video_unavailable");
    const bytes = Buffer.from(await videoResponse.arrayBuffer());
    if (bytes.length < 10_000 || bytes.length > 3_000_000) throw new Error("sandbox_video_size_invalid");
    if (createHash("sha256").update(bytes).digest("hex") !== sampleSha256) throw new Error("sandbox_video_integrity_failed");
    const media = new Blob([bytes], { type: "video/mp4" });
    const source = buildChunkSource(media.size);
    const publisher = provider();
    const initialized = await publisher.directPost(token, {
      caption: "Private sandbox test",
      privacyLevel: "SELF_ONLY",
      disableComment: true,
      disableDuet: true,
      disableStitch: true,
      isAigc: false,
      commercialContent: {},
    }, source);
    publishId = initialized.publishId;
    if (!initialized.uploadUrl) throw new Error("tiktok_upload_url_missing");
    await publisher.uploadBinary(initialized.uploadUrl, media, source);
    return Response.json({ publish_id: publishId, privacy_level: "SELF_ONLY", upload: "COMPLETE", provider: "OfficialTikTokPublishingProvider" });
  } catch (error) {
    return Response.json({ publish_id: publishId, error_code: errorCode(error) }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const { admin, ownerId, accountId } = await context(request);
    const publishId = new URL(request.url).searchParams.get("publish_id");
    if (!publishId || !/^v_pub_[a-zA-Z0-9~._-]{1,58}$/.test(publishId)) throw new Error("publish_id_invalid");
    const token = await new TikTokTokenService(admin).getAccessToken(ownerId, accountId);
    const status = await provider().fetchPublishStatus(token, publishId);
    return Response.json({ publish_id: publishId, status: status.status, fail_reason: status.failReason });
  } catch (error) {
    return Response.json({ error_code: errorCode(error) }, { status: 400 });
  }
}
