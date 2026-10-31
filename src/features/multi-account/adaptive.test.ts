import {it,expect} from "vitest";
import {accountAutomationSchema} from "./contracts";
import {analyzeFrequency,adaptiveConcurrency,type FrequencyEvidence} from "./adaptive";
const config=accountAutomationSchema.parse({dailyBudgetUsd:1000}),evidence:FrequencyEvidence={history:Array.from({length:8},()=>({posts:220,views:22000,engagements:220})),publishCap:300,ready:0,candidates:500,estimatedUnitCost:1,paidPermitted:true,measuredGenerationPerDay:1000,providerAutomated:true,accountHealthy:true,phase:"AFFILIATE"};
it("tempers observed frequency by the phase cadence instead of following runaway history",()=>{
  // 220/day history never exceeds the typical TikTok creator cap of 15/day.
  expect(analyzeFrequency(config,evidence)).toMatchObject({generation:15,publishing:15,reason:"CADENCE_AFFILIATE_TARGET"});
  expect(analyzeFrequency(config,{...evidence,history:Array.from({length:3},()=>({posts:7,views:700,engagements:7}))})).toMatchObject({generation:7,publishing:7});
  // Growth accounts stay inside 3-5 a day.
  expect(analyzeFrequency(config,{...evidence,phase:"GROWTH"})).toMatchObject({generation:5,publishing:5});
  expect(analyzeFrequency(config,{...evidence,phase:"GROWTH",history:Array.from({length:3},()=>({posts:1,views:100,engagements:1}))}).generation).toBe(3);
});
it("cold-starts a new account at the conservative cadence instead of waiting with zero clips",()=>{
  expect(analyzeFrequency(config,{...evidence,phase:"GROWTH",history:[]})).toMatchObject({generation:3,publishing:3,reason:"CADENCE_GROWTH"});
  expect(analyzeFrequency(config,{...evidence,history:[]})).toMatchObject({generation:5,publishing:5,reason:"CADENCE_AFFILIATE_RAMP"});
  expect(analyzeFrequency(config,{...evidence,history:evidence.history.slice(0,2)}).generation).toBe(9);
  expect(analyzeFrequency({...config,dailyTarget:4},{...evidence,history:[]}).generation).toBe(4);
  expect(analyzeFrequency(config,{...evidence,history:[],risk:"WARNING"}).generation).toBe(3);
  expect(analyzeFrequency(config,{...evidence,history:[],risk:"BLOCKED"}).generation).toBe(0);
});
it("respects actual budgets, platform caps, health, provider throughput, assisted mode and permitted spacing",()=>{
  expect(analyzeFrequency({...config,dailyBudgetUsd:3},evidence).generation).toBe(3);
  expect(analyzeFrequency(config,{...evidence,publishCap:2}).publishing).toBe(2);
  expect(analyzeFrequency(config,{...evidence,publishCap:null}).publishing).toBe(0);
  expect(analyzeFrequency(config,{...evidence,measuredGenerationPerDay:12}).generation).toBe(12);
  expect(analyzeFrequency(config,{...evidence,providerAutomated:false}).generation).toBe(0);
  expect(analyzeFrequency(config,{...evidence,paidPermitted:false}).generation).toBe(0);
  expect(analyzeFrequency(config,{...evidence,accountHealthy:false}).generation).toBe(0);
  expect(analyzeFrequency({...config,dailyBudgetUsd:3},{...evidence,producedToday:2,budgetSpentToday:2}).generation).toBe(3);
  // A window of 6 hours allows at most 6 clips an hour apart.
  expect(analyzeFrequency({...config,spreadFullDay:false,windows:[{start:600,end:960}]},evidence).publishing).toBe(6);
});
it("scales concurrency to measured resources and queues, deferring work under memory/CPU pressure",()=>{
  const snapshot={cpuUnits:64,cpuBusy:.25,freeBytes:64e9,totalBytes:80e9,rssBytes:1e9,measuredJobBytes:2e9,providerSlots:40,queueDepth:300};
  expect(adaptiveConcurrency(snapshot)).toBe(26);expect(adaptiveConcurrency({...snapshot,freeBytes:1e9})).toBe(0);
  expect(adaptiveConcurrency({...snapshot,cpuBusy:1})).toBe(0);expect(adaptiveConcurrency({...snapshot,providerSlots:2})).toBe(2);
  expect(adaptiveConcurrency({...snapshot,queueDepth:0})).toBe(0);
});
