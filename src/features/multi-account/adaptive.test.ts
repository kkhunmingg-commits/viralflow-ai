import {it,expect} from "vitest";
import {accountAutomationSchema} from "./contracts";
import {analyzeFrequency,adaptiveConcurrency,type FrequencyEvidence} from "./adaptive";
const config=accountAutomationSchema.parse({dailyBudgetUsd:1000}),evidence:FrequencyEvidence={history:Array.from({length:8},()=>({posts:220,views:22000,engagements:220})),publishCap:300,ready:0,candidates:500,estimatedUnitCost:1,paidPermitted:true,measuredGenerationPerDay:1000,providerAutomated:true,accountHealthy:true};
it("learns frequency from observations rather than fixed 15/20/200 or aggregate quotas",()=>{
  expect(analyzeFrequency(config,evidence)).toMatchObject({generation:220,publishing:220});
  expect(analyzeFrequency(config,{...evidence,history:Array.from({length:3},()=>({posts:7,views:700,engagements:7}))})).toMatchObject({generation:7,publishing:7});
  expect(analyzeFrequency(config,{...evidence,history:evidence.history.slice(0,2)})).toMatchObject({generation:0,publishing:0,reason:"FREQUENCY_DATA_REQUIRED"});
  expect(analyzeFrequency(config,{...evidence,history:[]})).toMatchObject({generation:0,publishing:0,reason:"FREQUENCY_DATA_REQUIRED"});
});
it("respects actual budgets, platform caps, health, provider throughput, assisted mode and permitted spacing",()=>{
  expect(analyzeFrequency({...config,dailyBudgetUsd:3},evidence).generation).toBe(3);
  expect(analyzeFrequency(config,{...evidence,publishCap:2}).publishing).toBe(2);
  expect(analyzeFrequency(config,{...evidence,publishCap:null}).publishing).toBe(0);
  expect(analyzeFrequency(config,{...evidence,measuredGenerationPerDay:17}).generation).toBe(17);
  expect(analyzeFrequency(config,{...evidence,providerAutomated:false}).generation).toBe(0);
  expect(analyzeFrequency(config,{...evidence,paidPermitted:false}).generation).toBe(0);
  expect(analyzeFrequency(config,{...evidence,accountHealthy:false}).generation).toBe(0);
  expect(analyzeFrequency({...config,dailyBudgetUsd:3},{...evidence,producedToday:2,budgetSpentToday:2}).generation).toBe(3);
  expect(analyzeFrequency({...config,minimumGapMinutes:60},evidence).publishing).toBe(24);
});
it("scales concurrency to measured resources and queues, deferring work under memory/CPU pressure",()=>{
  const snapshot={cpuUnits:64,cpuBusy:.25,freeBytes:64e9,totalBytes:80e9,rssBytes:1e9,measuredJobBytes:2e9,providerSlots:40,queueDepth:300};
  expect(adaptiveConcurrency(snapshot)).toBe(26);expect(adaptiveConcurrency({...snapshot,freeBytes:1e9})).toBe(0);
  expect(adaptiveConcurrency({...snapshot,cpuBusy:1})).toBe(0);expect(adaptiveConcurrency({...snapshot,providerSlots:2})).toBe(2);
  expect(adaptiveConcurrency({...snapshot,queueDepth:0})).toBe(0);
});
