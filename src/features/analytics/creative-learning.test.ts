import {describe, expect, it} from "vitest";
import {analyzeCreativeLearning, type CreativeOutcome} from "./creative-learning";
const now = new Date("2026-10-13T12:00:00Z");
const context = {ownerId:"owner-a",accountId:"pilot",mode:"GROWTH" as const,optedIn:true,affiliateEligible:false};
const row = (n = 1): CreativeOutcome => ({evidenceId:`e${n}`,ownerId:"owner-a",accountId:"pilot",videoId:`v${n}`,mode:"GROWTH",source:"TIKTOK_DISPLAY",authorized:true,
  observedAt:"2026-10-13T10:00:00Z",hook:"question",angle:"POV",attributedFollowers:2,retention:null,completionRate:null,
  metrics:{views:100,likes:4,comments:2,shares:1,favorites:null,clicks:null,orders:null,gmv:null,commission:null}});
describe("account-scoped evidence-only creative learning", () => {
  it("learns a controlled-test suggestion from attributable real results without claiming virality", () => {
    const result = analyzeCreativeLearning([row(1),row(2),row(3)],context,now);
    expect(result.preferredHook).toBe("question"); expect(result.cohorts[0].followersPerThousandViews).toBe(20);
    expect(result.cohorts[0].retention).toBeNull(); expect(result.cohorts[0].orders).toBeNull();
    expect(result.humanReviewRequired).toBe(true); expect(result.rulesActivated).toBe(false);
  });
  it("excludes mock, other owners/accounts/modes, future, stale, and unauthorized observations", () => {
    const bad: CreativeOutcome[] = [{...row(),source:"MOCK"},{...row(),ownerId:"owner-b"},{...row(),accountId:"sales-account"},
      {...row(),mode:"AFFILIATE"},{...row(),observedAt:"2026-11-01T00:00:00Z"},{...row(),observedAt:"2026-08-01T00:00:00Z"},{...row(),authorized:false}];
    expect(analyzeCreativeLearning(bad,context,now).status).toBe("UNKNOWN");
    expect(analyzeCreativeLearning([row()],{...context,optedIn:false},now).sampleSize).toBe(0);
  });
  it("deduplicates cumulative snapshots and uses the latest version of each post", () => {
    const result = analyzeCreativeLearning([row(),{...row(),evidenceId:"new",observedAt:"2026-10-13T11:00:00Z",metrics:{...row().metrics,views:200}}],context,now);
    expect(result.sampleSize).toBe(1); expect(result.cohorts[0].medianViews).toBe(200); expect(result.preferredHook).toBeNull();
  });
  it("does not turn missing attribution into zero or invent follower conversion from views", () => {
    const result = analyzeCreativeLearning([1,2,3].map(n => ({...row(n),attributedFollowers:null})),context,now);
    expect(result.preferredHook).toBeNull(); expect(result.cohorts[0].followersPerThousandViews).toBeNull();
    expect(result.action).toBe("WAIT_FOR_ATTRIBUTABLE_RESULTS");
  });
  it("only uses sales facts with both Affiliate entitlement and official Shop source", () => {
    const rows = [1,2,3].map(n => ({...row(n),mode:"AFFILIATE" as const,source:"TIKTOK_SHOP_ANALYTICS" as const,metrics:{...row().metrics,orders:2,gmv:200,commission:20}}));
    const affiliate = {...context,mode:"AFFILIATE" as const,affiliateEligible:true};
    expect(analyzeCreativeLearning(rows,affiliate,now).cohorts[0].orders).toBe(6);
    expect(analyzeCreativeLearning(rows,{...affiliate,affiliateEligible:false},now).cohorts[0].orders).toBeNull();
    expect(analyzeCreativeLearning(rows.map(r => ({...r,source:"TIKTOK_DISPLAY"})),affiliate,now).cohorts[0].orders).toBeNull();
  });
  it("leaves cohort metrics unknown rather than substituting a known subset for missing values", () => {
    const rows = [row(1),row(2),{...row(3),metrics:{...row().metrics,views:null,likes:null}}];
    const result = analyzeCreativeLearning(rows,context,now);
    expect(result.cohorts[0]).toMatchObject({videos:3,medianViews:null,engagementRate:null,
      followersPerThousandViews:null,recommendation:"OBSERVE"});
    expect(result.preferredHook).toBeNull();
  });
  it("quarantines a reused immutable evidence ID across videos without counting either as success", () => {
    const rows = [row(1),{...row(2),evidenceId:row(1).evidenceId},row(3)];
    const result = analyzeCreativeLearning(rows,context,now);
    expect(result.sampleSize).toBe(1); expect(result.evidenceIds).toEqual(["e3"]);
    expect(result.conflictingVideosExcluded).toBe(2); expect(result.preferredHook).toBeNull();
  });
  it("quarantines conflicting latest snapshots independently of row order and timestamp timezone spelling", () => {
    const contradictory = {...row(),evidenceId:"other",observedAt:"2026-10-13T17:00:00+07:00",metrics:{...row().metrics,views:9999}};
    for (const rows of [[row(),contradictory],[contradictory,row()]]) {
      const result = analyzeCreativeLearning(rows,context,now);
      expect(result).toMatchObject({sampleSize:0,status:"UNKNOWN",conflictingVideosExcluded:1});
      expect(result.preferredHook).toBeNull();
    }
    const resolved = {...row(),evidenceId:"resolved",observedAt:"2026-10-13T11:00:00Z"};
    expect(analyzeCreativeLearning([row(),contradictory,resolved],context,now).sampleSize).toBe(1);
  });
  it("ignores unauthorized conflicting records instead of poisoning an authorized owner's sample", () => {
    const result = analyzeCreativeLearning([row(),{...row(),ownerId:"other-owner",metrics:{...row().metrics,views:999}}],context,now);
    expect(result).toMatchObject({sampleSize:1,conflictingVideosExcluded:0});
  });
});
