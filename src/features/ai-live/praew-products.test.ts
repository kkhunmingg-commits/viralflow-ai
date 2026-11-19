import { describe, expect, it } from "vitest";
import { praewProducts, selectLiveLineup, type LiveCandidate, type PostedProduct } from "./live-director";

const now = new Date("2026-11-19T04:00:00Z");
const sale = (id: string, orders: number, facts = ["กันน้ำ IPX4"]): LiveCandidate =>
  ({ productId: id, title: `ทีวี ${id}`, price: 199, videoOrders: orders, videoGmv: orders * 199, settledCommission: orders * 10, lastOrderAt: "2026-11-18T00:00:00Z", facts });
const posted = (key: string, at: string, facts = ["เนื้อแมตต์"], title = `แป้ง ${key}`): PostedProduct =>
  ({ key, title, platform: "SHOPEE", facts, approvedAt: at, postedOn: 1 });

describe("Praew's product list", () => {
  it("uses posted link-clip products when there are no TikTok sales yet, newest first", () => {
    const lineup = selectLiveLineup([], now);
    const list = praewProducts(lineup, [], [posted("a", "2026-11-10T00:00:00Z"), posted("b", "2026-11-18T00:00:00Z")]);
    expect(list.map(p => p.name)).toEqual(["แป้ง b", "แป้ง a"]);
    expect(list[0]).toMatchObject({ source: "POSTED_CLIP", where: "ลิงก์ Shopee ในโพสต์คลิปสินค้าของช่อง" });
    expect(list[0].price).toBeUndefined();
    expect(list[0].never_say).toContain("รักษา");
  });
  it("puts real best-sellers first, then fills up to 4 with posted products", () => {
    const candidates = [sale("1", 9), sale("2", 5), sale("3", 3)];
    const list = praewProducts(selectLiveLineup(candidates, now), candidates, [posted("a", "2026-11-18T00:00:00Z"), posted("b", "2026-11-17T00:00:00Z")]);
    expect(list.map(p => p.name)).toEqual(["ทีวี 1", "ทีวี 2", "ทีวี 3", "แป้ง a"]);
    expect(list[0]).toMatchObject({ source: "TIKTOK_SALES", where: "ตะกร้าสีส้มในไลฟ์" });
    expect(list[0].price).toContain("199");
  });
  it("keeps a seller with real orders even before there are 3 of them", () => {
    const candidates = [sale("1", 2)];
    const list = praewProducts(selectLiveLineup(candidates, now), candidates, []);
    expect(list.map(p => p.source)).toEqual(["TIKTOK_SALES"]);
  });
  it("never puts a product live without a kept fact, and lists a product once", () => {
    const list = praewProducts(selectLiveLineup([], now), [], [
      posted("a", "2026-11-18T00:00:00Z", []), posted("b", "2026-11-17T00:00:00Z"), posted("b", "2026-11-16T00:00:00Z"),
      posted("c", "2026-11-15T00:00:00Z", ["x"], "แป้ง b"),
    ]);
    expect(list.map(p => p.name)).toEqual(["แป้ง b"]);
  });
});
