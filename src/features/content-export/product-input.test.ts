import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ contentExportConfig: () => ({ enabled: false, allowedOwners: [] }) }));
import { assertProductImage, productInputSchema, saveContentProduct } from "./product-input";
import type { SupabaseClient } from "@supabase/supabase-js";
describe("actual product intake", () => {
  it("requires real name/category/price and owner rights affirmation", () => {
    expect(productInputSchema.safeParse({ title: "แฟ้มเอกสาร", category: "office", price: 50, rights: "on" }).success).toBe(true);
    expect(productInputSchema.safeParse({ title: "", category: "office", price: 50, rights: "on" }).success).toBe(false);
    expect(productInputSchema.safeParse({ title: "แฟ้ม", category: "office", price: 50 }).success).toBe(false);
  });
  it("checks signatures and rejects spoofed or oversized photos", () => {
    expect(() => assertProductImage(new Uint8Array(100), "image/jpeg")).toThrow();
    const png = new Uint8Array(100); png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(() => assertProductImage(png, "image/png")).not.toThrow();
    expect(() => assertProductImage(png, "image/jpeg")).toThrow();
    expect(() => assertProductImage(new Uint8Array(750_001), "image/png")).toThrow();
  });
  it("cannot upload or write products without an authorized account", async () => {
    const from = vi.fn(); await expect(saveContentProduct({ from } as unknown as SupabaseClient, "other-owner", new FormData())).rejects.toThrow("not_configured");
    expect(from).not.toHaveBeenCalled();
  });
});
