import { describe, expect, it } from "vitest";
import { NO_STATS, PRAEW_MAX_PRODUCTS, praewProducts, productStatsScore, selectLiveLineup, type LiveCandidate, type PostedTikTokProduct, type ProductStats, type TikTokLivePick } from "./live-director";

const now = new Date("2026-11-19T04:00:00Z");
const sale = (id: string, orders: number, facts = ["กันน้ำ IPX4"]): LiveCandidate =>
  ({ productId: id, title: `ทีวี ${id}`, price: 199, videoOrders: orders, videoGmv: orders * 199, settledCommission: orders * 10, lastOrderAt: "2026-11-18T00:00:00Z", facts });
const pick = (title: string, price: number | null = 109, facts: string[] = []): TikTokLivePick => ({ title, price, facts, image: `https://p16-oec-sg.ibyteimg.com/${title.length}.jpg` });
const tt = (id: string, at: string, price: number | null = 259, stats?: Partial<ProductStats>): PostedTikTokProduct =>
  ({ productId: id, title: `นาฬิกา ${id}`, price, facts: [], postedAt: at, imageUrl: `https://img/${id}.jpg`, ...(stats ? { stats: { ...NO_STATS, ...stats } } : {}) });

describe("Praew's product list (TikTok LIVE: TikTok Shop products only)", () => {
  it("puts the owner's TikTok Shop picks first, with the exact TikTok title (the pin is matched by it), price and photo", () => {
    const title = "ACK-home EVE YOOS ถังขยะ แบบเปิดมือ-เปิดเท้า สะดวกต่อการใช้งาน ถังขยะมินิมอลพลาสติกทรงสี่เหลี่ยม มี 6 ขนาดให้เลือก";
    const candidates = [sale("1", 9)];
    const list = praewProducts(selectLiveLineup(candidates, now), candidates, PRAEW_MAX_PRODUCTS, [], [pick(title, 109, ["มี 6 ขนาดให้เลือก"])]);
    expect(list.map(p => p.source)).toEqual(["TIKTOK_PICK", "TIKTOK_SALES"]);
    expect(list[0]).toMatchObject({ name: title, where: "ตะกร้าสีส้มในไลฟ์", facts: ["มี 6 ขนาดให้เลือก"] });
    expect(list[0].price).toContain("109");
    expect(list[0].image).toMatch(/^https:\/\//);
    expect(list[0].never_say).toContain("รักษา");
  });
  it("lists a pick even without facts or price, and a product once", () => {
    const list = praewProducts(selectLiveLineup([], now), [], PRAEW_MAX_PRODUCTS, [], [pick("แป้ง a", null), pick("แป้ง a"), pick("แป้ง b")]);
    expect(list.map(p => p.name)).toEqual(["แป้ง a", "แป้ง b"]);
    expect(list[0].price).toBeUndefined();
  });
  it("then real best-sellers of the block, in lineup order, each with a kept fact", () => {
    const candidates = [sale("1", 9), sale("2", 5), sale("3", 3, [])];
    const list = praewProducts(selectLiveLineup(candidates, now), candidates, PRAEW_MAX_PRODUCTS);
    expect(list.map(p => p.name)).toEqual(["ทีวี 1", "ทีวี 2"]);
    expect(list[0]).toMatchObject({ source: "TIKTOK_SALES", where: "ตะกร้าสีส้มในไลฟ์" });
    expect(list[0].price).toContain("199");
  });
  it("then TikTok Shop products with posted clips, best results first, newest first when tied, once", () => {
    const candidates = [sale("1", 9)];
    const list = praewProducts(selectLiveLineup(candidates, now), candidates, PRAEW_MAX_PRODUCTS,
      [tt("x", "2026-11-10T00:00:00Z"), tt("y", "2026-11-20T00:00:00Z", null), tt("1", "2026-11-21T00:00:00Z"), tt("sold", "2026-11-02T00:00:00Z", 259, { orders: 3, gmv: 777 })]);
    expect(list.map(p => p.name)).toEqual(["ทีวี 1", "นาฬิกา sold", "นาฬิกา y", "นาฬิกา x"]);
    expect(list[2]).toMatchObject({ source: "POSTED_TIKTOK", image: "https://img/y.jpg" });
    expect(list[2].price).toBeUndefined();
  });
  it("never lists Shopee / Lazada products (they cannot be pinned in a TikTok cart)", () => {
    const list = praewProducts(selectLiveLineup([], now), [], PRAEW_MAX_PRODUCTS, [], [pick("แป้ง a")]);
    expect(list.every(p => p.where === "ตะกร้าสีส้มในไลฟ์")).toBe(true);
    expect(list.map(p => p.source)).not.toContain("POSTED_CLIP");
  });
  it("scores a product only on counted numbers", () => {
    expect(productStatsScore(NO_STATS)).toBe(0);
    expect(productStatsScore({ ...NO_STATS, orders: 1 })).toBeGreaterThan(productStatsScore({ ...NO_STATS, views: 100000, likes: 9000 }));
  });
  it("stops at the list size", () => {
    const many = Array.from({ length: 14 }, (_, i) => pick(`สินค้า ${i}`));
    expect(praewProducts(selectLiveLineup([], now), [], PRAEW_MAX_PRODUCTS, [], many)).toHaveLength(PRAEW_MAX_PRODUCTS);
  });
});
