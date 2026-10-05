import {describe,expect,it} from "vitest";
import {DeterministicVideoQualityEvaluator} from "./quality";
import type {VideoQualityInput} from "./types";
const input:VideoQualityInput={path:"verified.mp4",duration:10,targetDurationSeconds:10,width:720,height:1280,fps:30,videoCodec:"h264",audioCodec:"aac",hasAudio:true,sizeBytes:100000,
  overlay:[{start:7,end:10,text:"ดูสินค้า"}],scenes:[{start:0,end:2,visual:"hook",motion:"hold"},{start:2,end:7,visual:"product",motion:"pan"},{start:7,end:10,visual:"cta",motion:"hold"}],productVisible:true,ctaVisible:true,malformedAssets:false,inheritedRisk:"SAFE",
  visualVerification:{status:"PASS",reason:"FRAME_CHECKS_PASSED",reasons:[],provider:"network-boundary-test",model:"test",productVisible:true,ctaVisible:true,checks:{shape:"PASS",colors:"PASS",packaging:"PASS",details:"PASS",deformation:"PASS",visibleText:"PASS",commercialSafety:"PASS"},evidence:[.75,4,7.25].map(atSeconds=>({atSeconds,sha256:"a".repeat(64)}))}};
describe("configurable video quality policy",()=>{
  it("accepts a real ten-second target without weakening the default eight-second gate",()=>{const evaluator=new DeterministicVideoQualityEvaluator();expect(evaluator.evaluate(input)).toMatchObject({status:"PASS",score:100});expect(evaluator.evaluate({...input,targetDurationSeconds:undefined}).status).toBe("RETRY")});
  it("applies stricter thresholds without bypassing product checks",()=>{const evaluator=new DeterministicVideoQualityEvaluator(),noAudio={...input,hasAudio:false};expect(evaluator.evaluate(noAudio)).toMatchObject({status:"PASS",score:95});expect(evaluator.evaluate({...noAudio,qualityThreshold:96}).status).toBe("RETRY");expect(evaluator.evaluate({...input,visualVerification:{...input.visualVerification!,status:"FAIL"}}).status).toBe("REJECT")});
  it("rejects invalid thresholds rather than silently lowering safety",()=>{for(const qualityThreshold of [0,84,101,NaN])expect(()=>new DeterministicVideoQualityEvaluator().evaluate({...input,qualityThreshold})).toThrow("video_quality_policy_invalid")});
});
