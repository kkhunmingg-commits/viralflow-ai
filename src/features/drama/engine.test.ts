import { describe, expect, it } from "vitest";
import { isCreditReason, pickEpisodeAccount, pickRepairAccount, repairAccounts, repairShotsLeft, setAsideNow, episodeShotsFinished, mayStartEpisode, nextBangkokMorning, nextShotToQueue, promptFor, referencePath, clipVerdict, failureKind, firstBackAt, planRetry, shotAccount, type ShotRow } from "./engine";

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
  it("moves a shot Google refused for unusual activity straight on to the pool", () => {
    expect(failureKind("FLOW_UNUSUAL_ACTIVITY")).toBe("REFUSED");
    expect(failureKind("FLOW_REPORTED_FAILURE")).toBe("BROKEN");
    expect(failureKind(null)).toBe("BROKEN");
    expect(planRetry({ attempts: 3, route: "REPAIR" }, "REFUSED", repair, now))
      .toMatchObject({ status: "FAILED", attempts: 4 });
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "REFUSED", repair, now))
      .toEqual({ status: "PLANNED", route: "REPAIR", attempts: 1, retryAfter: new Date(now.getTime() + 15 * 60_000).toISOString() });
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "REFUSED", { exists: false, outOfCreditsToday: false }, now)).toMatchObject({ route: "PRIMARY" });
    expect(planRetry({ attempts: 2, route: "PRIMARY" }, "REFUSED", repair, now)).toMatchObject({ status: "FAILED", attempts: 3 });
  });
  it("finds when the first resting account comes back", () => {
    const aside = { a: { until: "2026-11-04T06:00:00.000Z" }, b: { until: "2026-11-04T05:30:00.000Z" } };
    expect(firstBackAt(aside, ["a", "b"])).toBe("2026-11-04T05:30:00.000Z");
    expect(firstBackAt(aside, ["c"])).toBeNull();
  });
  it("retries on the main account when there is no repair account", () => {
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "BROKEN", { exists: false, outOfCreditsToday: false }, now)).toMatchObject({ status: "PLANNED", route: "PRIMARY", attempts: 1 });
  });
  it("moves a shot to the repair account when the main one runs out of credits, without spending a try", () => {
    expect(planRetry({ attempts: 0, route: "PRIMARY" }, "NO_CREDIT", repair, now)).toEqual({ status: "PLANNED", route: "REPAIR", attempts: 0, retryAfter: null });
  });
  it("waits for tomorrow's credits when nobody has any left", () => {
    const plan = planRetry({ attempts: 1, route: "REPAIR" }, "NO_CREDIT", { exists: true, outOfCreditsToday: true }, now);
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

describe("repair pool", () => {
  const row = (id: string, patch: Partial<Parameters<typeof repairAccounts>[0][number]> = {}) => ({ id, label: id, active: true, exhausted_on: null, clips_today: 0,
    clips_today_on: null, clips_per_day_estimate: 5, priority: 100, created_at: `2026-11-0${id.length}`, ...patch });
  const today = "2026-11-07";
  it("adds up every account's shots and skips the empty ones", () => {
    const pool = repairAccounts([row("a", { clips_today: 5, clips_today_on: today }), row("bb", { exhausted_on: today }), row("ccc", { clips_today: 2, clips_today_on: today }),
      row("dddd", { clips_today: 5, clips_today_on: "2026-11-06" }), row("eeeee", { active: false })], id => id !== "x", today);
    expect(pool.map(repairShotsLeft)).toEqual([0, 0, 3, 5, 0]);
    expect(pickRepairAccount(pool)?.id).toBe("dddd");
    expect(pickRepairAccount(pool, ["dddd"])?.id).toBe("ccc");
    expect(pickRepairAccount(pool, ["dddd", "ccc"])).toBeNull();
  });
  it("skips an account set aside after it could not start a shot", () => {
    const pool = repairAccounts([row("a"), row("bb")], () => true, today, id => id === "a" ? "IMAGE_INPUT_NOT_FOUND" : null);
    expect(pickRepairAccount(pool)?.id).toBe("bb");
    expect(repairShotsLeft(pool[0])).toBe(0);
  });
  it("forgets a set-aside once its time is up", () => {
    const saved = { a: { until: "2026-11-07T02:00:00Z", reason: "X" }, b: { until: "2026-11-07T00:00:00Z", reason: "Y" } };
    expect(Object.keys(setAsideNow(saved, new Date("2026-11-07T01:00:00Z")))).toEqual(["a"]);
    expect(isCreditReason("GENERATE_BUTTON_NOT_FOUND")).toBe(true);
    expect(isCreditReason("NO_CREDIT")).toBe(true);
    expect(isCreditReason("IMAGE_INPUT_NOT_FOUND")).toBe(false);
  });
  it("gives a whole episode to one account that has room for every shot left (best fit, no fixed main)", () => {
    const pool = repairAccounts([row("main", { clips_today: 1, clips_today_on: today }), row("a", { clips_today: 2, clips_today_on: today }), row("bb"), row("ccc")], () => true, today);
    // 5 shots to make: only the full 5/5 accounts fit; the first of them takes the episode.
    expect(pickEpisodeAccount(pool, 5)?.id).toBe("bb");
    // Once it made shot 1, the episode stays with it (4 shots left, it has 4).
    const after = repairAccounts([row("main", { clips_today: 1, clips_today_on: today }), row("a", { clips_today: 2, clips_today_on: today }), row("bb", { clips_today: 1, clips_today_on: today }), row("ccc")], () => true, today);
    expect(pickEpisodeAccount(after, 4, { sticky: "bb" })?.id).toBe("bb");
    // A small job goes to the part-used account that fits best (3/5), keeping the full ones for new episodes.
    expect(pickEpisodeAccount(pool, 2)?.id).toBe("a");
    expect(pickEpisodeAccount(pool, 4)?.id).toBe("main");
    // Nobody can finish 6 shots in one account: wait.
    expect(pickEpisodeAccount(pool, 6)).toBeNull();
    // A failed account is never picked again for the same shot.
    expect(pickEpisodeAccount(pool, 5, { exclude: ["bb"] })?.id).toBe("ccc");
    // Shots another open episode still needs from an account are not handed out twice.
    expect(pickEpisodeAccount(pool, 5, { reserved: { bb: 5 } })?.id).toBe("ccc");
  });
  it("never picks an account that is not signed in on the worker", () => {
    expect(pickRepairAccount(repairAccounts([row("a")], () => false, today))).toBeNull();
  });
  it("keeps a shot in the pool when the repair account it was on runs out but another has credits", () => {
    expect(planRetry({ attempts: 1, route: "REPAIR" }, "NO_CREDIT", { exists: true, outOfCreditsToday: false }, new Date("2026-11-04T05:00:00Z")))
      .toEqual({ status: "PLANNED", route: "REPAIR", attempts: 1, retryAfter: null });
  });
});
