import { describe, expect, it } from "vitest";
import { financeLedger, type LedgerOrder } from "./finance-ledger";

const order = (id: string, event: string, extra: Partial<LedgerOrder> = {}): LedgerOrder => ({
  channel: "VIDEO", event_type: event, external_order_id: id, external_event_id: `${id}:P1:${event}`, external_video_id: "v1",
  tiktok_account_id: "acc", gmv: 100, estimated_commission: 10, settled_commission: event === "ORDER_SETTLED" ? 10 : null, source: "OWNER_REPORT_IMPORT", ...extra,
});

describe("finance ledger", () => {
  it("separates each clip, LIVE, and unattributed revenue and counts an order line once", () => {
    const ledger = financeLedger([
      order("o1", "ORDER_CREATED"), order("o1", "ORDER_SETTLED"),
      order("o2", "ORDER_SETTLED", { external_video_id: "v2", gmv: 300, settled_commission: 30 }),
      order("o3", "ORDER_CANCELLED"),
      order("o4", "ORDER_SETTLED", { channel: "LIVE", external_video_id: null, gmv: 500, settled_commission: 50 }),
      order("o5", "ORDER_SETTLED", { channel: "UNKNOWN" }),
      order("o6", "ORDER_SETTLED", { external_video_id: null }),
      order("o7", "ORDER_SETTLED", { source: "MOCK", gmv: 9999 }),
    ]);
    expect(ledger.clips.map(c => [c.videoId, c.orders, c.settledCommission])).toEqual([["v2", 1, 30], ["v1", 1, 10]]);
    expect(ledger.clips.find(c => c.videoId === "v1")?.cancelled).toBe(1);
    expect(ledger.video).toMatchObject({ orders: 3, gmv: 500, settledCommission: 50, cancelled: 1 });
    expect(ledger.live).toMatchObject({ orders: 1, gmv: 500, settledCommission: 50 });
    expect(ledger.other.orders).toBe(1);
    expect(ledger.videoWithoutClipId.orders).toBe(1);
  });
});
