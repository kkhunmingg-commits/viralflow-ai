import { describe, expect, it } from "vitest";
import { actionSchema, applyAction, emptyStudio, ownsPhoto, presenterStatus, resolveBackground, studioReportSchema, StudioError, workerOnline } from "./contract";

const OWNER = "11111111-2222-3333-4444-555555555555";
const now = new Date("2026-11-23T15:00:00Z");
let n = 0;
const nextId = () => `p${String(++n).padStart(8, "0")}`;
const photo = { kind: "photo" as const, path: `owner/${OWNER}/presenter-studio/uploads/abc.jpg` };
const input = (over: Record<string, unknown> = {}) => actionSchema.parse({ action: "create", presenter: {
  name: "พี่ต้น", gender: "male", voice: "edge-niwat", source: photo, consent: true, ...over } });

describe("presenter studio", () => {
  it("creates a presenter that belongs to the account, defaults filled in", () => {
    const d = applyAction(emptyStudio(), input() as never, OWNER, now, nextId);
    expect(d.presenters).toHaveLength(1);
    expect(d.presenters[0]).toMatchObject({ name: "พี่ต้น", gender: "male", voice: "edge-niwat", tone: "normal", quality: "both", rev: 0 });
    expect(d.active).toBe("praew");
  });
  it("needs consent and only takes the owner's own photo", () => {
    expect(actionSchema.safeParse({ action: "create", presenter: { name: "a", gender: "male", voice: "edge-niwat", source: photo, consent: false } }).success).toBe(false);
    expect(() => applyAction(emptyStudio(), input({ source: { kind: "photo", path: "owner/someone-else/presenter-studio/x.jpg" } }) as never, OWNER, now, nextId)).toThrow(StudioError);
    expect(ownsPhoto(OWNER, `owner/${OWNER}/presenter-studio/../../x`)).toBe(false);
  });
  it("rejects a voice that is not free/known", () => {
    expect(actionSchema.safeParse({ action: "create", presenter: { name: "a", gender: "male", voice: "azure-premwadee", source: photo, consent: true } }).success).toBe(false);
  });
  it("picks a generated face, rebuilds, activates and deletes", () => {
    let d = applyAction(emptyStudio(), input({ source: { kind: "generate", look: "a Thai man, 30" } }) as never, OWNER, now, nextId);
    const id = d.presenters[0].id;
    d = applyAction(d, { action: "pickFace", id, pick: 2 }, OWNER, now, nextId);
    expect(d.presenters[0].source).toMatchObject({ kind: "generate", pick: 2 });
    d = applyAction(d, { action: "rebuild", id }, OWNER, now, nextId);
    expect(d.presenters[0].rev).toBe(1);
    expect(d.presenters[0].source).not.toHaveProperty("pick");
    d = applyAction(d, { action: "activate", id }, OWNER, now, nextId);
    expect(d.active).toBe(id);
    d = applyAction(d, { action: "delete", id }, OWNER, now, nextId);
    expect(d).toMatchObject({ presenters: [], active: "praew" });
  });
  it("keeps names unique", () => {
    const d = applyAction(emptyStudio(), input() as never, OWNER, now, nextId);
    expect(() => applyAction(d, input() as never, OWNER, now, nextId)).toThrow("NAME_TAKEN");
  });
  it("shows the PC's progress only for the current build", () => {
    const d = applyAction(emptyStudio(), input() as never, OWNER, now, nextId);
    const p = { ...d.presenters[0], rev: 1 };
    expect(presenterStatus(p, { state: "ready", rev: 0 }, true).usable).toBe(false);
    expect(presenterStatus(p, { state: "ready_quick", rev: 1 }, true)).toMatchObject({ usable: true, tone: "ok" });
    expect(presenterStatus(p, undefined, false).label).toBe("รอเครื่องออนไลน์");
  });
  it("parses the PC report and knows when the worker is online", () => {
    const r = studioReportSchema.parse({ jobs: { p00000001: { state: "building", percent: 40, message: "กำลังสร้าง" } }, liveRunning: false });
    expect(r.jobs.p00000001.rev).toBe(0);
    expect(workerOnline({ receivedAt: new Date(Date.now() - 10_000).toISOString() })).toBe(true);
    expect(workerOnline({ receivedAt: new Date(Date.now() - 120_000).toISOString() })).toBe(false);
  });
});

describe("presenter studio: shop sets", () => {
  it("defaults to auto (by gender) and takes a ready-made set", () => {
    let d = applyAction(emptyStudio(), input() as never, OWNER, now, nextId);
    expect(d.presenters[0].background).toBe("auto");
    expect(resolveBackground(d.presenters[0])).toBe("general");
    expect(resolveBackground({ gender: "female" })).toBe("beauty");
    d = applyAction(emptyStudio(), input({ name: "b", background: "gadget" }) as never, OWNER, now, nextId);
    expect(resolveBackground(d.presenters[0])).toBe("gadget");
    expect(actionSchema.safeParse({ action: "create", presenter: { name: "a", gender: "male", voice: "edge-niwat", source: photo, consent: true, background: "moon" } }).success).toBe(false);
  });
  it("needs the owner's own shop photo for a custom set", () => {
    expect(() => applyAction(emptyStudio(), input({ background: "custom" }) as never, OWNER, now, nextId)).toThrow("BG_PHOTO_MISSING");
    expect(() => applyAction(emptyStudio(), input({ background: "custom", bgPath: "owner/x/presenter-studio/uploads/a.jpg" }) as never, OWNER, now, nextId)).toThrow("PHOTO_NOT_YOURS");
    const d = applyAction(emptyStudio(), input({ background: "custom", bgPath: `owner/${OWNER}/presenter-studio/uploads/shop.jpg` }) as never, OWNER, now, nextId);
    expect(d.presenters[0]).toMatchObject({ background: "custom", bgPath: `owner/${OWNER}/presenter-studio/uploads/shop.jpg` });
  });
  it("changing the set rebuilds, keeping a picked face; the same set does not", () => {
    let d = applyAction(emptyStudio(), input({ source: { kind: "generate", look: "a Thai man, 30" } }) as never, OWNER, now, nextId);
    const id = d.presenters[0].id;
    d = applyAction(d, { action: "pickFace", id, pick: 1 }, OWNER, now, nextId);
    d = applyAction(d, { action: "update", id, background: "auto" }, OWNER, now, nextId);
    expect(d.presenters[0].rev).toBe(0);
    d = applyAction(d, { action: "update", id, background: "luxury" }, OWNER, now, nextId);
    expect(d.presenters[0]).toMatchObject({ background: "luxury", rev: 1, source: { pick: 1 } });
    d = applyAction(d, { action: "update", id, background: "custom", bgPath: `owner/${OWNER}/presenter-studio/uploads/s.jpg` }, OWNER, now, nextId);
    expect(d.presenters[0]).toMatchObject({ background: "custom", rev: 2 });
    d = applyAction(d, { action: "update", id, background: "food" }, OWNER, now, nextId);
    expect(d.presenters[0]).not.toHaveProperty("bgPath");
  });
  it("reads the PC's list of made sets", () => {
    expect(studioReportSchema.parse({ jobs: {}, backgrounds: [{ id: "beauty", label: "x" }, "gadget", { id: "moon" }] }).backgrounds).toEqual(["beauty", "gadget"]);
    expect(studioReportSchema.parse({ jobs: {} }).backgrounds).toEqual([]);
  });
});
