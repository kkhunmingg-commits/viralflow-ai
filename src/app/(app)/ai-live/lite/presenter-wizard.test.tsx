import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("client-only", () => ({}));
import { PresenterPreparationStatus, PresenterWizard } from "./presenter-wizard";

describe("customer Presenter Studio preparation", () => {
  it("requires the actual reference and rights before continuing the six-step wizard", () => {
    const html = renderToStaticMarkup(<PresenterWizard presenter="new" accounts={[]} bridge={{ current: null }} authorized busy={false}
      onSave={async () => undefined} onCancel={() => undefined} />);
    expect(html).toContain("ขั้นที่ 1 จาก 6");
    expect(html.match(/<li /g)).toHaveLength(6);
    expect(html).toContain("ได้รับอนุญาตจากเจ้าของภาพ");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>ถัดไป →<\/button>/);
    expect(html).toContain("รอเครื่องที่รองรับ");
    expect(html).not.toMatch(/CUDA|MuseTalk|NVENC|FFmpeg|RTMPS?|stream.?key|open_id/);
  });
  it("never labels saved configuration as validated real-time speech or live readiness", () => {
    const html = renderToStaticMarkup(<PresenterPreparationStatus />);
    expect(html).toContain("พร้อมบันทึกการตั้งค่า");
    expect(html).toContain("รอการประมวลผลบนเครื่องที่รองรับ");
    expect(html).toContain("ยังไม่ยืนยันความพร้อม LIVE");
    expect(html).not.toContain("LIVE พร้อมใช้งาน");
  });
});
