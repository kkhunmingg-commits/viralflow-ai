/** The existing EXPORT ZIP format, shared with the browser's local-only workflow. */
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
type EntryName = "video.mp4" | "caption.txt" | "package.json";
const encoder = new TextEncoder();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function join(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { output.set(part, at); at += part.length; }
  return output;
}
export function createPostPackageZip(entries: readonly { name: EntryName; bytes: Uint8Array }[]) {
  const names = new Set(entries.map(entry => entry.name));
  if (entries.length !== 3 || names.size !== 3 || !["video.mp4", "caption.txt", "package.json"].every(name => names.has(name as EntryName))
    || entries.reduce((sum, entry) => sum + entry.bytes.length, 0) > MAX_EXPORT_BYTES + 32_768) throw new Error("package_invalid");
  const local: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), checksum = crc32(entry.bytes);
    const header = new Uint8Array(30), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint32(14, checksum, true); view.setUint32(18, entry.bytes.length, true); view.setUint32(22, entry.bytes.length, true);
    view.setUint16(26, name.length, true);
    local.push(header, name, entry.bytes);
    const central = new Uint8Array(46), centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true); centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.bytes.length, true); centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, name.length, true); centralView.setUint32(42, offset, true);
    directory.push(central, name); offset += header.length + name.length + entry.bytes.length;
  }
  const centralBytes = join(directory), end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.length, true); endView.setUint32(16, offset, true);
  return join([...local, centralBytes, end]);
}
export function assertMp4(bytes: Uint8Array, mimeType: string) {
  if (bytes.length < 1000 || bytes.length > MAX_EXPORT_BYTES || mimeType !== "video/mp4"
    || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") throw new Error("invalid_mp4");
}
export function postCaption(caption: string, hashtags: readonly string[]) {
  const cleanCaption = caption.trim();
  const cleanTags = [...new Set(hashtags.flatMap(tag => tag.split(/\s+/)).filter(Boolean)
    .map(tag => "#" + tag.replace(/^#+/, "")))].filter(tag => tag !== "#").slice(0, 30);
  const text = [cleanCaption, cleanTags.join(" ")].filter(Boolean).join("\n\n");
  if (text.length > 2200) throw new Error("caption_too_long");
  return { caption: cleanCaption, hashtags: cleanTags, text };
}
export function localPostPackage(input: { bytes: Uint8Array; mimeType: string; caption: string; hashtags: string[];
  reviewed: boolean; rightsConfirmed: boolean; accountName: string; aiGenerated: boolean }) {
  if (!input.reviewed || !input.rightsConfirmed) throw new Error("review_required");
  assertMp4(input.bytes, input.mimeType);
  const copy = postCaption(input.caption, input.hashtags);
  const manifest = { video: "video.mp4", caption: copy.caption, hashtags: copy.hashtags,
    account: input.accountName.slice(0, 150), publishing: "โพสต์ด้วยตนเอง",
    source: "USER_LOCAL_FILE", aiGenerated: input.aiGenerated, automatedCompliance: "NOT_CHECKED",
    userReviewed: true, instructions: "ตรวจภาพ เสียง คำกล่าวอ้าง และระบุ AI-generated ใน TikTok หากเป็นคอนเทนต์ AI ก่อนโพสต์" };
  return createPostPackageZip([{ name: "video.mp4", bytes: input.bytes },
    { name: "caption.txt", bytes: encoder.encode(copy.text) },
    { name: "package.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2)) }]);
}
