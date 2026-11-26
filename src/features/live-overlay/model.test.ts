import { describe, expect, it } from "vitest";
import { autoPromoSet } from "./themes";
import { pinnedProducts, titleLikeness, configSchema, emptyConfig, makeItem, nextPopupDelaySec, parseToken, pickSpot, promoProduct, promoWords, tickerText, type OverlayProduct } from "./model";

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
const products: OverlayProduct[] = [
  { name: "เซรั่มวิตซี", price: "฿199", facts: ["ขนาด 30 มล."], image: "https://cdn.example/a.jpg", where: "ตะกร้าสีส้มในไลฟ์" },
  { name: "กระทะเคลือบ", price: null, facts: [], image: "owner/x/live-overlay/b.png", where: "ลิงก์ Shopee ในโพสต์คลิปสินค้าของช่อง" },
];

describe("live overlay model", () => {
  it("fills defaults and rejects bad items", () => {
    const c = configSchema.parse({ items: [{ id: "t1", kind: "text", x: 0.1, y: 0.2, w: 0.5, h: 0.1, text: "ลด 50%" }] });
    expect(c.items[0]).toMatchObject({ opacity: 1, rotation: 0, everyMin: 0, style: "white-outline" });
    expect(c.enabled).toBe(true);
    expect(configSchema.safeParse({ items: [{ id: "x", kind: "text", x: 2, y: 0, w: 0.5, h: 0.1 }] }).success).toBe(false);
    expect(configSchema.safeParse({ items: [{ id: "bad id!", kind: "emoji", x: 0, y: 0, w: 0.1, h: 0.1, emoji: "🔥" }] }).success).toBe(false);
  });

  it("keeps pop-ups off the face and the middle", () => {
    const face = emptyConfig().faceZone;
    for (let i = 0; i < 200; i++) {
      const s = pickSpot(0.14, 0.08, face);
      expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x + 0.14).toBeLessThanOrEqual(1.0001);
      const onFace = s.x < face.x + face.w && face.x < s.x + 0.14 && s.y < face.y + face.h && face.y < s.y + 0.08;
      expect(onFace).toBe(false);
    }
    // A pop-up too big to fit around the face falls back beside it.
    const big = pickSpot(0.3, 0.2, { x: 0.05, y: 0, w: 0.9, h: 1 }, seq(0.5));
    expect(big.x).toBeGreaterThanOrEqual(0);
  });

  it("times pop-ups around the chosen interval", () => {
    expect(nextPopupDelaySec(3, false, () => 0)).toBeCloseTo(108);
    expect(nextPopupDelaySec(3, false, () => 1)).toBeCloseTo(252);
    expect(nextPopupDelaySec(3, true, () => 0)).toBe(5);
  });

  it("cycles promo products and never invents a price", () => {
    const promo = makeItem("promo", { cycleSec: 10 }) as Extract<ReturnType<typeof makeItem>, { kind: "promo" }>;
    expect(promoProduct(promo, products, 0)?.name).toBe("เซรั่มวิตซี");
    expect(promoProduct(promo, products, 10_000)?.name).toBe("กระทะเคลือบ");
    expect(promoProduct({ ...promo, product: "กระทะเคลือบ" }, products, 0)?.name).toBe("กระทะเคลือบ");
    expect(promoWords(promo, products[1])).toMatchObject({ price: "", cta: "ดูในคลิปสินค้าของช่อง" });
    expect(promoWords({ ...promo, price: "ลด 50%" }, products[1]).price).toBe("ลด 50%");
    expect(promoWords(promo, products[0])).toMatchObject({ price: "฿199", fact: "ขนาด 30 มล.", cta: "กดตะกร้าสีส้มได้เลย 🛒" });
    expect(tickerText(makeItem("promo", { template: "ticker" }) as typeof promo, products)).toContain("เซรั่มวิตซี · ขนาด 30 มล. · ฿199");
  });

  it("makes an auto promo set and replaces only its own items", () => {
    const mine = makeItem("text", { text: "ของฉัน" });
    const once = autoPromoSet({ ...emptyConfig(), items: [mine] }, products, Math.random, { layout: "classic" });
    expect(once.items[0]).toBe(mine);
    expect(once.items.filter(i => i.auto).map(i => i.kind)).toEqual(expect.arrayContaining(["promo", "clock", "emoji"]));
    expect(once.items.some(i => i.kind === "promo" && i.template === "banner")).toBe(true);
    const twice = autoPromoSet(once, products);
    expect(twice.items.length).toBe(once.items.length);
    expect(configSchema.safeParse(twice).success).toBe(true);
    expect(JSON.stringify(twice).length).toBeLessThan(20_000);
  });

  it("shows the product pinned in the TikTok live cart", () => {
    expect(pinnedProducts(products, { name: "เซรั่มวิตซี ขนาด 30 มล. ของแท้" }).map(p => p.name)).toEqual(["เซรั่มวิตซี"]);
    expect(pinnedProducts(products, null).length).toBe(2);
    // The cart price TikTok reports for the pin beats a saved (often old) listing price.
    expect(pinnedProducts(products, { name: "เซรั่มวิตซี", price: "฿249" })[0].price).toBe("฿249");
    expect(pinnedProducts(products, { name: "เซรั่มวิตซี" })[0].price).toBe("฿199");
    const other = pinnedProducts(products, { name: "หมอนยางพารา", price: "฿299", image: "https://p16.tiktokcdn.com/x.jpg" });
    expect(other).toEqual([{ name: "หมอนยางพารา", price: "฿299", facts: [], where: "ตะกร้าสีส้มในไลฟ์", image: "https://p16.tiktokcdn.com/x.jpg" }]);
    expect(titleLikeness("กระทะเคลือบ non-stick 28cm", "กระทะเคลือบ non stick 28 cm")).toBe(1);
  });

  it("reads overlay tokens", () => {
    expect(parseToken("2b6f0c52-1d1e-4c39-9c8e-3a7f2d1b9e01.abcdefghijklmnopqrstuvwxyz012345")).toEqual({ owner: "2b6f0c52-1d1e-4c39-9c8e-3a7f2d1b9e01", secret: "abcdefghijklmnopqrstuvwxyz012345" });
    expect(parseToken("nope")).toBeNull();
    expect(parseToken(null)).toBeNull();
  });
});
