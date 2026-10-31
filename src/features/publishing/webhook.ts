import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const webhookEnvelopeSchema = z.object({
  client_key: z.string().min(1).max(128),
  event: z.enum([
    "post.publish.failed",
    "post.publish.complete",
    "post.publish.inbox_delivered",
    "post.publish.publicly_available",
    "post.publish.no_longer_publicaly_available",
  ]),
  create_time: z.number().int().positive(),
  user_openid: z.string().max(128).default(""),
  content: z.string().min(2).max(16384),
}).strict();

const webhookContentSchema = z.object({
  publish_id: z.string().min(1).max(64),
  post_id: z.union([z.string().max(128), z.number()]).nullish(),
  publish_type: z.string().max(64).nullish(),
  reason: z.string().max(512).nullish(),
}).strict();

export function verifyTikTokWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  clientSecret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}) {
  if (!input.signatureHeader) return false;
  const pairs = input.signatureHeader.split(",").map(part => part.trim().split("=", 2));
  if (pairs.some(pair => pair.length !== 2) || new Set(pairs.map(pair => pair[0])).size !== pairs.length) return false;
  const parts = Object.fromEntries(pairs);
  const timestamp = Number(parts.t);
  const signature = parts.s;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/i.test(signature) || Math.abs(now - timestamp) > (input.toleranceSeconds ?? 300)) return false;
  const expected = createHmac("sha256", input.clientSecret).update(`${timestamp}.${input.rawBody}`).digest("hex");
  const received = Buffer.from(signature, "hex");
  const local = Buffer.from(expected, "hex");
  return received.length === local.length && timingSafeEqual(received, local);
}

export function parseTikTokPublishWebhook(rawBody: string, expectedClientKey?: string) {
  const envelope = webhookEnvelopeSchema.parse(JSON.parse(rawBody));
  if (expectedClientKey && envelope.client_key !== expectedClientKey) {
    throw new Error("webhook_client_key_mismatch");
  }
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
