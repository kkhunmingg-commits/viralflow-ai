import { z } from "zod";
import type { SnapshotRecord } from "./customer-mapping";
import { observedNumber } from "./customer-mapping";

/** Internal learning boundary; deliberately never rendered as customer/debug JSON. */
const count = z.number().int().nonnegative().nullable();
const money = z.number().finite().nonnegative().nullable();
export const performanceEventSchema = z.object({
  eventKey: z.string().min(1).max(250), ownerId: z.string().min(1).max(100), accountId: z.string().min(1).max(100),
  productId: z.string().min(1).max(100).nullable(), source: z.enum(["POST", "LIVE"]),
  creativeReference: z.string().max(100).nullable(), scriptReference: z.string().max(100).nullable(), hookReference: z.string().max(100).nullable(),
  clipReference: z.string().min(1).max(100).nullable().optional(),
  postingTime: z.iso.datetime({ offset: true }).nullable().optional(),
  timestamp: z.iso.datetime({ offset: true }), evidence: z.enum(["OBSERVED", "INTERNAL_TEST"]),
  // Existing POST snapshots are cumulative. Consumers must calculate deltas, not add every sample.
  measurement: z.enum(["CUMULATIVE_SNAPSHOT", "SESSION_TOTAL"]),
  views: count, comments: count, clicks: count, units: count, sales: money, commission: money,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), audienceQuestions: z.array(z.string().min(1).max(1000)).max(100),
  liveDurationSeconds: z.number().finite().nonnegative().nullable(),
}).strict();
export type PerformanceEvent = z.infer<typeof performanceEventSchema>;

export function validatePerformanceEvent(input: unknown, ownerId: string, accountIds: ReadonlySet<string>, allowTest = false): PerformanceEvent {
  const event = performanceEventSchema.parse(input);
  if (event.ownerId !== ownerId || !accountIds.has(event.accountId)) throw new Error("performance_event_owner_mismatch");
  if (event.evidence !== "OBSERVED" && !allowTest) throw new Error("performance_event_not_observed");
  if (event.source === "POST" && (event.liveDurationSeconds !== null || event.measurement !== "CUMULATIVE_SNAPSHOT")) throw new Error("performance_event_source_mismatch");
  if (event.source === "LIVE" && event.measurement !== "SESSION_TOTAL") throw new Error("performance_event_source_mismatch");
  if ((event.sales !== null || event.commission !== null) && !event.currency) throw new Error("performance_event_currency_required");
  return structuredClone(event);
}

export function observedPostEvents(ownerId: string, accountIds: ReadonlySet<string>, rows: Array<SnapshotRecord & {
  creative_project_id?: string | null; script_id?: string | null; creative_angle_id?: string | null;
}>): PerformanceEvent[] {
  const events = new Map<string, PerformanceEvent>();
  for (const row of rows) {
    if (!accountIds.has(row.tiktok_account_id) || !["TIKTOK_DISPLAY", "TIKTOK_SHOP_ANALYTICS"].includes(row.source)) continue;
    const currency = /^[A-Z]{3}$/.test(row.currency ?? "") ? row.currency! : null;
    const event = validatePerformanceEvent({
      eventKey: `POST:${row.source}:${row.id}`, ownerId, accountId: row.tiktok_account_id, productId: row.product_id,
      source: "POST", creativeReference: row.creative_project_id ?? null, scriptReference: row.script_id ?? null,
      hookReference: row.creative_angle_id ?? null, clipReference: row.video_id,
      postingTime: row.published_at, timestamp: row.source_snapshot_at, evidence: "OBSERVED",
      measurement: "CUMULATIVE_SNAPSHOT", views: observedNumber(row.views), comments: observedNumber(row.comments),
      clicks: observedNumber(row.clicks), units: observedNumber(row.items_sold), sales: currency ? observedNumber(row.gmv) : null,
      commission: currency ? observedNumber(row.commission) : null, currency, audienceQuestions: [], liveDurationSeconds: null,
    }, ownerId, accountIds);
    events.set(event.eventKey, event);
  }
  return [...events.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export interface PerformanceEventSink {
  /** Must persist once per owner + eventKey and enforce owner/account membership at the durable boundary. */
  appendObserved(event: PerformanceEvent): Promise<"APPENDED" | "DUPLICATE">;
}
export async function forwardObservedEvents(events: PerformanceEvent[], owner: string, accountIds: ReadonlySet<string>, sink: PerformanceEventSink) {
  for (const event of events) await sink.appendObserved(validatePerformanceEvent(event, owner, accountIds));
}
