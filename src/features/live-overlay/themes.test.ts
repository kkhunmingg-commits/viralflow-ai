import { describe, expect, it } from "vitest";
import { configSchema, emptyConfig, makeItem, overTikTokUi, pickSpot, type OverlayProduct } from "./model";
import { LAYOUTS, NEW_LOOK_GAP_MS, TONES, autoPromoSet, chooseLook, lookLabel, needsArranging, needsFirstSet, productCategory, wantsNewLook } from "./themes";

const beauty: OverlayProduct[] = [
  { name: "เซรั่มวิตซีหน้าใส", price: "฿199", facts: ["ขนาด 30 มล."], image: "https://cdn.example/a.jpg", where: "ตะกร้าสีส้มในไลฟ์" },
  { name: "ครีมกันแดด SPF50", price: null, facts: [], image: null, where: "ลิงก์ในโพสต์" },
];
const food: OverlayProduct[] = [{ name: "น้ำพริกเผาสูตรแม่", price: null, facts: ["อร่อยเผ็ดกลาง"], image: null, where: "ลิงก์ในโพสต์" }];

describe("live overlay looks", () => {
  it("reads what the products are", () => {
    expect(productCategory(beauty).id).toBe("beauty");
    expect(productCategory(food).id).toBe("food");
    expect(productCategory([]).id).toBe("general");
  });

  it("picks a tone that suits the products and never repeats the last look", () => {
    for (let i = 0; i < 50; i++) {
      const look = chooseLook(beauty, { tone: "auto", layout: "random", last: "sweet/classic" });
      expect(["sweet", "lux", "fresh"]).toContain(look.tone.id);
      expect(`${look.tone.id}/${look.layout}`).not.toBe("sweet/classic");
    }
    // Without product photos there is no side card.
    for (let i = 0; i < 50; i++) expect(chooseLook(food, { tone: "auto", layout: "random", last: "" }).layout).not.toBe("side-card");
    // The owner's own choice wins.
    expect(chooseLook(food, { tone: "lux", layout: "minimal", last: "" })).toMatchObject({ tone: { id: "lux" }, layout: "minimal" });
  });

  it("builds every tone and layout as a valid set, keeping the owner's own pieces", () => {
    const mine = makeItem("text", { text: "ของฉัน" });
    for (const t of TONES) for (const l of LAYOUTS) {
      const set = autoPromoSet({ ...emptyConfig(), items: [mine] }, beauty, Math.random, { tone: t.id, layout: l.id }, new Date("2026-11-22T10:00:00Z"));
      expect(configSchema.safeParse(set).success).toBe(true);
      expect(set.items[0]).toBe(mine);
      expect(set.items.filter(i => i.auto).length).toBeGreaterThan(2);
      expect(set.look).toMatchObject({ tone: t.id, layout: l.id, last: `${t.id}/${l.id}`, at: "2026-11-22T10:00:00.000Z" });
      expect(lookLabel(set.look.last)).toContain(t.label);
      // A new set replaces only the earlier auto pieces.
      const again = autoPromoSet(set, beauty, Math.random, { tone: t.id, layout: l.id });
      expect(again.items.filter(i => !i.auto)).toEqual([mine]);
    }
  });

  it("keeps every piece clear of TikTok's own menus", () => {
    for (const t of TONES) for (const l of LAYOUTS) for (const list of [beauty, food]) {
      const set = autoPromoSet(emptyConfig(), list, Math.random, { tone: t.id, layout: l.id });
      for (const i of set.items) if (!i.randomPos) expect(overTikTokUi(i), `${t.id}/${l.id} ${i.kind}`).toBe(false);
      expect(needsArranging(set)).toBe(false);
    }
    const face = emptyConfig().faceZone;
    for (let n = 0; n < 300; n++) expect(overTikTokUi({ ...pickSpot(0.14, 0.08, face), w: 0.14, h: 0.08 })).toBe(false);
  });

  it("re-arranges an old automatic set that sits under TikTok's menus, unless arranged by hand", () => {
    const old = { ...emptyConfig(), items: [makeItem("promo", { template: "banner", y: 0.77, auto: true })], look: { ...emptyConfig().look, last: "hot/classic" } };
    expect(needsArranging(old)).toBe(true);
    expect(needsArranging({ ...old, look: { ...old.look, autoNew: false } })).toBe(false);
    expect(needsArranging({ ...old, items: [{ ...old.items[0], auto: undefined }] })).toBe(false);
  });

  it("never invents a price tag when no product has a price", () => {
    for (const l of LAYOUTS) {
      const set = autoPromoSet(emptyConfig(), food, Math.random, { layout: l.id });
      expect(set.items.some(i => i.kind === "promo" && i.template === "price-tag")).toBe(false);
    }
  });

  it("makes a new look when OBS opens only if asked, at most once per gap", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    const base = emptyConfig();
    // Never arranged: arranged automatically right away.
    expect(needsFirstSet(base)).toBe(true);
    expect(wantsNewLook(base, now)).toBe(true);
    const arranged = autoPromoSet(base, food, Math.random, {}, now);
    expect(needsFirstSet(arranged)).toBe(false);
    expect(needsFirstSet({ ...arranged, items: [] })).toBe(false);
    // Arranged by hand (auto-new off): kept.
    expect(wantsNewLook({ ...arranged, look: { ...arranged.look, autoNew: false, at: "" } }, now)).toBe(false);
    const on = { ...base, items: [makeItem("text", {})], look: { ...base.look, autoNew: true } };
    expect(wantsNewLook(on, now)).toBe(true);
    expect(wantsNewLook({ ...on, look: { ...on.look, at: new Date(now.getTime() - 60_000).toISOString() } }, now)).toBe(false);
    expect(wantsNewLook({ ...on, look: { ...on.look, at: new Date(now.getTime() - NEW_LOOK_GAP_MS).toISOString() } }, now)).toBe(true);
  });

  it("reads old saved overlays without a look", () => {
    expect(configSchema.parse({ items: [] }).look).toEqual({ tone: "auto", layout: "random", last: "", at: "", autoNew: true });
  });
});
