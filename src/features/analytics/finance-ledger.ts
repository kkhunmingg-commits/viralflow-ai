/**
 * Money ledger split by where it was earned: each clip on its own line, LIVE as its own total, anything the report did
 * not attribute kept separate. Built only from imported TikTok Shop Affiliate order events (MOCK excluded); an order
 * line counts once, at its furthest state, exactly as `channelRevenue` does.
 */
export interface LedgerOrder {
  channel: string; event_type: string; external_order_id: string; external_event_id: string;
  external_video_id?: string | null; tiktok_account_id?: string | null; product_id?: string | null;
  gmv: number | null; estimated_commission: number | null; settled_commission: number | null; source?: string | null;
}
export interface LedgerLine { orders: number; cancelled: number; gmv: number; estimatedCommission: number; settledCommission: number }
export interface ClipLine extends LedgerLine { videoId: string; accountId: string | null }
export interface FinanceLedger { clips: ClipLine[]; video: LedgerLine; live: LedgerLine; other: LedgerLine; videoWithoutClipId: LedgerLine }

const empty = (): LedgerLine => ({ orders: 0, cancelled: 0, gmv: 0, estimatedCommission: 0, settledCommission: 0 });
const add = (line: LedgerLine, o: LedgerOrder) => {
  if (o.event_type === "ORDER_CANCELLED") { line.cancelled++; return; }
  line.orders++; line.gmv += o.gmv ?? 0; line.estimatedCommission += o.estimated_commission ?? 0; line.settledCommission += o.settled_commission ?? 0;
};
const round = <T extends LedgerLine>(l: T): T => ({ ...l, gmv: Math.round(l.gmv * 100) / 100, estimatedCommission: Math.round(l.estimatedCommission * 100) / 100, settledCommission: Math.round(l.settledCommission * 100) / 100 });

export function financeLedger(orders: readonly LedgerOrder[]): FinanceLedger {
  const latest = new Map<string, LedgerOrder>();
  const rank = (e: string) => e === "ORDER_CANCELLED" ? 3 : e === "ORDER_SETTLED" ? 2 : 1;
  for (const o of orders) {
    if (o.source === "MOCK") continue;
    const k = o.external_event_id.replace(/:(ORDER_CREATED|ORDER_SETTLED|ORDER_CANCELLED|COMMISSION_UPDATED)$/, ""), prior = latest.get(k);
    if (!prior || rank(o.event_type) > rank(prior.event_type)) latest.set(k, o);
  }
  const clips = new Map<string, ClipLine>(), video = empty(), live = empty(), other = empty(), noClip = empty();
  for (const o of latest.values()) {
    if (o.channel === "LIVE") { add(live, o); continue; }
    if (o.channel !== "VIDEO") { add(other, o); continue; }
    add(video, o);
    if (!o.external_video_id) { add(noClip, o); continue; }
    const key = `${o.tiktok_account_id ?? ""}:${o.external_video_id}`;
    const clip = clips.get(key) ?? { ...empty(), videoId: o.external_video_id, accountId: o.tiktok_account_id ?? null };
    add(clip, o); clips.set(key, clip);
  }
  return {
    clips: [...clips.values()].map(round).sort((a, b) => b.settledCommission - a.settledCommission || b.gmv - a.gmv || a.videoId.localeCompare(b.videoId)),
    video: round(video), live: round(live), other: round(other), videoWithoutClipId: round(noClip),
  };
}
