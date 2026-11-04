import { describe, expect, it } from "vitest";
import { episodeShotsFinished, mayStartEpisode, nextBangkokMorning, nextShotToQueue, promptFor, referencePath, shotOutcome, type ShotRow } from "./engine";

const shot = (position: number, patch: Partial<ShotRow> = {}): ShotRow => ({
  id: `s${position}`, episode_id: "e", position, status: "PLANNED", reference_mode: position === 1 ? "KEY_STILL" : "PREVIOUS_FRAME", attempts: 0,
  retry_after: null, last_frame_path: null, flow_clip_id: null, prompt: "p", subtitle: "", video_path: null, duration_seconds: null, error: null, ...patch,
});

describe("shotOutcome", () => {
  it("maps Flow clip states", () => {
    expect(shotOutcome("QUEUED", 0)).toBe("WAIT");
    expect(shotOutcome("GENERATING", 0)).toBe("WAIT");
    expect(shotOutcome("READY", 0)).toBe("ABSORB");
    expect(shotOutcome("SKIPPED_NO_CREDIT", 5)).toBe("RETRY_TOMORROW");
    expect(shotOutcome("FAILED", 0)).toBe("RETRY");
    expect(shotOutcome("FAILED", 1)).toBe("GIVE_UP");
    expect(shotOutcome(null, 0)).toBe("RETRY");
  });
});

describe("nextShotToQueue", () => {
  it("goes strictly in order and waits for queued or failed shots", () => {
    expect(nextShotToQueue([shot(2), shot(1)])?.position).toBe(1);
    expect(nextShotToQueue([shot(1, { status: "DONE" }), shot(2), shot(3)])?.position).toBe(2);
    expect(nextShotToQueue([shot(1, { status: "QUEUED" }), shot(2)])).toBeNull();
    expect(nextShotToQueue([shot(1, { status: "FAILED" }), shot(2)])).toBeNull();
    expect(nextShotToQueue([shot(1, { status: "SKIPPED" }), shot(2)])?.position).toBe(2);
  });
  it("respects retry_after for shots waiting on tomorrow's credits", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(nextShotToQueue([shot(1, { retry_after: "2026-11-05T00:00:00Z" })], now)).toBeNull();
    expect(nextShotToQueue([shot(1, { retry_after: "2026-11-04T09:00:00Z" })], now)?.position).toBe(1);
  });
});

it("nextBangkokMorning is just after the next Bangkok midnight", () => {
  expect(nextBangkokMorning(new Date("2026-11-04T10:00:00Z"))).toBe("2026-11-04T17:05:00.000Z");
  expect(nextBangkokMorning(new Date("2026-11-04T18:00:00Z"))).toBe("2026-11-05T17:05:00.000Z");
});

it("episodeShotsFinished needs every shot settled and at least one made", () => {
  expect(episodeShotsFinished([])).toBe(false);
  expect(episodeShotsFinished([shot(1, { status: "DONE" }), shot(2, { status: "SKIPPED" })])).toBe(true);
  expect(episodeShotsFinished([shot(1, { status: "SKIPPED" })])).toBe(false);
  expect(episodeShotsFinished([shot(1, { status: "DONE" }), shot(2)])).toBe(false);
});

it("referencePath uses the previous made shot's last frame, else the key still", () => {
  const shots = [shot(1, { status: "DONE", last_frame_path: "f1" }), shot(2, { status: "SKIPPED" }), shot(3)];
  expect(referencePath(shots[2], shots, "key")).toBe("f1");
  expect(referencePath(shot(1), [], "key")).toBe("key");
  expect(referencePath(shot(2), [shot(1)], "key")).toBe("key");
  expect(referencePath({ position: 1, reference_mode: "NONE" }, [], "key")).toBeNull();
});

it("promptFor drops reference lines when no image is attached", () => {
  const prompt = "Scene\nMatch the attached image exactly.\nEnd";
  expect(promptFor(prompt, "x")).toBe(prompt);
  expect(promptFor(prompt, null)).toBe("Scene\nEnd");
});

it("mayStartEpisode", () => {
  const s = { next_episode_number: 3, total_episodes: 10, episodes_per_day: 1 };
  expect(mayStartEpisode(s, 0, 0)).toBe(true);
  expect(mayStartEpisode(s, 1, 0)).toBe(false);
  expect(mayStartEpisode(s, 0, 1)).toBe(false);
  expect(mayStartEpisode({ ...s, next_episode_number: 11 }, 0, 0)).toBe(false);
});
