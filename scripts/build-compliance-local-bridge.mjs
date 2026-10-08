import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// Reuse the pinned compiler transitively shipped with our existing tsx tool; no network installation.
// pnpm does not expose a transitive package at the repository root. Use the installed
// tsx package's private dependency graph when the root layout cannot resolve it.
let require = createRequire(resolve("node_modules/tsx/package.json"));
let compiler;
try { compiler = require("esbuild"); }
catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  const tsx = JSON.parse(await readFile("node_modules/tsx/package.json", "utf8"));
  require = createRequire(resolve(`node_modules/.pnpm/tsx@${tsx.version}/node_modules/tsx/package.json`));
  compiler = require("esbuild");
}
const { build } = compiler;
await build({ entryPoints: ["scripts/compliance-local-bridge.ts"],
  outfile: ".ai-live-dev/compliance/compliance-local-bridge.cjs", bundle: true,
  platform: "node", target: "node24", format: "cjs", logLevel: "warning", sourcemap: false });
