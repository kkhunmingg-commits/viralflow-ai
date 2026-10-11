import { describe, expect, it } from "vitest";
import { assertMp4, createPostPackageZip, localPostPackage, MAX_EXPORT_BYTES, postCaption } from "./package";
const media = () => { const bytes = new Uint8Array(2000); bytes.set([102,116,121,112], 4); return bytes; };
function unpack(bytes: Uint8Array) {
  const entries = new Map<string, Uint8Array>(); let at = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true), length = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true), start = at + 30;
    entries.set(decoder.decode(bytes.slice(start, start + length)), bytes.slice(start + length + extra, start + length + extra + size));
    at = start + length + extra + size;
  }
  expect(view.getUint32(at, true)).toBe(0x02014b50);
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(bytes.length - 12, true)).toBe(3);
  return entries;
}
const input = () => ({ bytes: media(), mimeType: "video/mp4", caption: "คำบรรยาย", hashtags: ["สินค้า", "#รีวิว", "#รีวิว"],
  rightsConfirmed: true, reviewed: true, accountName: "test account", aiGenerated: false });
describe("manual local export", () => {
  it("preserves actual video bytes and Thai captions in the existing three-file ZIP format", () => {
    const data = unpack(localPostPackage(input()));
    expect(data.get("video.mp4")).toEqual(media());
    expect(new TextDecoder().decode(data.get("caption.txt"))).toBe("คำบรรยาย\n\n#สินค้า #รีวิว");
    const manifest = JSON.parse(new TextDecoder().decode(data.get("package.json")));
    expect(manifest).toMatchObject({ aiGenerated: false, source: "USER_LOCAL_FILE", automatedCompliance: "NOT_CHECKED", userReviewed: true });
    expect(manifest).not.toHaveProperty("published");
  });
  it.each([{ rightsConfirmed: false }, { reviewed: false }])("requires explicit rights and review: %s", patch => {
    expect(() => localPostPackage({ ...input(), ...patch })).toThrow("review_required");
  });
  it.each(["text/html", "application/octet-stream"])("rejects other media MIME %s", mime => {
    expect(() => assertMp4(media(), mime)).toThrow("invalid_mp4");
  });
  it("rejects a false MP4 and oversized media", () => {
    expect(() => assertMp4(new Uint8Array(2000), "video/mp4")).toThrow();
    expect(() => assertMp4(new Uint8Array(MAX_EXPORT_BYTES + 1), "video/mp4")).toThrow();
  });
  it("enforces caption limit including hashtags", () => {
    expect(() => postCaption("x".repeat(2198), ["tag"])).toThrow();
    expect(postCaption("", ["", "##", "tag", "#tag"]).text).toBe("#tag");
  });
  it("accepts empty caption and includes only selected AI disclosure", () => {
    const data = unpack(localPostPackage({ ...input(), caption: "", hashtags: [], aiGenerated: true }));
    expect(data.get("caption.txt")).toHaveLength(0);
    expect(JSON.parse(new TextDecoder().decode(data.get("package.json"))).aiGenerated).toBe(true);
  });
  it("rejects missing or duplicate ZIP entries even at runtime", () => {
    expect(() => createPostPackageZip([])).toThrow();
    expect(() => createPostPackageZip([{ name: "video.mp4", bytes: media() }, { name: "video.mp4", bytes: media() }, { name: "caption.txt", bytes: media() }])).toThrow();
  });
});
