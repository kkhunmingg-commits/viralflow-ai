import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";
import manifest from "./manifest";

// SHA-256 of the 1024px "VF" icon submitted in TikTok Developer Portal > Basic Info.
const TIKTOK_ICON_SHA256 = "c50a95595c7ca1e2591cbd2b32ae6b7f7424c0b7ce9ad8b8b82c8001ef625cc9";
const pub = join(process.cwd(), "public");

describe("app icon matches the TikTok app icon", () => {
  it("keeps the exact submitted artwork", () => {
    const sha = createHash("sha256").update(readFileSync(join(pub, "icons/vf-icon-1024.png"))).digest("hex");
    expect(sha).toBe(TIKTOK_ICON_SHA256);
  });

  it("only ships VF icon files", () => {
    expect(readdirSync(join(pub, "icons")).every((name) => name.startsWith("vf-"))).toBe(true);
  });

  it("points favicon, apple icon and manifest at the VF files", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const urls = JSON.stringify(manifest().icons) + layout;
    for (const url of urls.match(/"\/[^"]+\.(png|ico)"/g) ?? []) expect(url).toMatch(/^"\/(favicon\.ico|icons\/vf-)/);
    expect(urls).toContain("/favicon.ico");
    expect(urls).toContain("/icons/vf-apple-touch-icon.png");
  });

  it("shows the VF icon as the homepage logo", () => {
    expect(renderToStaticMarkup(<Home />)).toContain('src="/icons/vf-brand-256.png"');
  });
});
