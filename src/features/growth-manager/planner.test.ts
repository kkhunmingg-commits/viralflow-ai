import { describe,it,expect } from "vitest";
import { accountAutomationSchema } from "../multi-account/contracts";
import { pilotPolicySchema,type GrowthEvidence,type GrowthPost } from "./contracts";
import { analyzeGrowth,growthSlots } from "./planner";
const now=new Date("2026-10-12T00:00:00Z"),config=accountAutomationSchema.parse({timezone:"UTC"}),policy=pilotPolicySchema.parse({topics:["home tips","learning"]});
const observed=(views:number[],opts:Partial<GrowthPost>={}):GrowthPost[]=>views.map((v,i)=>({id:String(i),source:"TIKTOK_DISPLAY",confidence:.95,publishedAt:new Date(now.getTime()-(views.length-i+1)*86400000).toISOString(),capturedAt:new Date(now.getTime()-(views.length-i)*86400000).toISOString(),views:v,likes:v*.1,comments:v*.01,shares:v*.02,topic:"home tips",...opts}));
const evidence=(posts:GrowthPost[]=[],extra:Partial<GrowthEvidence>={}):GrowthEvidence=>({posts,followers:[],accountHealth:"READY",publicApiEligible:false,publishCap:null,publishedToday:0,prior:null,...extra});
describe("data-led Growth Pilot",()=>{
 it("resumes a small trial after a data wait, without restarting a performance pause",()=>{
  const prior={count:0,changedAt:"2026-10-10T00:00:00Z",evidenceIds:[],reason:"FOLLOWERS_UNKNOWN"};
  expect(analyzeGrowth(config,policy,evidence([],{prior}),now).recommended).toBe(1);
  expect(analyzeGrowth(config,policy,evidence([],{prior:{...prior,reason:"SUSTAINED_DECLINE"}}),now).recommended).toBe(0);
 });
 it("cold start is a small explicit experiment, not a claim of safe public API permission",()=>{
  const d=analyzeGrowth(config,policy,evidence(),now);expect(d).toMatchObject({recommended:1,action:"COLD_START",transport:"MANUAL_PUBLIC",confidence:0});
  expect(d.metrics).toMatchObject({viewsPerClip:null,startingFollowers:null,currentFollowers:null,retention:null,completionRate:null,followersPer1000Views:null});
 });
 it("sparse history keeps an experiment instead of escalating",()=>{
  expect(analyzeGrowth(config,policy,evidence(observed([100,9000])),now)).toMatchObject({recommended:1,action:"COLD_START",reason:"SMALL_SAMPLE"});
 });
 it("raises slowly only after repeated improvement, sample coverage and known limits",()=>{
  const prior={count:1,changedAt:"2026-10-01T00:00:00Z",evidenceIds:[]};
  expect(analyzeGrowth(config,policy,evidence(observed([100,100,100,400,400,400]),{publishCap:15,prior}),now)).toMatchObject({recommended:2,action:"INCREASE"});
  expect(analyzeGrowth(config,policy,evidence(observed([100,100,100,100,100,50000]),{publishCap:15,prior}),now).recommended).toBe(1);
  expect(analyzeGrowth(config,policy,evidence(observed([100,100,100,400,400,400]),{prior}),now)).toMatchObject({recommended:1,reason:"LIMIT_UNKNOWN_NO_INCREASE"});
 });
 it("decreases or pauses persistent weak response and does not overreact to the same evidence",()=>{
  const posts=observed([500,500,500,100,100,100]),prior={count:2,changedAt:"2026-10-01T00:00:00Z",evidenceIds:[]};
  expect(analyzeGrowth(config,policy,evidence(posts,{prior,publishCap:15}),now)).toMatchObject({recommended:1,action:"REDUCE"});
  expect(analyzeGrowth(config,policy,evidence(posts,{prior:{...prior,count:1},publishCap:15}),now)).toMatchObject({recommended:0,action:"PAUSE"});
  expect(analyzeGrowth(config,policy,evidence(posts,{prior:{...prior,evidenceIds:posts.map(p=>p.id)},publishCap:15}),now).recommended).toBe(2);
 });
 it("blocks health warnings/unknowns and respects zero cap and insufficient windows",()=>{
  for(const accountHealth of ["WARNING","UNKNOWN"] as const)expect(analyzeGrowth(config,policy,evidence([],{accountHealth}),now)).toMatchObject({recommended:0,action:"OWNER_REVIEW"});
  expect(analyzeGrowth(config,policy,evidence([],{accountHealth:"BLOCKED"}),now).action).toBe("PAUSE");
  expect(analyzeGrowth(config,policy,evidence([],{publishCap:0}),now).recommended).toBe(0);
  expect(analyzeGrowth({...config,spreadFullDay:false,windows:[{start:600,end:630}]},policy,evidence(),now).recommended).toBe(0);
 });
 it("ignores MOCK, duplicate, stale and insufficiently matured observations",()=>{
  const posts=observed([100,100,100,400,400,400]);
  expect(analyzeGrowth(config,policy,evidence(posts.map(p=>({...p,source:"MOCK"}))),now).metrics.viewsPerClip).toBeNull();
  const d=analyzeGrowth(config,policy,evidence([...posts,...posts]),now);expect(d.evidenceIds).toHaveLength(6);
  expect(analyzeGrowth(config,policy,evidence(observed([100],{capturedAt:"2026-01-01T00:00:00Z"})),now).metrics.viewsPerClip).toBeNull();
  expect(analyzeGrowth(config,policy,evidence(observed([100],{capturedAt:"2026-10-20T00:00:00Z"})),now).metrics.viewsPerClip).toBeNull();
 });
 it("known declining retention/interaction vetoes view-led growth; unknown is not invented",()=>{
  const posts=observed([100,100,100,400,400,400]).map((p,i)=>({...p,retention:i<3?.8:.2}));
  expect(analyzeGrowth(config,policy,evidence(posts,{publishCap:15,prior:{count:1,changedAt:"2026-10-01T00:00:00Z",evidenceIds:[]}}),now)).toMatchObject({recommended:1,reason:"QUALITY_SIGNAL_DECLINE"});
  expect(analyzeGrowth(config,policy,evidence(posts.map(p=>({...p,views:null}))),now).metrics.viewsPerClip).toBeNull();
 });
 it("keeps follower attribution unknown instead of assigning an account delta to videos",()=>{
  const followers=[{count:10,at:"2026-10-10T00:00:00Z",source:"TIKTOK_DISPLAY" as const},{count:15,at:now.toISOString(),source:"TIKTOK_DISPLAY" as const}];
  const d=analyzeGrowth(config,policy,evidence(observed([100,100,100,200,200,200]),{followers}),now);
  expect(d.metrics).toMatchObject({startingFollowers:10,currentFollowers:15,netFollowers:5,followersPer1000Views:null,followerConversionRate:null});
 });
 it("uses repeated real audience observations, rotates cold-start time bands and preserves gaps",()=>{
  const d=analyzeGrowth(config,policy,evidence(),now),hours=new Set<number>();
  for(let i=0;i<3;i++){const day=new Date(now.getTime()+i*86400000),slots=growthSlots("owner","new",config,policy,d,day,"persisted");expect(slots).toHaveLength(1);hours.add(Math.floor(new Date(slots[0].at).getUTCHours()/8));expect(growthSlots("owner","new",config,policy,d,day,"persisted")).toEqual(slots);}
  expect(hours.size).toBe(3);
  const slots=growthSlots("owner","new",config,policy,{...d,recommended:3},now,"persisted");
  for(let i=1;i<slots.length;i++)expect(Date.parse(slots[i].at)-Date.parse(slots[i-1].at)).toBeGreaterThanOrEqual(policy.minimumGapMinutes*60000);
  expect(growthSlots("owner","new",config,policy,{...d,lastPublishedAt:now.toISOString()},now,"persisted").every(s=>Date.parse(s.at)>=now.getTime()+policy.minimumGapMinutes*60000)).toBe(true);
 });
 it("public API review requires real eligibility; a recommendation never creates consent",()=>{
  const d=analyzeGrowth(config,policy,evidence([],{publicApiEligible:true,publishCap:2}),now);expect(d.transport).toBe("API_REVIEW");
  expect(growthSlots("owner","new",config,policy,d,now,"persisted")[0].state).toBe("ASSISTED");
 });
});
