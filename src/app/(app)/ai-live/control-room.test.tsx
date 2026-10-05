import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("client-only", () => ({}));
import { AiLiveControlRoom } from "./control-room";

const accounts = [{ id: "account-a", label: "@Alice", connected: true }, { id: "account-b", label: "@Bob", connected: true }];
describe("consumer multi-account AI LIVE room", () => {
  it("shows each real account without inventing sales or enabling unavailable live actions", () => {
    const html = renderToStaticMarkup(<AiLiveControlRoom accounts={accounts} products={[]} />);
    expect(html).toContain("@Alice"); expect(html).toContain("@Bob");
    expect(html.match(/class="live-account-card/g)).toHaveLength(2);
    expect(html).toContain("ยังไม่มีข้อมูล");
    expect(html).not.toMatch(/฿0|\$0|LIVE สูงสุด [1-9]/);
    expect(html).toContain("คน LIVE"); expect(html).toContain("เสียงสำรอง");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>START LIVE<\/button>/);
    expect(html).not.toMatch(/FFmpeg|MuseTalk|Ditto|CUDA|NVENC|RTMPS?|8766|stream.?key|open_id/);
  });
  it("renders measured sales only from supplied observations", () => {
    const observations = accounts.map((account) => ({ accountId: account.id, liveSeconds: 1800,
      sales: 250, units: 2, salesPerHour: 500, viewers: 9, comments: 3,
      currentProductName: "สินค้าจริง", currentResponse: null, latestComment: null }));
    const html = renderToStaticMarkup(<AiLiveControlRoom accounts={accounts} products={[]} observations={observations} />);
    expect(html).toContain("สินค้าจริง");
    expect(html).toContain("500");
    expect(html).toContain("4 ชิ้น");
    expect(html).toContain("30 นาที");
    // Receiving metrics alone must never switch the session into LIVE.
    expect(html).not.toContain("class=\"live-soft-badge active\"");
  });
  it("gives a disconnected room an explicit reconnect path without selecting another account", () => {
    const html = renderToStaticMarkup(<AiLiveControlRoom accounts={[{ id: "disconnected-a", label: "@Disconnected", connected: false }]} products={[]} />);
    expect(html).toContain("ต้องเชื่อม TikTok บัญชีนี้ใหม่");
    expect(html).toContain('href="/accounts/disconnected-a"');
    expect(html).toContain('<option value="disconnected-a" disabled="" selected="">บัญชีนี้ต้องเชื่อม TikTok ใหม่</option>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>START LIVE<\/button>/);
    expect(html).toContain("ยังไม่มีข้อมูลความคิดเห็น");
    expect(html).toContain("ยังไม่มีข้อมูลการพูด");
  });
});
