import { describe, expect, it, vi } from "vitest";
import { inspectPresenterReference } from "./presenter-reference-check";

describe("presenter image inspection", () => {
  it("reports only dimensions decoded from the real image", async () => {
    const file = new File([new Uint8Array([1, 2])], "reference.png", { type: "image/png" });
    const result = await inspectPresenterReference(file, async () => ({ width: 1080, height: 1440 }));
    expect(result).toEqual({ width: 1080, height: 1440, recommendation: expect.any(String) });
    expect(Object.keys(result)).toEqual(["width", "height", "recommendation"]);
  });
  it("does not mark a corrupt file or unsupported bytes as checked", async () => {
    const file = new File(["invalid"], "reference.jpg", { type: "image/jpeg" });
    await expect(inspectPresenterReference(file, async () => { throw new Error("decode failed"); })).rejects.toThrow();
    const decode = vi.fn();
    await expect(inspectPresenterReference(new File(["video"], "reference.mp4", { type: "video/mp4" }), decode)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
  it("rejects invalid dimensions and warns truthfully about small references", async () => {
    const file = new File(["image"], "reference.png", { type: "image/png" });
    await expect(inspectPresenterReference(file, async () => ({ width: 0, height: 1024 }))).rejects.toThrow();
    await expect(inspectPresenterReference(file, async () => ({ width: 8192, height: 8192 }))).rejects.toThrow();
    expect((await inspectPresenterReference(file, async () => ({ width: 320, height: 480 }))).recommendation).toContain("ภาพค่อนข้างเล็ก");
  });
});
