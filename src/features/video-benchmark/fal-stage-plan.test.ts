import {describe,expect,it} from "vitest";
import {selectFalStageFixtures} from "./fal-stage-plan";
import type {CommerceScores} from "./commerce-rubric";
import type {BenchmarkFixture,BenchmarkSample} from "./types";

const fixtures=["beauty","home","gadget"].map(id=>({id})) as BenchmarkFixture[];
const models=["fal_ltx_distilled"] as const;
const review:CommerceScores={productIdentity:95,packagingFidelity:95,motion:90,anatomy:null,temporalConsistency:95,commercialAppeal:90,composition:95,notes:[],reviewedBy:"OWNER"};
const sample={id:"fal_ltx_distilled:beauty:1",candidateId:models[0],fixtureId:"beauty",repeat:1,status:"COMPLETED",sourceKind:"PROVIDER_API",technical:{passed:true}} as BenchmarkSample;
const base={fixtures,models:[...models],execute:true,allFixtures:false};
describe("minimal fal comparison stage",()=>{
  it("uses one identical product by default",()=>{expect(selectFalStageFixtures(base)).toEqual([fixtures[0]])});
  it("permits a no-cost full forecast without pretending review has passed",()=>{expect(selectFalStageFixtures({...base,execute:false,allFixtures:true})).toEqual(fixtures)});
  it("blocks extra paid products until the first sample is technically and commercially usable",()=>{
    expect(()=>selectFalStageFixtures({...base,allFixtures:true,priorSamples:[sample]})).toThrow(/commercial review/);
    expect(()=>selectFalStageFixtures({...base,allFixtures:true,priorSamples:[sample],reviews:{[sample.id]:{...review,productIdentity:70}}})).toThrow(/commercial review/);
    expect(()=>selectFalStageFixtures({...base,allFixtures:true,priorSamples:[{...sample,technical:{...sample.technical!,passed:false}}],reviews:{[sample.id]:review}})).toThrow(/commercial review/);
  });
  it("permits the remaining products only after real first-sample review",()=>{expect(selectFalStageFixtures({...base,allFixtures:true,priorSamples:[sample],reviews:{[sample.id]:review}})).toEqual(fixtures)});
  it("requires every selected model to pass before another product is paid",()=>{expect(()=>selectFalStageFixtures({...base,models:[...models,"fal_wan_2_6_flash"],allFixtures:true,priorSamples:[sample],reviews:{[sample.id]:review}})).toThrow(/commercial review/)});
});
