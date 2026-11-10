import { describe, expect, it } from "vitest";
import { parseProductLink, sameMarketplace } from "./link";
import { factCandidates, followLink, readProductPage } from "./source";
import { screenFacts, shortProductName, writeProductClip } from "./script";
import { buildProductSubtitles } from "./subtitles";
import { detailsFromBrowser } from "./browser-lookup";

describe("product links", () => {
  it("reads Shopee and Lazada links, short and full, and keeps the pasted link as is", () => {
    expect(parseProductLink("ดูอันนี้ https://s.shopee.co.th/AbC123 ถูกมาก")).toMatchObject({ platform: "SHOPEE", short: true, link: "https://s.shopee.co.th/AbC123" });
    expect(parseProductLink("https://shopee.co.th/product/37251700/7064733451?smtt=0.0.9")).toMatchObject({ platform: "SHOPEE", short: false, externalId: "37251700.7064733451" });
    expect(parseProductLink("https://shopee.co.th/%E0%B8%82%E0%B8%A7%E0%B8%94-i.123456.987654321").externalId).toBe("123456.987654321");
    expect(parseProductLink("https://www.lazada.co.th/products/bottle-i4400123-s17000456.html?spm=x")).toMatchObject({ platform: "LAZADA", externalId: "4400123" });
    expect(parseProductLink("https://s.lazada.co.th/s.xyz")).toMatchObject({ platform: "LAZADA", short: true });
  });
  it("refuses other sites and odd URLs", () => {
    expect(() => parseProductLink("https://evil.example/shopee.co.th")).toThrow("UNSUPPORTED_PRODUCT_LINK");
    expect(() => parseProductLink("https://user:pw@shopee.co.th/product/1/2")).toThrow("INVALID_PRODUCT_LINK");
    expect(() => parseProductLink("ไม่ใช่ลิงก์")).toThrow("INVALID_PRODUCT_LINK");
    expect(sameMarketplace("SHOPEE", "https://shopee.co.th/x")).toBe(true);
    expect(sameMarketplace("SHOPEE", "https://lazada.co.th/x")).toBe(false);
  });
  it("follows a short link only while it stays on the marketplace", async () => {
    const hops: Record<string, Response> = {
      "https://s.shopee.co.th/abc": new Response(null, { status: 302, headers: { location: "https://shopee.co.th/product/1234/5678" } }),
      "https://shopee.co.th/product/1234/5678": new Response("<html></html>", { status: 200 }),
    };
    const fetcher = (async (url: string) => hops[url]) as unknown as typeof fetch;
    expect((await followLink(parseProductLink("https://s.shopee.co.th/abc"), fetcher)).url).toBe("https://shopee.co.th/product/1234/5678");
    const away = (async () => new Response(null, { status: 302, headers: { location: "https://phish.example/" } })) as unknown as typeof fetch;
    await expect(followLink(parseProductLink("https://s.shopee.co.th/abc"), away)).rejects.toThrow("REDIRECT_LEFT_MARKETPLACE");
  });
  it("takes title, photos and description from schema.org data and Open Graph tags", () => {
    const html = `<html><head><title>x</title><meta property="og:title" content="ขวดน้ำ &amp; ฝา | Shopee Thailand">
      <meta property="og:image" content="https://cf.shopee.co.th/file/a.jpg"><meta property="og:image" content="http://insecure/b.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"ขวดน้ำเก็บความเย็น 500ml","image":["https://cf.shopee.co.th/file/c.jpg"],"description":"ความจุ 500 ml\\nวัสดุสแตนเลส 304\\nส่งฟรีทั่วไทย","brand":{"name":"CoolCo"}}</script></head></html>`;
    const page = readProductPage(html);
    expect(page).toMatchObject({ title: "ขวดน้ำเก็บความเย็น 500ml", brand: "CoolCo" });
    expect(page.images).toEqual(["https://cf.shopee.co.th/file/c.jpg", "https://cf.shopee.co.th/file/a.jpg"]);
    expect(factCandidates(page.description)).toEqual(["ความจุ 500 ml", "วัสดุสแตนเลส 304"]);
    expect(readProductPage(`<meta property="og:title" content="ของ | Shopee Thailand">`).title).toBe("ของ");
  });
});

describe("product clip script", () => {
  const base = { platform: "SHOPEE" as const, link: "https://s.shopee.co.th/AbC123", title: "【พร้อมส่ง】ขวดน้ำเก็บความเย็น สแตนเลส 500ml 🔥 ส่งไว",
    facts: ["ความจุ 500 ml", "วัสดุสแตนเลส 304", "ดีที่สุดในตลาด", "ลด 50% วันนี้เท่านั้น", "มี 3 สี"], imageCount: 3 };

  it("makes a speakable name and drops exaggerated or price facts", () => {
    expect(shortProductName(base.title)).toBe("ขวดน้ำเก็บความเย็น สแตนเลส 500ml");
    const { kept, dropped } = screenFacts(base.facts, "HOME_KITCHEN");
    expect(kept).toEqual(["ความจุ 500 ml", "วัสดุสแตนเลส 304", "มี 3 สี"]);
    expect(dropped.map(d => d.text)).toEqual(["ดีที่สุดในตลาด", "ลด 50% วันนี้เท่านั้น"]);
  });
  it("drops effect claims for beauty and never speaks benefits for supplements", () => {
    expect(screenFacts(["ช่วยให้ผิวขาวใสใน 7 วัน", "ขนาด 30 ml"], "BEAUTY").kept).toEqual(["ขนาด 30 ml"]);
    const supplement = writeProductClip({ ...base, title: "วิตามินซี 1000 mg", facts: ["บรรจุ 30 เม็ด"], lengthSeconds: 32 });
    expect(supplement.family).toBe("HEALTH_SUPPLEMENT");
    expect(supplement.shots.map(s => s.narration).join(" ")).not.toContain("30 เม็ด");
  });
  it.each([[8, 1], [16, 2], [24, 3], [32, 4], [40, 5]] as const)("%i seconds is %i takes with different framing and photos, one set", (length, takes) => {
    const script = writeProductClip({ ...base, lengthSeconds: length });
    expect(script.shots).toHaveLength(takes);
    // Every take changes the framing; the hand action repeats only once there are more takes than actions.
    expect(new Set(script.shots.map(s => s.role)).size).toBe(takes);
    expect(new Set(script.shots.map(s => s.action)).size).toBe(Math.min(takes, 4));
    if (takes > 1) {
      expect(new Set(script.shots.map(s => s.imageIndex)).size).toBe(Math.min(takes, 3));
      for (const shot of script.shots) expect(shot.prompt).toContain(`of ${takes} of one product advert`);
      // Same set line in every take: continuity.
      expect(new Set(script.shots.map(s => s.prompt.split("\n").find(l => l.startsWith("SET:")))).size).toBe(1);
    }
    expect(script.compliance.status).toBe("PASS");
    expect(script.caption).toContain(base.link);
    expect(script.comment).toContain(base.link);
    expect(script.caption).toContain("AI");
    expect(script.caption).toContain("affiliate");
    for (const s of script.shots) expect(s.narration).not.toMatch(/ดีที่สุด|50%|ลด/);
  });
  it("only speaks numbers that the kept facts contain", () => {
    const script = writeProductClip({ ...base, lengthSeconds: 32 });
    const allowed = new Set(["500", "304", "3"]);
    for (const shot of script.shots) for (const n of shot.narration.match(/\d+/g) ?? []) expect(allowed.has(n)).toBe(true);
  });
  it("a different variant can change the set or hook", () => {
    const sets = new Set([0, 1, 2, 3].map(variant => writeProductClip({ ...base, lengthSeconds: 16, variant }).setId));
    expect(sets.size).toBeGreaterThan(1);
  });
  it("builds every clip around a trend format: scroll-stopping opening, on-screen hook, loop ending, engagement line", () => {
    const script = writeProductClip({ ...base, lengthSeconds: 24, now: new Date("2026-11-09T12:00:00Z") });
    expect(script.format).toBeTruthy();
    expect(script.hookText && [...script.hookText].length).toBeLessThanOrEqual(30);
    expect(script.shots[0].prompt).toContain("OPENING (first second");
    expect(script.shots.at(-1)!.prompt).toContain("LOOP:");
    expect(script.shots[1].prompt).not.toContain("OPENING (first second");
    expect(script.caption.split("\n")[0]).not.toBe(script.shortName);
    expect(script.caption).toMatch(/คอมเมนต์|เซฟ|แท็ก/);
    expect(script.hashtags).toContain("#ป้ายยา");
    expect(script.compliance.status).toBe("PASS");
    // Remakes rotate the format.
    const formats = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(variant => writeProductClip({ ...base, lengthSeconds: 16, variant }).format));
    expect(formats.size).toBeGreaterThan(1);
  });
  it("never puts an exaggerated hook on screen or in the voice", () => {
    for (let variant = 0; variant < 20; variant++) {
      const script = writeProductClip({ ...base, lengthSeconds: 40, variant });
      for (const text of [script.hookText ?? "", ...script.shots.map(s => s.narration)]) expect(text).not.toMatch(/ที่สุด|อันดับ\s*1|ขายดี|100\s*%|การันตี/);
    }
  });
  it("subtitles carry each line, the AI label and the link end card", () => {
    const ass = buildProductSubtitles({ lines: ["หนึ่ง", "สอง"], durations: [8, 8], endCard: "ลิงก์สินค้าอยู่ในคอมเมนต์", aiLabel: "สร้างด้วย AI", hookText: "ทายสิ นี่คืออะไร" });
    expect(ass).toContain("Hook,,0,0,0,,{\\fad(0,250)}ทายสิ นี่คืออะไร");
    expect(ass).toContain("Sub,,0,0,0,,หนึ่ง");
    expect(ass).toContain("0:00:08.40");
    expect(ass).toContain("Label,,0,0,0,,สร้างด้วย AI");
    expect(ass).toContain("End,,0,0,0,,");
  });
});

describe("reading the product page on the owner's computer", async () => {
  const { detailsFromBrowser, isLoginWall, lookupResultSchema, shopeeImageUrl } = await import("./browser-lookup");
  const jobId = "6f1c1b7e-8a3e-4c1f-9a0e-2b4c6d8e0f12";

  it("uses Shopee's product data: exact title, every photo on the shop's own CDN, the seller's lines", () => {
    const result = lookupResultSchema.parse({ jobId, ok: true, finalUrl: "https://shopee.co.th/ขวดน้ำ-i.123456.987654321?sp_atk=x",
      api: { item: { title: "ขวดน้ำเก็บความเย็น 500ml", description: "ความจุ 500 ml\nวัสดุสแตนเลส 304\nส่งไว", images: ["th-11134207-7r98o-abcdef123456", "th-11134207-7r98o-zzzzzz999999"], shop_id: 123456, item_id: 987654321 } },
      html: "<html></html>", dom: { title: "x | Shopee Thailand", images: [] } });
    const details = detailsFromBrowser("SHOPEE", result);
    expect(details.title).toBe("ขวดน้ำเก็บความเย็น 500ml");
    expect(details.imageUrls[0]).toBe("https://down-th.img.susercontent.com/file/th-11134207-7r98o-abcdef123456");
    expect(details.imageUrls).toHaveLength(2);
    expect(details.externalId).toBe("123456.987654321");
    expect(factCandidates(details.description)).toEqual(["ความจุ 500 ml", "วัสดุสแตนเลส 304"]);
  });
  it("falls back to the page's schema.org / Open Graph data (Lazada) and the page title", () => {
    const html = `<meta property="og:title" content="กระเป๋าผ้า | Lazada.co.th"><meta property="og:image" content="https://img.lazcdn.com/g/p/a.jpg">`;
    const details = detailsFromBrowser("LAZADA", lookupResultSchema.parse({ jobId, ok: true, finalUrl: "https://www.lazada.co.th/products/x-i4400123-s1.html", html }));
    expect(details).toMatchObject({ title: "กระเป๋าผ้า", imageUrls: ["https://img.lazcdn.com/g/p/a.jpg"], externalId: "4400123" });
  });
  it("spots sign-in walls and never trusts a page off the marketplace", () => {
    expect(isLoginWall("https://shopee.co.th/buyer/login?next=x")).toBe(true);
    expect(isLoginWall("https://shopee.co.th/verify/traffic")).toBe(true);
    expect(isLoginWall("https://shopee.co.th/product/1/2")).toBe(false);
    expect(detailsFromBrowser("SHOPEE", lookupResultSchema.parse({ jobId, ok: true, finalUrl: "https://evil.example/x" })).productUrl).toBeNull();
    expect(shopeeImageUrl("../../etc")).toBeNull();
  });
});

describe("send from the owner's Chrome (bookmark)", () => {
  it("accepts only Shopee/Lazada product pages and origins", async () => {
    const { capturePlatform, marketplaceOrigin } = await import("./capture");
    expect(capturePlatform("https://shopee.co.th/product/897244389/27942400787")).toBe("SHOPEE");
    expect(capturePlatform("https://www.lazada.co.th/products/x-i123456-s789.html")).toBe("LAZADA");
    expect(capturePlatform("https://s.shopee.co.th/50aUa6OhmY")).toBeNull();
    expect(capturePlatform("https://evil.example/product/1/2")).toBeNull();
    expect(marketplaceOrigin("https://shopee.co.th")).toBe(true);
    expect(marketplaceOrigin("https://www.lazada.co.th")).toBe(true);
    expect(marketplaceOrigin("https://shopee.co.th.evil.example")).toBe(false);
    expect(marketplaceOrigin(null)).toBe(false);
  });
  it("builds a self-contained bookmark for the ViralFlow origin", async () => {
    const { bookmarkletHref } = await import("./capture");
    const href = bookmarkletHref("https://viralflow.example");
    expect(href.startsWith("javascript:")).toBe(true);
    const code = decodeURIComponent(href.slice("javascript:".length));
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain("https://viralflow.example");
    expect(code).not.toMatch(/\brequire\(|__webpack|import\(/);
  });
  it("reads a captured Shopee page into product details", async () => {
    const { captureSchema } = await import("./capture");
    const html = `<html><head><title>คุชชั่น KAGE | Shopee Thailand</title><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "คุชชั่น KAGE SPF50", description: "เนื้อบางเบา\nเกลี่ยง่าย", image: "https://down-th.img.susercontent.com/file/th-11134207-81ztc-mv74x3v4scua8b" })}</script></head></html>`;
    const capture = captureSchema.parse({ finalUrl: "https://shopee.co.th/product/897244389/27942400787", html, dom: { title: "x", h1: "คุชชั่น KAGE SPF50", images: [] } });
    const details = detailsFromBrowser("SHOPEE", { ...capture, jobId: "00000000-0000-4000-8000-000000000000", ok: true });
    expect(details.title).toBe("คุชชั่น KAGE SPF50");
    expect(details.externalId).toBe("897244389.27942400787");
    expect(details.imageUrls[0]).toContain("susercontent.com/file/th-11134207");
  });
});
