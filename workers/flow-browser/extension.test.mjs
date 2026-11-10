import test from "node:test";
import assert from "node:assert/strict";
import { extensionFiles } from "./extension.mjs";

const files = extensionFiles("https://viralflow.example/some/path");
const manifest = JSON.parse(files["manifest.json"]);

test("runs on the ViralFlow fetch page and on Shopee/Lazada pages only", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://viralflow.example/product-clips*"]);
  assert.ok(manifest.content_scripts[1].matches.includes("https://*.shopee.co.th/*"));
  assert.ok(manifest.content_scripts[1].matches.includes("https://*.lazada.co.th/*"));
  assert.ok(manifest.host_permissions.every(h => /^https:\/\/(viralflow\.example|(\*\.)?(shopee|lazada)\.[a-z.]+)\/\*$/.test(h)));
});

test("ships scripts that parse and carry the ViralFlow origin", () => {
  for (const name of ["background.js", "viralflow.js", "shop.js"]) assert.doesNotThrow(() => new Function(files[name]));
  assert.ok(files["background.js"].includes('("https://viralflow.example")'));
  assert.ok(files["viralflow.js"].includes("/api/product-capture/auto"));
  assert.doesNotMatch(files["shop.js"], /document\.cookie|localStorage/);
});
