import { describe, expect, it } from "vitest";
import { commandSchema, commandsAfter, emptyDesired, enqueue, isOnline, reportSchema } from "./contract";

describe("praew live commands", () => {
  it("numbers commands and keeps settings in step", () => {
    let d = enqueue(emptyDesired(), { type: "start" });
    d = enqueue(d, { type: "say", text: "สวัสดีค่ะ" });
    d = enqueue(d, { type: "mute", on: true });
    d = enqueue(d, { type: "tiktok", username: "praew" });
    expect(d.seq).toBe(4);
    expect(d.settings).toMatchObject({ running: true, muted: true, tiktok: "praew" });
    expect(commandsAfter(d, 2).map(c => c.type)).toEqual(["mute", "tiktok"]);
    expect(enqueue(d, { type: "products", on: true }).settings.products).toBe(true);
    expect(emptyDesired().settings.products).toBeUndefined();
  });
  it("keeps only the latest commands", () => {
    let d = emptyDesired();
    for (let i = 0; i < 60; i++) d = enqueue(d, { type: "skip" });
    expect(d.commands).toHaveLength(40);
    expect(d.commands[0].id).toBe(21);
  });
  it("rejects bad input", () => {
    expect(commandSchema.safeParse({ type: "say", text: "" }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "tiktok", username: "bad name!" }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "tiktok", username: "@praew.live" }).success).toBe(true);
    expect(commandSchema.safeParse({ type: "rm" }).success).toBe(false);
  });
  it("accepts a minimal report and tells online from offline", () => {
    const r = reportSchema.parse({ state: "running" });
    expect(r.queue).toEqual([]);
    const now = Date.parse("2026-11-18T10:00:00Z");
    expect(isOnline({ receivedAt: "2026-11-18T09:59:50Z" }, now)).toBe(true);
    expect(isOnline({ receivedAt: "2026-11-18T09:59:00Z" }, now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
  });
});
