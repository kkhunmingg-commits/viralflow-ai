import { describe, expect, it } from "vitest";
import { productEvidenceSummary } from "./evidence-summary";

const base = { verifiedFacts: 0, rightsClearedFootage: 0, rightsClearedImages: 0, operationFootage: 0, orders: [], actualCostThb: null, postsWithResults: 0 };
const real = { id: "p", title: "ขวดน้ำ", external_provider: "tiktok_shop", provider_metadata: {}, current_price: 199, commission_rate: .1 };
describe("product evidence summary", () => {
  it("waits for data instead of assuming it", () => {
    const s = productEvidenceSummary({ ...base, product: real });
    expect([s.facts.status, s.media.status, s.commissionByChannel.status, s.profitThb.status, s.tiktokTrend.status]).toEqual(["WAIT_FOR_DATA", "WAIT_FOR_DATA", "WAIT_FOR_DATA", "UNKNOWN", "WAIT_FOR_DATA"]);
    expect(s.listedCommissionRate.status).toBe("CATALOG_LISTED");
  });
  it("reports profit only from settled commission and actual cost, per channel", () => {
    const orders = [{ channel: "VIDEO", event_type: "ORDER_SETTLED", external_order_id: "1", external_event_id: "1:p:ORDER_SETTLED", gmv: 199, estimated_commission: 19.9, settled_commission: 19.9 },
      { channel: "LIVE", event_type: "ORDER_SETTLED", external_order_id: "2", external_event_id: "2:p:ORDER_SETTLED", gmv: 199, estimated_commission: 19.9, settled_commission: 19.9 }];
    const s = productEvidenceSummary({ ...base, product: real, orders, actualCostThb: 5 });
    expect(s.profitThb).toMatchObject({ status: "OWNER_REPORTED", value: 34.8 });
    expect(Object.keys(s.commissionByChannel.value!)).toEqual(["VIDEO", "LIVE"]);
  });
  it("marks everything about a test product as test data", () => {
    const s = productEvidenceSummary({ ...base, verifiedFacts: 2, product: { ...real, external_provider: "pilot-mock" } });
    expect(s.facts.status).toBe("TEST_DATA");
  });
});
