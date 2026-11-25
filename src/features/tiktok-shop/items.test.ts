import { describe, expect, it } from "vitest";
import { cleanItems, factsFromTitle, tiktokImageUrl, tiktokProductUrl } from "./items";

describe("TikTok Shop best-sellers read by the extension", () => {
  it("keeps valid items once (most sales wins), best-selling first", () => {
    const items = cleanItems([
      { productId: "1729534255321942633", title: "รองเท้าแตะ  SPIDER", sold: "120", price: "89", url: "https://shop.tiktok.com/th/pdp/spider/1729534255321942633" },
      { productId: "1730347578114083380", title: "ถังขยะ ACK-home", sold: 193554, price: "109", rating: 4.8, reviews: "19612" },
      { productId: "1729534255321942633", title: "รองเท้าแตะ SPIDER", sold: 900 },
      { productId: "abc", title: "bad id" }, { productId: "1733972572293334646", title: "" }, null,
    ]);
    expect(items.map(i => [i.productId, i.sold])).toEqual([["1730347578114083380", 193554], ["1729534255321942633", 900]]);
    expect(items[0]).toMatchObject({ price: 109, rating: 4.8, reviews: 19612 });
  });
  it("links only to TikTok Shop and shows photos only from TikTok's image hosts", () => {
    expect(tiktokProductUrl({ productId: "1729534255321942633", url: "https://shop.tiktok.com/th/pdp/spider/1729534255321942633?x=1" }))
      .toBe("https://shop.tiktok.com/th/pdp/spider/1729534255321942633");
    expect(tiktokProductUrl({ productId: "1729534255321942633", url: "https://evil.example/1729534255321942633" })).toBe("https://shop.tiktok.com/th/pdp/1729534255321942633");
    expect(tiktokImageUrl("https://p16-oec-sg.ibyteimg.com/tos/a.jpeg~tplv.webp?x-expires=1")).toMatch(/^https:\/\/p16-oec-sg\.ibyteimg\.com/);
    expect(tiktokImageUrl("https://evil.example/a.jpg")).toBeNull();
  });
  it("takes facts from the title's descriptive phrases, never prices, promos or the brand opener", () => {
    const facts = factsFromTitle("ACK-home EVE YOOS ถังขยะ แบบเปิดมือ-เปิดเท้า สะดวกต่อการใช้งาน ถังขยะมินิมอลพลาสติกทรงสี่เหลี่ยม มี 6 ขนาดให้เลือก ลด 50%");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.join(" ")).toContain("มี 6 ขนาดให้เลือก");
    expect(facts.join(" ")).not.toMatch(/ACK-home|%/);
  });
});
