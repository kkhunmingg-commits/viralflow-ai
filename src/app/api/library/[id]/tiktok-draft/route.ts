import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { clipVideo } from "@/features/flow-farm/service";
import { inboxContext, releaseRetryableInboxReceipt } from "@/features/tiktok/inbox-service";
import { assertInboxMedia, inboxPublicReceipt, LIBRARY_INBOX_MAX_BYTES, sendInboxVideo } from "@/features/tiktok/inbox-flow";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = { "Cache-Control": "no-store" };
// Only reasons the owner can act on are passed through; everything else stays generic.
const reasons = new Set(["inbox_reconnect_required", "inbox_not_available", "account_unavailable", "CLIP_NOT_IN_LIBRARY", "invalid_mp4"]);

/** Sends one library clip into the TikTok account's inbox as a draft. The owner opens TikTok and posts it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!serverEnv.appUrl || request.headers.get("origin") !== new URL(serverEnv.appUrl).origin) throw new Error("origin_required");
    const { data, error } = await (await createClient()).auth.getUser();
    if (error || !data.user) return NextResponse.json({ error: "login_required" }, { status: 401, headers });
    const ownerId = data.user.id;
    await enforceOwnerMutationRateLimit("tiktok-inbox", ownerId);
    const id = z.uuid().parse((await context.params).id);
    const clip = await clipVideo(createAdminClient(), ownerId, id);
    assertInboxMedia(clip.bytes, "video/mp4", LIBRARY_INBOX_MAX_BYTES);
    const hash = createHash("sha256").update(clip.bytes).digest("hex");
    await releaseRetryableInboxReceipt(ownerId, clip.tiktokAccountId, hash);
    const inbox = await inboxContext(ownerId, clip.tiktokAccountId, randomUUID());
    const media = new Blob([clip.bytes], { type: "video/mp4" });
    const receipt = await sendInboxVideo({ ...inbox, media, hash, consent: true });
    return NextResponse.json({ ...inboxPublicReceipt(receipt), account: clip.tiktokAccountId }, { headers });
  } catch (error) {
    const reason = error instanceof Error && reasons.has(error.message) ? error.message : "send_unavailable";
    return NextResponse.json({ error: reason }, { status: 400, headers });
  }
}
