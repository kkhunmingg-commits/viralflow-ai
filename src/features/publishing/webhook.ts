import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const webhookEnvelopeSchema = z.object({
  client_key: z.string().min(1),
  event: z.enum([
    "post.publish.failed",
    "post.publish.complete",
    "post.publish.inbox_delivered",
    "post.publish.publicly_available",
    "post.publish.no_longer_publicaly_available",
  ]),
  create_time: z.number().int().positive(),
  user_openid: z.string().default(""),
  content: z.string(),
});

const webhookContentSchema = z.object({
  publish_id: z.string().min(1).max(64),
  post_id: z.union([z.string(), z.number()]).nullish(),
  publish_type: z.string().nullish(),
  reason: z.string().nullish(),
});

export function verifyTikTokWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  clientSecret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}) {
  if (!input.signatureHeader) return false;
  const parts = Object.fromEntries(input.signatureHeader.split(",").map(part => part.trim().split("=", 2)));
  const timestamp = Number(parts.t);
  const signature = parts.s;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || !signature || Math.abs(now - timestamp) > (input.toleranceSeconds ?? 300)) return false;
  const expected = createHmac("sha256", input.clientSecret).update(`${timestamp}.${input.rawBody}`).digest("hex");
  const received = Buffer.from(signature, "hex");
  const local = Buffer.from(expected, "hex");
  return received.length === local.length && timingSafeEqual(received, local);
}

export function parseTikTokPublishWebhook(rawBody: string) {
  const envelope = webhookEnvelopeSchema.parse(JSON.parse(rawBody));
  const content = webhookContentSchema.parse(JSON.parse(envelope.content));
  const target = envelope.event === "post.publish.failed"
    ? "FAILED"
    : envelope.event === "post.publish.inbox_delivered"
      ? "DRAFT_DELIVERED"
      : envelope.event === "post.publish.no_longer_publicaly_available"
        ? "PROCESSING"
        : "PUBLISHED";
  return { envelope, content, target } as const;
}
