import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home, { metadata as homeMetadata } from "./page";
import Privacy, { metadata as privacyMetadata } from "./(legal)/privacy/page";
import Terms, { metadata as termsMetadata } from "./(legal)/terms/page";
import Support from "./(legal)/support/page";
import LegalLayout from "./(legal)/layout";

describe("TikTok review public website", () => {
  it.each([
    ["homepage", Home, homeMetadata],
    ["privacy", Privacy, privacyMetadata],
    ["terms", Terms, termsMetadata],
  ] as const)("identifies the exact registered app and real contact in %s", (_name, Page, metadata) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toMatch(/<h1[^>]*>Viral Flow AI/);
    expect(metadata.title).toEqual(expect.objectContaining({ absolute: expect.stringContaining("Viral Flow AI") }));
    expect(html).toContain('href="mailto:kkhunmingg@gmail.com"');
    expect(html).not.toContain("ViralFlow AI");
  });

  it("makes legal links visible in both homepage navigation areas and provides product instructions", () => {
    const html = renderToStaticMarkup(<Home />);
    for (const area of [html.match(/<header[\s\S]*?<\/header>/)?.[0], html.match(/<footer[\s\S]*?<\/footer>/)?.[0]]) {
      expect(area).toContain('href="/privacy"');
      expect(area).toContain('href="/terms"');
      expect(area).toContain('href="/login"');
    }
    expect(html).toContain('href="/product-guide"');
    expect(html).toContain('href="/review-guide"');
    expect(html).toContain("ยังไม่เปิดขายสมาชิก");
    expect(html).toContain("ไม่ใช่ส่วนของ Login Kit / Content Posting");
  });

  it("shows the same VF artwork in homepage and public document headers", () => {
    const home = renderToStaticMarkup(<Home />);
    const legal = renderToStaticMarkup(<LegalLayout><Privacy /></LegalLayout>);
    for (const html of [home, legal]) {
      const header = html.match(/<header[\s\S]*?<\/header>/)?.[0];
      expect(header).toContain('src="/brand/viral-flow-ai-vf.png?v=c50a95595c7c"');
      expect(header).toContain('alt="Viral Flow AI"');
      expect(header).not.toMatch(/>V(?:<span|<\/span>)/);
    }
  });

  it("provides a real deletion-request contact without requesting credentials", () => {
    const html = renderToStaticMarkup(<Support />);
    expect(html).toContain('href="mailto:kkhunmingg@gmail.com"');
    expect(html).toContain("ขอลบข้อมูล");
    expect(html).toContain("ไม่ต้องส่งรหัสผ่านหรือโทเคน");
  });
});
