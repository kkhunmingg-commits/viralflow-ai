import { createHash } from "node:crypto";
import type { QueueCandidate } from "./types";

export function remainingPublishSlots(effectiveCap: number, postsToday: number, reservedToday: number) {
  return Math.max(0, effectiveCap - postsToday - reservedToday);
}

export function deterministicNextDaySlot(queueId: string, from = new Date()) {
  const hash = createHash("sha256").update(queueId).digest();
  const minute = hash.readUInt16BE(0) % (18 * 60);
  const next = new Date(from);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCMinutes(3 * 60 + minute);
  return next.toISOString();
}

export function scheduleCandidates(
  candidates: readonly QueueCandidate[],
  capacityByAccount: Readonly<Record<string, number>>,
) {
  const used = new Map<string, number>();
  return [...candidates]
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((candidate) => {
      const consumed = used.get(candidate.accountId) ?? 0;
      const cap = Math.max(0, capacityByAccount[candidate.accountId] ?? 0);
      const hasSlot = consumed < cap;
      used.set(candidate.accountId, consumed + (hasSlot ? 1 : 0));
      return { ...candidate, status: hasSlot ? "QUEUED" as const : "WAITING_FOR_SLOT" as const };
    });
}

export function retryDelaySeconds(retryCount: number) {
  return [60, 300, 900][Math.min(Math.max(0, retryCount), 2)];
}
