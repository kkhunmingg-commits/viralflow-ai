// Builds the ViralFlow Chrome extension for the Chrome Web Store: node scripts/build-chrome-extension.mjs <out-dir> [origin]
// The store copy is fixed to the production origin; the worker writes its own copy for its FLOW_PORTAL_URL.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extensionFiles } from "../workers/flow-browser/extension.mjs";

const [out = "dist/chrome-extension", origin = "https://viralflow-ai-blond.vercel.app"] = process.argv.slice(2);
const dir = resolve(out);
await mkdir(dir, { recursive: true });
for (const [name, text] of Object.entries(extensionFiles(origin, { icon: true }))) await writeFile(join(dir, name), text, "utf8");
await copyFile(resolve("public/icons/vf-icon-128.png"), join(dir, "icon-128.png"));
console.log(dir);
