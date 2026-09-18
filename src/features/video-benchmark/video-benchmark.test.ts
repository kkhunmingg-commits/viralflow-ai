import {describe,expect,it} from "vitest";
import {forecastCost,minimumForecastCost,selectCandidates,STAGE_ONE_CANDIDATES} from "./catalog";
import {applyHumanScores,chooseWinner,eligibleForSecondSample,evaluateTechnical,rankCandidates,scoreHuman} from "./rubric";
import type {BenchmarkSample,HumanScores} from "./types";

const media={path:"fixture.mp4",duration:8,width:720,height:1280,fps:30,videoCodec:"h264",audioCodec:null,hasAudio:false,sizeBytes:500_000};
const excellent:HumanScores={productIdentity:92,motionNaturalness:88,artifactControl:86,commercialSuitability:87,promptAdherence:90,visualAttractiveness:90,flowStatus:"FLOW_COMPARABLE"};
const sample=(candidateId:BenchmarkSample["candidateId"],id:string,cost:number):BenchmarkSample=>{const manual=candidateId==="meta_vibes"||candidateId==="google_flow_manual";return{id,fixtureId:id,candidateId,repeat:1,seed:1,expectedCostUsd:cost,actualCostUsd:cost,latencyMs:1000,taskId:id,inputPath:null,outputPath:`${id}.mp4`,technical:evaluateTechnical(media),human:null,humanScore:null,status:"COMPLETED",generationCount:1,quotaUsage:null,humanLaborRequired:manual,sourceKind:manual?"OWNER_MANUAL_IMPORT":"PROVIDER_API",error:null}};
describe("video-provider-benchmark-v1",()=>{
  it("forecasts the Google Flow reference plus Veo Lite stage before making calls",()=>{const stage=selectCandidates(STAGE_ONE_CANDIDATES);expect(forecastCost(stage,3,1)).toBe(1.2);expect(minimumForecastCost(stage,3,1)).toBe(1.2)});
  it("requires exact eight-second portrait technical output",()=>{expect(evaluateTechnical(media)).toMatchObject({passed:true,score:100});expect(evaluateTechnical({...media,duration:5,width:1280,height:720})).toMatchObject({passed:false,score:35})});
  it("weights product identity and motion ahead of polish",()=>expect(scoreHuman(excellent)).toBe(89.05));
  it("does not select a cheap provider before complete human review",()=>{const rows=[sample("gen4_turbo","a",.4),sample("gen4_turbo","b",.4)];expect(chooseWinner(rankCandidates(rows)).winner).toBeNull()});
  it("selects the cheapest candidate only after quality and consistency gates",()=>{let rows=[sample("fal_wan_2_2_turbo","a",.1),sample("fal_wan_2_2_turbo","b",.1),sample("gen4_turbo","c",.4),sample("gen4_turbo","d",.4)];rows=applyHumanScores(rows,Object.fromEntries(rows.map(row=>[row.id,excellent])),true);expect(chooseWinner(rankCandidates(rows)).winner).toBe("fal_wan_2_2_turbo")});
  it("blocks candidates with a weak fixture even when their average is high",()=>{let rows=[sample("gen4_turbo","a",.4),sample("gen4_turbo","b",.4)];rows=applyHumanScores(rows,{a:excellent,b:{...excellent,productIdentity:20,motionNaturalness:20,promptAdherence:20,commercialSuitability:20,artifactControl:20,visualAttractiveness:20}},true);expect(rankCandidates(rows)[0]?.eligible).toBe(false)});
  it("does not allow a Flow-equivalence label without the owner reference",()=>expect(()=>applyHumanScores([sample("gen4_turbo","a",.4)],{a:excellent},false)).toThrow(/reference clip/));
  it("allows a second sample only after technical and Flow comparison gates",()=>{const row=applyHumanScores([sample("fal_wan_2_2_turbo","a",.1)],{a:excellent},true)[0];expect(row&&eligibleForSecondSample(row,true)).toBe(true);expect(row&&eligibleForSecondSample(row,false)).toBe(false)});
  it("can score Meta quality but never selects a manual candidate for Auto Mode",()=>{const rows=applyHumanScores([sample("meta_vibes","meta",0)],{meta:excellent},true),ranking=rankCandidates(rows);expect(ranking[0]).toMatchObject({eligible:true,autoModeEligible:false});expect(chooseWinner(ranking).winner).toBeNull()});
  it("keeps owner-supplied Google Flow clips out of Auto Mode",()=>{const rows=applyHumanScores([sample("google_flow_manual","flow",0)],{flow:excellent},true),ranking=rankCandidates(rows);expect(ranking[0]).toMatchObject({eligible:true,autoModeEligible:false});expect(chooseWinner(ranking).winner).toBeNull()});
});
