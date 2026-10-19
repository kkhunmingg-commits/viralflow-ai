import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("client-only", () => ({}));

import type { LitePresenterCatalog } from "@/features/ai-live/local-client";
import { LitePresenterPicker } from "./lite-presenter-picker";

const catalog: LitePresenterCatalog = {
  presenters: [
    { folder: "nara", name: "นารา", technicalTestOnly: false, defaultVoice: "th-TH-PremwadeeNeural", frames: 120 },
    { folder: "krit", name: "กฤต", technicalTestOnly: false, defaultVoice: "th-TH-NiwatNeural", frames: 120 },
  ],
  voices: [{ id: "th-TH-PremwadeeNeural", label: "เปรมวดี (หญิง)" }, { id: "th-TH-AcharaNeural", label: "อัจฉรา (หญิง)" },
    { id: "th-TH-NiwatNeural", label: "นิวัฒน์ (ชาย)" }],
  speechKey: { configured: true, region: "southeastasia" },
  freeTier: { monthlyCapCharacters: 450000, usedThisMonth: 1200 },
};
const render = (changes: Partial<Parameters<typeof LitePresenterPicker>[0]> = {}) => renderToStaticMarkup(
  <LitePresenterPicker catalog={catalog} selected="krit" voice="th-TH-NiwatNeural" thumbnails={{ nara: "blob:thumb-nara" }}
    onSelect={() => undefined} onVoiceChange={() => undefined} {...changes} />);

describe("LIVE Lite Auto presenter picker", () => {
  it("shows installed AI presenter cards with thumbnails and the synthetic label", () => {
    const html = render();
    expect(html).toContain("นารา");
    expect(html).toContain("กฤต");
    expect(html.match(/พิธีกร AI สังเคราะห์/g)).toHaveLength(2);
    expect(html).toContain('src="blob:thumb-nara"');
    expect(html).toMatch(/<input[^>]*value="krit"[^>]*checked=""|<input[^>]*checked=""[^>]*value="krit"/);
    expect(html).not.toContain('type="file"');
  });
  it("offers only the Thai voices and selects the given voice", () => {
    const html = render();
    expect(html).toContain("เสียง");
    expect(html.match(/<option /g)).toHaveLength(3);
    expect(html).toMatch(/<option value="th-TH-NiwatNeural" selected="">/);
  });
  it("shows the configured key status with this month's free allowance and never a key", () => {
    const html = render();
    expect(html).toContain("Azure Speech (Free F0): ตั้งค่าแล้ว · ใช้ไป 1,200 / 450,000 ตัวอักษรเดือนนี้");
    expect(html).not.toMatch(/lite_speech_key\.py/);
  });
  it("explains the device-side Free F0 setup when no key is configured", () => {
    const html = render({ catalog: { ...catalog, speechKey: { configured: false, region: null }, freeTier: null } });
    expect(html).toContain("Azure Speech (Free F0): ยังไม่ได้ตั้งค่า");
    expect(html).toContain("Free F0");
    expect(html).toContain("python lite_speech_key.py set --region &lt;region&gt;");
    expect(html).toContain("docs/AI_LIVE_LITE_AUTO.md");
    expect(html).not.toMatch(/<input[^>]*(password|key)/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
  it("handles an unconnected device and a device without packs", () => {
    expect(render({ catalog: null })).toContain("เชื่อมต่อและอนุญาตเครื่องเพื่อดูพิธีกร AI");
    const empty = render({ catalog: { ...catalog, presenters: [] }, selected: null });
    expect(empty).toContain("ยังไม่มีพิธีกร AI บนเครื่องนี้");
    expect(empty).not.toContain("<select");
  });
});
