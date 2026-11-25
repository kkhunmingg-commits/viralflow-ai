import test from "node:test";
import assert from "node:assert/strict";
import { extensionFiles } from "./extension.mjs";

const files = extensionFiles("https://viralflow.example/some/path");
const manifest = JSON.parse(files["manifest.json"]);

test("runs on the ViralFlow pages, Shopee/Lazada, and the three posting sites only", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://viralflow.example/product-clips*"]);
  assert.ok(manifest.content_scripts[1].matches.includes("https://*.shopee.co.th/*"));
  assert.ok(manifest.content_scripts[1].matches.includes("https://*.lazada.co.th/*"));
  assert.deepEqual(manifest.content_scripts[2].matches, ["https://www.facebook.com/*", "https://web.facebook.com/*", "https://www.instagram.com/*", "https://studio.youtube.com/*"]);
  assert.deepEqual(manifest.content_scripts[3].matches, ["https://shop.tiktok.com/*"]);
  assert.ok(manifest.host_permissions.every(h => /^https:\/\/(viralflow\.example|(\*\.)?(shopee|lazada)\.[a-z.]+|(www|web)\.facebook\.com|www\.instagram\.com|studio\.youtube\.com|shop\.tiktok\.com)\/\*$/.test(h)));
});

test("ships scripts that parse and carry the ViralFlow origin", () => {
  for (const name of ["background.js", "viralflow.js", "shop.js", "social.js", "tiktok.js"]) assert.doesNotThrow(() => new Function(files[name]));
  assert.ok(files["background.js"].includes('"portal":"https://viralflow.example"'));
  assert.ok(files["background.js"].includes("/api/social-post/browser"));
  assert.ok(files["viralflow.js"].includes("/api/product-capture/auto"));
  assert.doesNotMatch(files["shop.js"], /document\.cookie|localStorage/);
  assert.doesNotMatch(files["tiktok.js"], /document\.cookie|localStorage|password/i);
  assert.ok(files["viralflow.js"].includes("/api/tiktok-shop/import"));
  // The posting script only acts in a tab the extension opened for a post, and never touches sign-ins.
  assert.match(files["social.js"], /vf-task/);
  assert.doesNotMatch(files["social.js"], /document\.cookie|localStorage|password/i);
});
