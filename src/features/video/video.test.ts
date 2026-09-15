import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {CostRouter,chooseVideoStrategy} from "./cost-router";
import {masterJobKey,nextJobAttempt,variationJobKey,variationRunId} from "./jobs";
import {MockImageProvider,MockVideoProvider,MockVoiceProvider,TemplateVideoProvider} from "./providers";
import {DeterministicVideoQualityEvaluator} from "./quality";
import {FFmpegVideoRenderer} from "./renderer";
import {videoSimilarity} from "./similarity";
import {ownsVideoStoragePath,videoStoragePath} from "./storage";
import {COMMERCE_TEMPLATES,templateFor,variationPlan} from "./templates";
import type {SimilarityMetadata,VideoBudget,VideoRenderInput} from "./types";

const owner="11111111-1111-4111-8111-111111111111",baseBudget:VideoBudget={maxCostPerVideoUsd:.1,dailyVideoBudgetUsd:1,monthlyVideoBudgetUsd:10,spentTodayUsd:0,spentMonthUsd:0};
const renderInput:VideoRenderInput={productTitle:"Fixture A Growth Beauty",hook:"Stop scrolling",cta:"Save this",template:"POV",overlay:[{start:0,end:2,text:"Stop scrolling"},{start:2,end:5,text:"See the product"},{start:5,end:8,text:"Save this"}],scenes:[{start:0,end:2,visual:"Hook",motion:"zoom"},{start:2,end:5,visual:"Product demo",motion:"pan"},{start:5,end:8,visual:"CTA",motion:"hold"}]};

describe("Video Factory strategy and budgets",()=>{
  it("reuses approved masters before any generation",()=>expect(chooseVideoStrategy({existingApprovedMaster:true,hasUsableAssets:true,qualityRequirement:85,budget:baseBudget,availability:{freeCredit:true,lowCostPaid:true,premium:true,paidAllowed:true}}).strategy).toBe("REUSE_MASTER"));
  it("chooses local templates for usable assets",()=>expect(chooseVideoStrategy({existingApprovedMaster:false,hasUsableAssets:true,qualityRequirement:85,budget:baseBudget,availability:{freeCredit:false,lowCostPaid:true,premium:true,paidAllowed:true}})).toMatchObject({strategy:"LOCAL_TEMPLATE",estimatedCostUsd:0}));
  it("blocks paid generation when daily budget is reached but keeps local allowed",()=>{const router=new CostRouter(),budget={...baseBudget,spentTodayUsd:1};expect(router.canSpend(budget,.04)).toBe(false);expect(router.canSpend(budget,0)).toBe(true)});
  it("reserves paid adapters without calling them",async()=>{const provider=new MockVideoProvider();expect((await provider.plan(renderInput)).template).toBe("POV")});
});
describe("templates, master and variations",()=>{
  it("supports all eight commerce templates",()=>expect(COMMERCE_TEMPLATES.map(templateFor)).toEqual(COMMERCE_TEMPLATES));
  it("creates meaningful deterministic Growth, Home and Gadget fixture plans",()=>{const a=variationPlan(1,{...renderInput,productTitle:"Fixture A Growth Beauty"}),b=variationPlan(2,{...renderInput,productTitle:"Fixture B Affiliate Home"}),c=variationPlan(3,{...renderInput,productTitle:"Fixture C Affiliate Gadget"});expect(new Set([a.motionPattern,b.motionPattern,c.motionPattern]).size).toBe(3);expect(c.cta).toContain("ตอนนี้")});
  it("keeps template provider deterministic",async()=>expect(await new TemplateVideoProvider().plan(renderInput)).toEqual(renderInput));
});
describe("similarity, quality, jobs and storage",()=>{
  const meta:SimilarityMetadata={masterId:"m",hook:"h",cta:"c",scenes:renderInput.scenes,motion:{pattern:"zoom"},overlay:renderInput.overlay,audio:{voice:"mock"}};
  it("rejects fixture E near duplicates",()=>expect(videoSimilarity(meta,{...meta})).toMatchObject({score:1,accepted:false}));
  it("accepts controlled meaningful variation",()=>expect(videoSimilarity(meta,{...meta,hook:"new hook",cta:"new cta",motion:{pattern:"pan"},overlay:{position:"bottom"}}).accepted).toBe(true));
  it("passes valid output metadata and rejects fixture D broken output",()=>{const evaluator=new DeterministicVideoQualityEvaluator(),valid=evaluator.evaluate({path:"x",duration:8,width:1080,height:1920,fps:30,videoCodec:"h264",audioCodec:"aac",hasAudio:true,sizeBytes:100000,overlay:renderInput.overlay,scenes:renderInput.scenes,productVisible:true,ctaVisible:true,malformedAssets:false,inheritedRisk:"SAFE"}),broken=evaluator.evaluate({path:"x",duration:2,width:0,height:0,fps:0,videoCodec:"",audioCodec:null,hasAudio:false,sizeBytes:0,overlay:[],scenes:[],productVisible:false,ctaVisible:false,malformedAssets:true,inheritedRisk:"REJECT"});expect(valid).toMatchObject({score:100,status:"PASS"});expect(broken.status).toBe("REJECT")});
  it("uses stable run and idempotency keys with bounded retry state",()=>{const master="11111111-1111-4111-8111-111111111111";expect(masterJobKey("p","s")).toBe(masterJobKey("p","s"));expect(variationRunId(master)).toBe(variationRunId(master));expect(variationRunId(master)).toMatch(/^[0-9a-f-]{36}$/);expect(variationJobKey("v","r")).toBe(variationJobKey("v","r"));expect(nextJobAttempt(0,2).status).toBe("PROCESSING");expect(nextJobAttempt(1,2).status).toBe("RETRYING");expect(nextJobAttempt(2,2).allowed).toBe(false)});
  it("scopes private storage paths to the owner",()=>{const path=videoStoragePath(owner,"masters","m","video.mp4");expect(ownsVideoStoragePath(owner,path)).toBe(true);expect(ownsVideoStoragePath("22222222-2222-4222-8222-222222222222",path)).toBe(false)});
});
describe("real FFmpeg fallback",()=>{
  it("renders and probes a real eight-second vertical H.264/AAC MP4",async()=>{
    const dir=await mkdtemp(join(tmpdir(),"viralflow-ffmpeg-"));
    try{const image=await new MockImageProvider().createProductImage("Fixture A Growth Beauty",join(dir,"product.ppm")),voice=await new MockVoiceProvider().createVoiceTrack("test-safe generated voice",join(dir,"voice.wav"),8),renderer=new FFmpegVideoRenderer(),video=await renderer.render(renderInput,image.path,voice.path,join(dir,"fixture-a.mp4"));expect(video.duration).toBeGreaterThanOrEqual(7.95);expect(video.duration).toBeLessThanOrEqual(8.05);expect(video).toMatchObject({width:1080,height:1920,videoCodec:"h264",audioCodec:"aac",hasAudio:true});expect(video.fps).toBeCloseTo(30,1)}finally{await rm(dir,{recursive:true,force:true})}
  },60_000);
});
