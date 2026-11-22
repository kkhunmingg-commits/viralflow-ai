import { describe, expect, it } from "vitest";
import { PRAEW_MAX_PRODUCTS, praewProducts, selectLiveLineup, type LiveCandidate, type PostedProduct, type PostedTikTokProduct } from "./live-director";

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
  it("never puts a best-seller live without a kept fact, lists posted products even without facts, and lists a product once", () => {
    const noFact = [sale("1", 9, []), sale("2", 9, []), sale("3", 9, [])];
    const list = praewProducts(selectLiveLineup(noFact, now), noFact, [
      posted("a", "2026-11-18T00:00:00Z", []), posted("b", "2026-11-17T00:00:00Z"), posted("b", "2026-11-16T00:00:00Z"),
      posted("c", "2026-11-15T00:00:00Z", ["x"], "แป้ง b"),
    ]);
    expect(list.map(p => p.name)).toEqual(["แป้ง a", "แป้ง b"]);
    expect(list[0].facts).toEqual([]);
  });
  it("adds TikTok Shop products with posted clips after best-sellers, with price and photo, newest first, once", () => {
    const candidates = [sale("1", 9)];
    const tt = (id: string, at: string, price: number | null = 259): PostedTikTokProduct =>
      ({ productId: id, title: `นาฬิกา ${id}`, price, facts: [], postedAt: at, imageUrl: `https://img/${id}.jpg` });
    const list = praewProducts(selectLiveLineup(candidates, now), candidates, [posted("a", "2026-11-18T00:00:00Z")], PRAEW_MAX_PRODUCTS,
      [tt("x", "2026-11-10T00:00:00Z"), tt("y", "2026-11-20T00:00:00Z", null), tt("1", "2026-11-21T00:00:00Z")]);
    expect(list.map(p => p.name)).toEqual(["ทีวี 1", "นาฬิกา y", "นาฬิกา x", "แป้ง a"]);
    expect(list[1]).toMatchObject({ source: "POSTED_TIKTOK", where: "ตะกร้าสีส้มในไลฟ์", image: "https://img/y.jpg" });
    expect(list[1].price).toBeUndefined();
    expect(list[2].price).toContain("259");
  });
  it("stops at the list size", () => {
    const many = Array.from({ length: 9 }, (_, i) => posted(String(i), `2026-11-1${i}T00:00:00Z`));
    expect(praewProducts(selectLiveLineup([], now), [], many, PRAEW_MAX_PRODUCTS)).toHaveLength(PRAEW_MAX_PRODUCTS);
  });
});
