import { describe, expect, it } from "vitest";
import { episodeShotsFinished, mayStartEpisode, nextBangkokMorning, nextShotToQueue, promptFor, referencePath, clipVerdict, planRetry, shotAccount, type ShotRow } from "./engine";

const shot = (position: number, patch: Partial<ShotRow> = {}): ShotRow => ({
  id: `s${position}`, episode_id: "e", position, status: "PLANNED", reference_mode: position === 1 ? "KEY_STILL" : "PREVIOUS_FRAME", attempts: 0,
  retry_after: null, last_frame_path: null, flow_clip_id: null, prompt: "p", subtitle: "", video_path: null, duration_seconds: null, error: null, route: "PRIMARY", ...patch,
});

describe("clipVerdict", () => {
  it("maps Flow clip states", () => {
    expect(clipVerdict("QUEUED")).toBe("WAIT");
    expect(clipVerdict("GENERATING")).toBe("WAIT");
    expect(clipVerdict("READY")).toBe("CHECK");
    expect(clipVerdict("POSTED")).toBe("CHECK");
    expect(clipVerdict("SKIPPED_NO_CREDIT")).toBe("NO_CREDIT");
    expect(clipVerdict("FAILED")).toBe("BROKEN");
    expect(clipVerdict(null)).toBe("BROKEN");
  });
});

describe("planRetry", () => {
  const now = new Date("2026-11-04T05:00:00Z");
  const repair = { exists: true, outOfCreditsToday: false };
  it("sends a broken take to the repair account until the tries run out", () => {
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "BROKEN", repair, now)).toEqual({ status: "PLANNED", route: "REPAIR", attempts: 1, retryAfter: null });
    expect(planRetry({ attempts: 2, route: "REPAIR" }, "BROKEN", repair, now)).toMatchObject({ status: "PLANNED", route: "REPAIR", attempts: 3 });
    expect(planRetry({ attempts: 3, route: "REPAIR" }, "BROKEN", repair, now)).toMatchObject({ status: "FAILED", attempts: 4 });
  });
  it("retries on the main account when there is no repair account", () => {
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "BROKEN", { exists: false, outOfCreditsToday: false }, now)).toMatchObject({ status: "PLANNED", route: "PRIMARY", attempts: 1 });
  });
  it("moves a shot to the repair account when the main one runs out of credits, without spending a try", () => {
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "NO_CREDIT", repair, now)).toEqual({ status: "PLANNED", route: "REPAIR", attempts: 0, retryAfter: null });
  });
  it("waits for tomorrow's credits when nobody has any left", () => {
    const plan = planRetry({ attempts: 1, route: "REPAIR" }, "NO_CREDIT", repair, now);
    expect(plan).toMatchObject({ status: "PLANNED", route: "PRIMARY", attempts: 1 });
    expect(plan.retryAfter).toBe(nextBangkokMorning(now));
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "NO_CREDIT", { exists: true, outOfCreditsToday: true }, now).retryAfter).toBe(nextBangkokMorning(now));
  });
});

describe("shotAccount", () => {
  it("picks the main or repair account", () => {
    const series = { flow_account_id: "main", repair_flow_account_id: "fix" };
    expect(shotAccount("PRIMARY", series)).toBe("main");
    expect(shotAccount("REPAIR", series)).toBe("fix");
    expect(shotAccount("REPAIR", { flow_account_id: "main", repair_flow_account_id: null })).toBe("main");
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
