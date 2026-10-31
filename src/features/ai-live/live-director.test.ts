import { describe, expect, it } from "vitest";
import { commentIntent, hostReply, liveRunOfShow, selectLiveLineup, type LiveCandidate } from "./live-director";

const now = new Date("2026-10-28T08:00:00Z");
const product = (id: string, orders: number, extra: Partial<LiveCandidate> = {}): LiveCandidate => ({
  productId: id, title: `สินค้า ${id}`, price: 199, videoOrders: orders, videoGmv: orders * 199, settledCommission: orders * 20,
  lastOrderAt: "2026-10-28T06:00:00Z", facts: ["กันน้ำระดับ IPX4", "จัดส่งภายใน 2 วัน"], ...extra,
});

describe("live lineup", () => {
  it("puts the 4 best real sellers live and waits when fewer than 3 have real orders", () => {
    const pool = [product("a", 40), product("b", 30), product("c", 20), product("d", 10), product("e", 5)];
    expect(selectLiveLineup(pool, now)).toMatchObject({ productIds: ["a", "b", "c", "d"], reason: "INITIAL" });
    expect(selectLiveLineup([product("a", 40), product("b", 0), product("c", 3, { facts: [] })], now).reason).toBe("WAIT_FOR_DATA");
  });
  it("keeps the lineup for 4 hours, then swaps in a clearly better new seller", () => {
    const first = selectLiveLineup([product("a", 40), product("b", 30), product("c", 20), product("d", 10)], now);
    const pool = [product("a", 40), product("b", 30), product("c", 20), product("d", 10), product("new", 60)];
    expect(selectLiveLineup(pool, new Date(now.getTime() + 3 * 3600000), first).reason).toBe("KEPT");
    const later = selectLiveLineup(pool, new Date(now.getTime() + 4 * 3600000), first);
    expect(later.reason).toBe("REFRESHED");
    expect(later.productIds).toEqual(["new", "a", "b", "c"]);
    // A small advantage is noise, not a reason to change products on air.
    const close = selectLiveLineup([...pool.slice(0, 4), product("close", 11)], new Date(now.getTime() + 4 * 3600000), first);
    expect(close.reason).toBe("KEPT");
  });
  it("rotates products in 15-minute segments and pins each when its segment starts", () => {
    const show = liveRunOfShow({ productIds: ["a", "b", "c"], chosenAt: now.toISOString(), reason: "INITIAL" }, now);
    expect(show).toHaveLength(16);
    expect(show.slice(0, 4).map(s => s.productId)).toEqual(["a", "b", "c", "a"]);
    expect(show[1].pinAt).toBe("2026-10-28T08:15:00.000Z");
  });
});

describe("host replies", () => {
  it("classifies Thai viewer comments", () => {
    expect(commentIntent("ราคาเท่าไหร่คะ")).toBe("PRICE");
    expect(commentIntent("สั่งยังไง")).toBe("HOW_TO_BUY");
    expect(commentIntent("กันน้ำไหม")).toBe("DETAIL");
    expect(commentIntent("สวัสดีค่า")).toBe("GREETING");
    expect(commentIntent("555 ตลกมาก")).toBe("BANTER");
    expect(commentIntent("ของปลอมป่าว")).toBe("UNSAFE");
  });
  it("answers only from verified facts and never invents missing ones", () => {
    const p = product("a", 5);
    expect(hostReply({ user: "มิ้น", text: "กันน้ำไหม" }, p).text).toContain("กันน้ำระดับ IPX4");
    expect(hostReply({ user: "มิ้น", text: "ส่งกี่วัน" }, p).text).toContain("จัดส่งภายใน 2 วัน");
    expect(hostReply({ user: "มิ้น", text: "ไซส์อะไร" }, { ...p, facts: [] }).text).toContain("ยังไม่มีข้อมูลยืนยัน");
    expect(hostReply({ user: "มิ้น", text: "ราคา" }, { ...p, price: null }).text).not.toMatch(/\d+ บาท/);
    expect(hostReply({ user: "x", text: "ของปลอม" }, p).skip).toBe(true);
  });
});
