import { TikTokPublishingService } from "@/features/publishing/services";
import { verifyTikTokWebhookSignature } from "@/features/publishing/webhook";
import { serverEnv } from "@/lib/server-env";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!serverEnv.tiktokClientSecret) return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  const verified = verifyTikTokWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("tiktok-signature"),
    clientSecret: serverEnv.tiktokClientSecret,
    toleranceSeconds: serverEnv.tiktokWebhookToleranceSeconds,
  });
  if (!verified) return Response.json({ error: "invalid_signature" }, { status: 401 });
  try {
    const result = await new TikTokPublishingService().handlePublishWebhook(rawBody);
    return Response.json(result);
  } catch {
    return Response.json({ error: "invalid_webhook" }, { status: 400 });
  }
}
