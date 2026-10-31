import { describe, expect, it } from "vitest";
import { accountPhase } from "./account-phase";

describe("accountPhase", () => {
  it("warms up accounts under 1,000 followers with 3–5 clips a day", () => {
    const view = accountPhase({ follower_count: 250, effective_mode: "GROWTH" });
    expect(view).toMatchObject({ phase: "WARMUP", followersToGo: 750, progress: 25, clipsPerDay: "3–5 คลิป/วัน" });
  });

  it("does not claim selling when followers are enough but Shop permission is missing", () => {
    expect(accountPhase({ follower_count: 1200, effective_mode: "GROWTH" })).toMatchObject({ phase: "WAITING_SHOP", followersToGo: 0, progress: 100 });
  });

  it("sells once the account's effective mode is affiliate", () => {
    expect(accountPhase({ follower_count: 5000, effective_mode: "AFFILIATE" })).toMatchObject({ phase: "SELLING", clipsPerDay: "สูงสุด 15 คลิป/วัน" });
  });

  it("treats missing follower counts as zero", () => {
    expect(accountPhase({ follower_count: null, effective_mode: null })).toMatchObject({ phase: "WARMUP", followers: 0, progress: 0 });
  });
});
