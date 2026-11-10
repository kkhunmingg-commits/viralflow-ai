// Builds the ViralFlow Chrome extension, fixed to the production origin (the worker writes its own copy for its FLOW_PORTAL_URL).
//   node scripts/build-chrome-extension.mjs <out-dir> [origin]         a folder (Chrome Web Store upload, or Load unpacked)
//   node scripts/build-chrome-extension.mjs --zip <file.zip> [origin]  the free download on /product-clips (run by `build`)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { crc32 } from "node:zlib";
import { extensionFiles } from "../workers/flow-browser/extension.mjs";

const args = process.argv.slice(2), zip = args[0] === "--zip";
const [out = zip ? "public/downloads/viralflow-chrome-extension.zip" : "dist/chrome-extension", origin = "https://viralflow-ai-blond.vercel.app"] = zip ? args.slice(1) : args;
const files = Object.entries(extensionFiles(origin, { icon: true })).map(([name, text]) => [name, Buffer.from(text, "utf8")]);
files.push(["icon-128.png", await readFile(resolve("public/icons/vf-icon-128.png"))]);

/** An uncompressed .zip whose entries sit in one folder, so unzipping gives the folder Chrome's Load unpacked asks for. */
function zipFolder(folder, entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const file = Buffer.from(`${folder}/${name}`, "utf8"), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(file.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 12); head.writeUInt16LE(0x21, 14); head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(file.length, 28); head.writeUInt32LE(offset, 42);
    parts.push(local, file, data); central.push(head, file);
    offset += local.length + file.length + data.length;
  }
  const size = central.reduce((sum, b) => sum + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

const target = resolve(out);
if (zip) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, zipFolder("ViralFlow-extension", files));
} else {
  await mkdir(target, { recursive: true });
  for (const [name, data] of files) await writeFile(join(target, name), data);
}
console.log(target);
