import { createHash } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { enforceOwnerMutationRateLimit } from "@/lib/security/rate-limit";
import { inboxContext } from "@/features/tiktok/inbox-service";
import { assertInboxMedia, INBOX_MAX_BYTES, inboxPublicReceipt, refreshInboxReceipt, sendInboxVideo } from "@/features/tiktok/inbox-flow";

export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = z.string().uuid();
const headers = { "Cache-Control": "no-store" };
const failure = (status = 400) => NextResponse.json({ error: "ไม่สามารถส่งวิดีโอได้ กรุณาตรวจบัญชีและลองตรวจสถานะอีกครั้ง" }, { status, headers });

async function owner(request: Request) {
  if (!serverEnv.appUrl || request.headers.get("origin") !== new URL(serverEnv.appUrl).origin) throw new Error("origin_required");
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) throw new Error("login_required");
  await enforceOwnerMutationRateLimit("tiktok-inbox", data.user.id);
  return data.user.id;
}

export async function POST(request: Request) {
  try {
    const ownerId = await owner(request);
    const length = Number(request.headers.get("content-length"));
    if (!length || length > INBOX_MAX_BYTES + 20_000) return failure(413);
    const reader = request.body?.getReader();
    if (!reader) return failure();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > INBOX_MAX_BYTES + 20_000) { await reader.cancel(); return failure(413); }
        chunks.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const accountId = uuid.parse(form.get("account"));
    const key = uuid.parse(form.get("key"));
    const file = form.get("video");
    if (!(file instanceof File) || file.size > INBOX_MAX_BYTES || form.get("consent") !== "yes") return failure();
    const bytes = new Uint8Array(await file.arrayBuffer());
    assertInboxMedia(bytes, file.type);
    const context = await inboxContext(ownerId, accountId, key);
    const receipt = await sendInboxVideo({ ...context, media: file, hash: createHash("sha256").update(bytes).digest("hex"), consent: true });
    return NextResponse.json(inboxPublicReceipt(receipt), { headers });
  } catch { return failure(); }
}

export async function GET(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site") !== "same-origin") return failure(403);
    const { data, error } = await (await createClient()).auth.getUser();
    if (error || !data.user) return failure(401);
    await enforceOwnerMutationRateLimit("tiktok-inbox-status", data.user.id);
    const params = new URL(request.url).searchParams;
    const context = await inboxContext(data.user.id, uuid.parse(params.get("account")));
    const receipt = await context.receipt(uuid.parse(params.get("receipt")));
    return NextResponse.json(inboxPublicReceipt(await refreshInboxReceipt(context.store, context.provider, context.token, receipt)), { headers });
  } catch { return failure(); }
}
