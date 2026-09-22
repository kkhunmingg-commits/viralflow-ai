import { TikTokPublishingService } from "@/features/publishing/services";
import { verifyTikTokWebhookSignature } from "@/features/publishing/webhook";
import { serverEnv } from "@/lib/server-env";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { readJsonBodyWithLimit, requestFingerprint, securityErrorResponse } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!serverEnv.tiktokClientSecret) return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  try {
    await enforceRateLimit({
      scope: "tiktok-content-posting-webhook",
      keyHash: requestFingerprint(request, "tiktok-content-posting"),
      limit: serverEnv.tiktokWebhookRateLimit,
      windowSeconds: 60,
    });
    const rawBody = await readJsonBodyWithLimit(request, serverEnv.tiktokWebhookMaxBytes);
    const verified = verifyTikTokWebhookSignature({
      rawBody,
      signatureHeader: request.headers.get("tiktok-signature"),
      clientSecret: serverEnv.tiktokClientSecret,
      toleranceSeconds: serverEnv.tiktokWebhookToleranceSeconds,
    });
    if (!verified) return Response.json({ error: "invalid_signature" }, { status: 401 });
    const result = await new TikTokPublishingService().handlePublishWebhook(rawBody);
    return Response.json(result);
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    return Response.json({ error: "invalid_webhook" }, { status: 400 });
  }
}
