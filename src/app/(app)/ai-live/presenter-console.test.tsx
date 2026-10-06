import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("client-only", () => ({}));

import { LivePresenterConsole } from "./presenter-console";

describe("customer AI LIVE screen", () => {
  it("starts with setup closed, reference preview honest, and broadcasting disabled", () => {
    const html = renderToStaticMarkup(<LivePresenterConsole accounts={[]} products={[]} />);
    const settingsTag = html.match(/<details\b[^>]*>/)?.[0];
    expect(settingsTag).toBeDefined();
    expect(settingsTag).not.toMatch(/\bopen\b/);
    expect(html).toContain("ตั้งค่าการ LIVE");
    expect(html).toContain("ภาพอ้างอิง · ยังไม่ใช่ภาพสด");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>เริ่ม LIVE<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>หยุด LIVE<\/button>/);
    expect(html).toContain("ยังไม่มีข้อมูล");
    expect(html).toContain("เข้าสู่ระบบแล้ว");
    expect(html).toContain("ตรวจสอบเครื่อง");
    expect(html).toContain("เตรียมส่วนประกอบ");
    expect(html).toContain("รอความพร้อม");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>เตรียมเครื่อง<\/button>/);
    expect(html).not.toContain("https://www.nvidia.com/Download/index.aspx");
    expect(html).not.toContain("กำลัง LIVE");
    expect(html).not.toMatch(/OBS|TikTok Studio|Virtual Camera|Virtual Audio|RTMPS?|FFmpeg|MuseTalk|CUDA|NVENC|8766/);
  });
});
