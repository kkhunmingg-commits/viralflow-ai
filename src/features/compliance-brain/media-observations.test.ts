import { describe, expect, it } from "vitest";
import { appendMediaObservations, compactThaiOcr, localMediaObservationSchema, type LocalMediaObservation } from "./media-observations";
import { ComplianceEngine } from "./engine";
import { createPolicyTestPayload } from "./policy-test-fixtures";
import { holdoutInput } from "./holdout-corpus";

export const observation = (): LocalMediaObservation => ({ schemaVersion:1, assetHash:"a".repeat(64), durationSeconds:8,
  coverageComplete:false,evidenceVerified:false,frames:[{timeSeconds:0,text:"รักษาสิวหายขาด",confidence:91,
    comparisonCandidate:false,contrast:40,sharpness:35}],audioStatus:"UNAVAILABLE",
  uncertainties:["SAMPLED_FRAMES_ONLY","VISUAL_SEMANTICS_UNVERIFIED","AUDIO_UNVERIFIED"] });
describe("local media observations remain an additional fail-closed layer",()=>{
  it("inspects Thai OCR spaces without inventing missing glyphs or changing English word boundaries",()=>{
    expect(compactThaiOcr("ร ั ก ษา ส ิ ว จ น ห า ย ขา ด")).toBe("รักษาสิวจนหายขาด");
    expect(compactThaiOcr("does not cure acne")).toBe("does not cure acne");
    expect(compactThaiOcr("ค ร ี ม น ี")).toBe("ครีมนี");
  });
  it("appends real observations rather than replacing the trusted transcript or intended caption",()=>{
    const merged=appendMediaObservations({caption:"ตรวจสอบข้อมูลสินค้า",transcript:"ข้อความเดิม",onScreenText:["ฉลากเดิม"]},
      {...observation(),transcript:"เสียงที่อ้างว่ารักษาสิว"},"a".repeat(64));
    expect(merged.onScreenText).toEqual(["ฉลากเดิม","รักษาสิวหายขาด"]);
    expect(merged.transcript).toBe("ข้อความเดิม\nเสียงที่อ้างว่ารักษาสิว");expect(merged.caption).toBe("ตรวจสอบข้อมูลสินค้า");
  });
  it("rejects a different asset and cannot elevate an observation into verified evidence",()=>{
    expect(()=>appendMediaObservations({},observation(),"b".repeat(64))).toThrow("MEDIA_OBSERVATION_ASSET_MISMATCH");
    expect(localMediaObservationSchema.safeParse({...observation(),coverageComplete:true}).success).toBe(false);
    expect(localMediaObservationSchema.safeParse({...observation(),evidenceVerified:true}).success).toBe(false);
    expect(localMediaObservationSchema.safeParse({...observation(),signature:"invented"}).success).toBe(false);
    expect(localMediaObservationSchema.safeParse({...observation(),audioStatus:"OBSERVED",transcript:""}).success).toBe(false);
  });
  it("rejects out-of-order timestamps, excessive frames and unreadable malformed results",()=>{
    const f=observation().frames[0];
    expect(localMediaObservationSchema.safeParse({...observation(),frames:[f,f]}).success).toBe(false);
    expect(localMediaObservationSchema.safeParse({...observation(),frames:[{...f,confidence:101}]}).success).toBe(false);
    expect(localMediaObservationSchema.safeParse({...observation(),frames:Array(61).fill(f)}).success).toBe(false);
  });
  it("OCR text goes through the same semantic authority, not a test-only safe path",async()=>{
    const input=holdoutInput("ตรวจสอบข้อมูลสินค้า","SKINCARE","POST"),obs=observation();
    const engine=new ComplianceEngine({policy:async()=>createPolicyTestPayload()});
    const decision=await engine.evaluate({...input,stage:"FINAL_PUBLISH",content:appendMediaObservations(input.content,obs,obs.assetHash),
      media:{assetHash:obs.assetHash,coverageComplete:false,evidenceRefs:[]}});
    expect(decision.status).toBe("BLOCK");
  });
  it("blank text, low confidence and comparison layouts cannot assert visual safety",async()=>{
    const input=holdoutInput("ตรวจสอบข้อมูลสินค้า","SKINCARE","POST"),obs=observation();
    obs.frames[0]={...obs.frames[0],text:"",confidence:0,comparisonCandidate:true};
    const decision=await new ComplianceEngine({policy:async()=>createPolicyTestPayload()}).evaluate({...input,stage:"FINAL_PUBLISH",
      content:appendMediaObservations(input.content,obs,obs.assetHash),media:{assetHash:obs.assetHash,coverageComplete:false,evidenceRefs:[]}});
    expect(decision.status).toBe("REVIEW_REQUIRED");
  });
});
