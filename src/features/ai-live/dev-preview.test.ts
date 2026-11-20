import { describe, expect, it } from "vitest";
import { readGeneratedFrame } from "./dev-preview";

function jpeg(count: string, bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9)) {
  return new Response(bytes, { headers: { "Content-Type": "image/jpeg", "X-Frame-Count": count } });
}
describe("DEV generated preview transport validation", () => {
  it("waits without producing a placeholder frame", async () => {
    expect(await readGeneratedFrame(new Response(null, { status: 204 }), 0)).toBeNull();
  });
  it("returns newly delivered JPEG bytes with the worker frame counter", async () => {
    const frame = await readGeneratedFrame(jpeg("12"), 11);
    expect(frame?.count).toBe(12);
    expect(frame?.blob.type).toBe("image/jpeg");
    expect(frame?.blob.size).toBe(6);
    expect(await readGeneratedFrame(jpeg("12"), 12)).toBeNull();
  });
  it("rejects wrong media types, invalid bytes, and uncounted frame responses", async () => {
    await expect(readGeneratedFrame(new Response("video loop", { headers: { "Content-Type": "video/mp4" } }), 0)).rejects.toThrow("generated JPEG");
    await expect(readGeneratedFrame(jpeg("1", Uint8Array.of(1, 2, 3)), 0)).rejects.toThrow("invalid JPEG");
    await expect(readGeneratedFrame(jpeg("0"), 0)).rejects.toThrow("real frame counter");
    await expect(readGeneratedFrame(new Response(null, { status: 503 }), 0)).rejects.toThrow("503");
  });
});
