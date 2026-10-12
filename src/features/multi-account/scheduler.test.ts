import { describe, it, expect } from "vitest";
import { accountAutomationSchema, type SchedulerAccount } from "./contracts";
import { MultiAccountPublishingScheduler, localDay, dayBounds, capacityEstimate } from "./scheduler";
import { restrictProviderSettings } from "./provider-policy";
import { providerSettingsSchema } from "@/features/video-provider/contracts";

export const accounts = (n: number): SchedulerAccount[] => Array.from({ length:n },(_,i) => ({ id:`account-${i}`,ownerId:"owner",config:accountAutomationSchema.parse({enabled:true}),connected:true,hidden:false,ready:0,produced:0,published:0,publishCap:2,recommendation:{generation:i+2,publishing:2,reason:"FIXTURE_OBSERVATIONS",confidence:1},scheduleSeed:`fixture-seed-${i}` }));
const now = new Date("2026-10-12T05:00:00Z");
describe("dynamic per-account scheduler",() => {
  it("prevents jitter from bunching low-cadence slots even with the old one-minute floor",()=>{
    for (let seed=0;seed<100;seed++) {
      const row=accounts(1)[0];row.recommendation.generation=6;row.scheduleSeed=String(seed);
      const slots=new MultiAccountPublishingScheduler().plan([row],now);
      expect(slots).toHaveLength(6);
      for(let i=1;i<slots.length;i++) expect(Date.parse(slots[i].dueAt)-Date.parse(slots[i-1].dueAt)).toBeGreaterThanOrEqual(120*60000);
    }
  });
  for (const n of [1,3,10,20,50]) it(`${n} accounts follow independently supplied recommendations, without fixed clip quotas`,() => {
    const rows = accounts(n), scheduler = new MultiAccountPublishingScheduler(), plan = scheduler.plan(rows,now);
    const total=rows.reduce((sum,a)=>sum+a.recommendation.generation,0);
    expect(plan).toHaveLength(total); expect(new Set(plan.map(p => `${p.accountId}:${p.day}:${p.ordinal}`)).size).toBe(total);
    for (const account of rows) {
      const slots = plan.filter(p => p.accountId===account.id); expect(slots).toHaveLength(account.recommendation.generation);
      const bounds = dayBounds(slots[0].day,account.config.timezone);
      const interval=(bounds.end-bounds.start)/account.recommendation.generation;
      expect(Math.min(...slots.map(p => Date.parse(p.dueAt)))-bounds.start).toBeLessThanOrEqual(interval+60000);
      expect(bounds.end-Math.max(...slots.map(p => Date.parse(p.dueAt)))).toBeLessThanOrEqual(interval+60000);
      expect(slots.every(p => Date.parse(p.availableAt)===Date.parse(p.dueAt)-180*60000)).toBe(true);
    }
    expect(capacityEstimate(rows,null)).toMatchObject({generationTarget:total,publishingTarget:n*2,shortage:n*2,estimatedCost:null,automatedGoogleCapacity:null});
    expect(scheduler.plan(rows,now)).toEqual(plan);
  });
  it("replans add/remove/pause without changing other account slots",() => {
    const scheduler = new MultiAccountPublishingScheduler(), rows=accounts(10), before=scheduler.plan(rows,now);
    rows[0].hidden=true;rows[1].connected=false;rows[2].config.paused=true;rows.push({...accounts(1)[0],id:"new-account"});
    const after=scheduler.plan(rows,now);expect(after).toHaveLength(rows.filter(a=>!a.hidden&&a.connected&&!a.config.paused).reduce((n,a)=>n+a.recommendation.generation,0));
    expect(after.filter(p=>p.accountId==="account-3")).toEqual(before.filter(p=>p.accountId==="account-3"));
  });
  it("handles per-account zones, windows, measured audience preference and DST",() => {
    const rows=accounts(3); rows[0].config=accountAutomationSchema.parse({enabled:true,spreadFullDay:false,windows:[{start:600,end:720}],audienceMinutes:[605,620,640]});
    rows[1].config.timezone="America/New_York";rows[2].config.timezone="Pacific/Auckland";
    const plan=new MultiAccountPublishingScheduler().plan(rows,now);expect(plan).toHaveLength(9);
    expect(plan.every(p=>localDay(new Date(p.dueAt),rows.find(a=>a.id===p.accountId)!.config.timezone)===p.day)).toBe(true);
    const spring=dayBounds("2026-03-08","America/New_York"),fall=dayBounds("2026-11-01","America/New_York");
    expect(spring.end-spring.start).toBe(23*3600000);expect(fall.end-fall.start).toBe(25*3600000);
  });
  it("supports counts beyond examples and persists random timing via a day seed",()=>{
    const rows=accounts(73),scheduler=new MultiAccountPublishingScheduler();rows[0].recommendation.generation=211;
    const plan=scheduler.plan(rows,now);expect(plan.filter(p=>p.accountId===rows[0].id)).toHaveLength(211);expect(new Set(plan.map(p=>p.accountId)).size).toBe(73);
    const changed=scheduler.plan([{...rows[0],scheduleSeed:"different-random-day-seed"}],now);expect(changed).not.toEqual(plan.filter(p=>p.accountId===rows[0].id));
    const c=accountAutomationSchema.parse({minimum:15,maximum:20});expect(c).not.toHaveProperty("minimum");expect(c).not.toHaveProperty("maximum");
  });
  it("account preferences cannot grant paid permission or exceed owner budget",() => {
    const owner=providerSettingsSchema.parse({maxCostUsd:1,dailyBudgetUsd:4,monthlyBudgetUsd:10});
    const account=accountAutomationSchema.parse({providerPreference:"FAL_ONLY",dailyBudgetUsd:100});
    expect(restrictProviderSettings(owner,account)).toMatchObject({mode:"GOOGLE_ONLY",paidFallback:false,dailyBudgetUsd:4,maxCostUsd:1});
    expect(restrictProviderSettings({...owner,paidFallback:true},{...account,dailyBudgetUsd:.2})).toMatchObject({mode:"FAL_ONLY",maxCostUsd:.2,dailyBudgetUsd:4});
    expect(restrictProviderSettings({...owner,mode:"GOOGLE_ONLY",paidFallback:true},account).mode).toBe("GOOGLE_ONLY");
    const automatic={...account,providerPreference:"AUTO" as const};
    expect(restrictProviderSettings(owner,automatic,true).mode).toBe("AUTO");
    expect(restrictProviderSettings({...owner,paidFallback:true},automatic,true).mode).toBe("FAL_ONLY");
    expect(restrictProviderSettings({...owner,paidFallback:true},automatic,false).mode).toBe("AUTO");
  });
});
