import {describe,expect,it} from "vitest";
import {BENCHMARK_CANDIDATES,forecastCost} from "./catalog";
import {applyHumanScores,chooseWinner,evaluateTechnical,rankCandidates,scoreHuman} from "./rubric";
import type {BenchmarkSample,HumanScores} from "./types";

const media={path:"fixture.mp4",duration:8,width:720,height:1280,fps:30,videoCodec:"h264",audioCodec:null,hasAudio:false,sizeBytes:500_000};
const excellent:HumanScores={productIdentity:92,motionRealism:88,promptAdherence:90,commerceClarity:87,artifactControl:86,visualPolish:90};
const sample=(candidateId:BenchmarkSample["candidateId"],id:string,cost:number):BenchmarkSample=>({id,fixtureId:id,candidateId,repeat:1,seed:1,expectedCostUsd:cost,actualCostUsd:cost,latencyMs:1000,taskId:id,outputPath:`${id}.mp4`,technical:evaluateTechnical(media),human:null,humanScore:null,status:"COMPLETED",error:null});
describe("video-provider-benchmark-v1",()=>{
  it("forecasts the complete paid run before making calls",()=>expect(forecastCost(BENCHMARK_CANDIDATES,3,2)).toBe(21.72));
  it("requires exact eight-second portrait technical output",()=>{expect(evaluateTechnical(media)).toMatchObject({passed:true,score:100});expect(evaluateTechnical({...media,duration:5,width:1280,height:720})).toMatchObject({passed:false,score:40})});
  it("weights product identity and motion ahead of polish",()=>expect(scoreHuman(excellent)).toBe(89.05));
  it("does not select a cheap provider before complete human review",()=>{const rows=[sample("gen4_turbo","a",.4),sample("gen4_turbo","b",.4)];expect(chooseWinner(rankCandidates(rows)).winner).toBeNull()});
  it("selects the cheapest candidate only after quality and consistency gates",()=>{let rows=[sample("gen4_turbo","a",.4),sample("gen4_turbo","b",.4),sample("h3_max_768","c",.64),sample("h3_max_768","d",.64)];rows=applyHumanScores(rows,Object.fromEntries(rows.map(row=>[row.id,excellent])));expect(chooseWinner(rankCandidates(rows)).winner).toBe("gen4_turbo")});
  it("blocks candidates with a weak fixture even when their average is high",()=>{let rows=[sample("gen4_turbo","a",.4),sample("gen4_turbo","b",.4)];rows=applyHumanScores(rows,{a:excellent,b:{...excellent,productIdentity:20,motionRealism:20,promptAdherence:20,commerceClarity:20,artifactControl:20,visualPolish:20}});expect(rankCandidates(rows)[0]?.eligible).toBe(false)});
});
