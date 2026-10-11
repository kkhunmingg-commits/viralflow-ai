import { describe, expect, it } from "vitest";
import { contentPrompt, contentRequestSchema, effectiveContentMode, ideaSchema } from "./contracts";
const request = { requestKey: "10000000-0000-4000-8000-000000000001", accountId: "10000000-0000-4000-8000-000000000002", mode: "AUTO" as const, topic: "", budgetUsd: .5, consent: true as const };
describe("customer content modes", () => {
  it("supports Growth without a product and defaults AUTO to Growth for a new account", () => {
    expect(contentRequestSchema.parse(request).topic).toBe("");
    expect(effectiveContentMode(request, { ecommerce_permission: false, cart_enabled: false }, false)).toBe("GROWTH");
    expect(effectiveContentMode({ ...request, mode: "GROWTH" }, { ecommerce_permission: true, cart_enabled: true }, true)).toBe("GROWTH");
  });
  it("AUTO can use an existing eligible product and explicit Affiliate stays Affiliate", () => {
    expect(effectiveContentMode(request, { ecommerce_permission: true, cart_enabled: true }, true)).toBe("AFFILIATE");
    expect(effectiveContentMode({ ...request, mode: "AFFILIATE" }, { ecommerce_permission: false, cart_enabled: false }, true)).toBe("AFFILIATE");
  });
  it("requires an explicit paid consent and clamps the permitted request budget", () => {
    for (const budgetUsd of [0, .1, 1.01, Infinity]) expect(contentRequestSchema.safeParse({ ...request, budgetUsd }).success).toBe(false);
    expect(contentRequestSchema.safeParse({ ...request, consent: false }).success).toBe(false);
  });
  it("gives the real creative brain different purposes, context and repetition history", () => {
    const context = { topic: "", interests: ["ชีวิตประจำวัน"], product: null, history: ["หัวข้อเก่า"] };
    const growth = contentPrompt({ ...context, mode: "GROWTH" });
    expect(growth).toContain("Do not require a product"); expect(growth).toContain("หัวข้อเก่า");
    expect(contentPrompt({ ...context, mode: "AFFILIATE", product: { title: "สินค้า" } })).toContain("No medical");
  });
  it("does not accept missing ideas or unlimited scripts", () => {
    expect(ideaSchema.safeParse({ title: "dummy" }).success).toBe(false);
  });
});
