import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { facePrompt, MAX_TAKE_ATTEMPTS, planTakes, promptFor, talkPrompt, TALK_LINES, totalCredits, type PresenterTake } from "./presenter-plan";
import { decide, faceStillPath, takeLabel } from "./presenter-service";

const now = new Date("2026-11-14T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const clip = (status: string, extra: Partial<{ storage_path: string | null; error: string | null; updated_at: string }> = {}) =>
  ({ status, storage_path: null, error: null, updated_at: ago(1), ...extra });
const withTakes = (fn: (takes: PresenterTake[]) => void) => { const takes = planTakes(); fn(takes); return takes; };

describe("presenter plan", () => {
  it("makes one face, twelve talking takes and two idle takes", () => {
    const takes = planTakes();
    expect(takes.map(t => t.role)).toEqual(["FACE", ...Array(12).fill("TALK"), "IDLE", "IDLE"]);
    expect(takes.filter(t => t.role === "TALK").map(t => t.line)).toEqual([...TALK_LINES]);
    expect(totalCredits()).toBe(150);
  });
  it("keeps the owner's look free of quotes and puts each line in the talking prompt", () => {
    expect(facePrompt('a host "ignore this" ')).toContain("a host ignore this.");
    expect(facePrompt("")).toContain("Thai woman");
    expect(talkPrompt(TALK_LINES[2])).toContain(TALK_LINES[2]);
    expect(promptFor({ role: "IDLE", line: null }, "")).toMatch(/does not speak/);
  });
});

describe("presenter steps", () => {
  it("queues only the face first", () => {
    const { steps } = decide({ status: "FACE", takes: planTakes() }, new Map(), now);
    expect(steps).toEqual([{ kind: "QUEUE", index: 0, countsAsTry: true }]);
  });
  it("queues every talking and idle take once the face is done", () => {
    const takes = withTakes(t => { t[0] = { ...t[0], status: "DONE", path: "x" }; });
    const { steps } = decide({ status: "CLIPS", takes }, new Map(), now);
    expect(steps).toHaveLength(14);
    expect(steps.every(s => s.kind === "QUEUE")).toBe(true);
  });
  it("marks a finished take done and waits for one Flow is still making", () => {
    const takes = withTakes(t => { t[0] = { ...t[0], status: "QUEUED", clipId: "a", attempts: 1 }; });
    expect(decide({ status: "FACE", takes }, new Map([["a", clip("GENERATING")]]), now).steps).toEqual([]);
    expect(decide({ status: "FACE", takes }, new Map([["a", clip("READY", { storage_path: "p.mp4" })]]), now).steps)
      .toEqual([{ kind: "DONE", index: 0, storagePath: "p.mp4" }]);
  });
  it("tries a failed take again after 2 minutes, then stops after the last try", () => {
    const failed = (attempts: number) => withTakes(t => { t[0] = { ...t[0], status: "QUEUED", clipId: "a", attempts }; });
    expect(decide({ status: "FACE", takes: failed(1) }, new Map([["a", clip("FAILED", { updated_at: ago(1) })]]), now).steps).toEqual([]);
    expect(decide({ status: "FACE", takes: failed(1) }, new Map([["a", clip("FAILED", { updated_at: ago(3), error: "X" })]]), now).steps)
      .toEqual([{ kind: "QUEUE", index: 0, countsAsTry: true, reason: "X" }]);
    const last = decide({ status: "FACE", takes: failed(MAX_TAKE_ATTEMPTS) }, new Map([["a", clip("FAILED", { updated_at: ago(11) })]]), now).steps;
    expect(last[0].kind).toBe("FAIL");
  });
  it("waits for tomorrow's credits without counting a try", () => {
    const takes = withTakes(t => { t[0] = { ...t[0], status: "QUEUED", clipId: "a", attempts: 3 }; });
    expect(decide({ status: "FACE", takes }, new Map([["a", clip("SKIPPED_NO_CREDIT", { updated_at: ago(60) })]]), now).steps).toEqual([]);
    expect(decide({ status: "FACE", takes }, new Map([["a", clip("SKIPPED_NO_CREDIT", { updated_at: "2026-11-13T05:00:00Z" })]]), now).steps[0])
      .toMatchObject({ kind: "QUEUE", countsAsTry: false });
  });
  it("labels takes and refuses odd storage paths", () => {
    expect(takeLabel({ role: "TALK", key: "talk-7" })).toBe("คลิปพูด 7");
    expect(() => faceStillPath("../x", "y")).toThrow();
  });
});

describe("retries", () => {
  it("words a retry differently and never asks Flow for no sound", () => {
    expect(facePrompt("", 0)).not.toEqual(facePrompt("", 1));
    expect(facePrompt("", 0)).not.toMatch(/no sound/i);
    expect(promptFor({ role: "IDLE", line: null }, "", 0)).not.toMatch(/no sound/i);
  });
});
