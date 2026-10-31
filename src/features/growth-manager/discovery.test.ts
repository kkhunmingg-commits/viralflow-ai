import { describe, it, expect } from "vitest";
import { classifyAccount, discoverAccounts, type AccountObservation } from "./discovery";
import { chooseGrowthTopics, growthCreativeBrief, type TopicEvidence } from "./topics";
import { pilotPolicySchema } from "./contracts";
import { analyzeGrowth, growthSlots } from "./planner";
import { accountAutomationSchema } from "../multi-account/contracts";
const now = new Date("2026-10-12T12:00:00Z");
const input = (count: number): AccountObservation => ({ owner: "owner", account: "a", identity: "open-a",
  connected: true, optedIn: true, previousMode: "GROWTH", followers: { count, at: now.toISOString(), identity: "open-a", source: "TIKTOK_DISPLAY" },
  commerce: { at: now.toISOString(), source: "tiktok_shop", authorized: true, eligible: true, ecommerce: true, cart: true } });
describe("verified master account logic", () => {
  it.each([[300,"GROWTH"],[999,"GROWTH"],[1000,"AFFILIATE"],[5000,"AFFILIATE"]] as const)("%i followers selects %s from real eligibility", (count,mode) => {
    expect(classifyAccount(input(count),now)).toMatchObject({ mode, verified: true, canExecute: true });
  });
  it("1000 without Shop permission continues growth and rechecks eligibility", () => {
    expect(classifyAccount({ ...input(1000), commerce: null },now)).toMatchObject({ mode:"GROWTH",reason:"ELIGIBILITY_PENDING",affiliateAllowed:false,canExecute:true });
  });
  it("updates after sync, downgrades revoked Affiliate, and never enrolls a discovered account", () => {
    expect(classifyAccount(input(999),now).mode).toBe("GROWTH");
    const ready=classifyAccount(input(1000),now);expect(ready.mode).toBe("AFFILIATE");
    expect(classifyAccount({...input(1000),previousMode:ready.mode,commerce:{...input(1000).commerce!,authorized:false}},now)).toMatchObject({mode:"GROWTH",affiliateAllowed:false});
    expect(classifyAccount({...input(5000),optedIn:false},now)).toMatchObject({mode:"AFFILIATE",canExecute:false});
  });
  it("missing, stale, conflicting, mock and failed sync preserves the mode and blocks execution", () => {
    const base={...input(5000),previousMode:"AFFILIATE" as const};
    for(const followers of [null,{...base.followers!,at:"2026-10-01T00:00:00Z"},{...base.followers!,identity:"other"},{...base.followers!,source:"MOCK" as const},{...base.followers!,count:NaN},{...base.followers!,at:"2027-01-01T00:00:00Z"}]) {
      expect(classifyAccount({...base,followers},now)).toMatchObject({mode:"AFFILIATE",verified:false,followers:null,canExecute:false,affiliateAllowed:false});
    }
    expect(classifyAccount({...base,followers:null,commerce:{...base.commerce!,authorized:false}},now).mode).toBe("GROWTH");
  });
  it("stale/mocked eligibility cannot authorize Affiliate; disconnected account cannot execute", () => {
    for(const commerce of [{...input(5000).commerce!,source:"mock" as const},{...input(5000).commerce!,at:"2026-10-01T00:00:00Z"}])expect(classifyAccount({...input(5000),commerce},now).affiliateAllowed).toBe(false);
    expect(classifyAccount({...input(300),connected:false},now).canExecute).toBe(false);
    const dated={...input(5000),commerce:{...input(5000).commerce!,at:"2026-10-11T18:00:00Z"}};
    expect(classifyAccount(dated,now).validUntil).toBe("2026-10-12T18:00:00.000Z");
  });
  it("paginates beyond examples and discovers new accounts without a code deployment", async () => {
    const accounts=Array.from({length:1003},(_,i)=>i),load=async(from:number,to:number)=>accounts.slice(from,to+1);
    expect(await discoverAccounts(load)).toHaveLength(1003);accounts.push(1003);expect(await discoverAccounts(load)).toHaveLength(1004);
  });
});
describe("automatic topics from authorized evidence", () => {
  const topic:TopicEvidence={name:"จัดบ้าน",key:"home",source:"tiktok_shop",capturedAt:now.toISOString(),authorized:true,confidence:.8,momentum:80,accountEffect:null};
  it("chooses available topics without asking for a channel brief and rejects fabricated/unauthorized/stale trends", () => {
    expect(chooseGrowthTopics([topic],now)).toEqual(["จัดบ้าน"]);
    expect(chooseGrowthTopics([{...topic,source:"MOCK"},{...topic,authorized:false},{...topic,capturedAt:"2026-09-01T00:00:00Z"},{...topic,capturedAt:"2027-01-01T00:00:00Z"}],now)).toEqual([]);
    expect(growthCreativeBrief("จัดบ้าน")).toContain("no video has been generated");
  });
  it("no real topic means wait for data, not invented content or a paid fallback", () => {
    const config=accountAutomationSchema.parse({}),policy=pilotPolicySchema.parse({});
    const decision=analyzeGrowth(config,policy,{posts:[],followers:[],accountHealth:"READY",publicApiEligible:false,publishCap:null,publishedToday:0,prior:null},now);
    expect(decision).toMatchObject({recommended:0,reason:"NO_AUTHORIZED_TOPIC_DATA"});
    expect(growthSlots("o","a",config,policy,decision,now,"stable")).toEqual([]);
  });
});
