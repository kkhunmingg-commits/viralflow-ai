import { describe,expect,it } from "vitest";
import { buildCreativeContext } from "./context";
import { estimateCreativeGenerationCost } from "./cost";
import { creativeFixture } from "./fixtures";
import { canStartCreativeProject,nextProjectStatus } from "./lifecycle";
import { buildCreativePrompt } from "./prompts";
import { MockAIProvider,generateValidated } from "./providers";
import { evaluateCreativeRisk } from "./risk";
import { creativeConceptSchema } from "./schemas";
import { scoreCreativeConcept,validateDiversity } from "./scoring";

describe("creative-brain-v1",()=>{
  it("builds compact context without irrelevant account fields",()=>{
    const context=creativeFixture();
    expect(context.account).toEqual(expect.objectContaining({mode:"GROWTH",name:"Account A"}));
    expect(context.product).toEqual(expect.objectContaining({category:"beauty"}));
    expect(context).not.toHaveProperty("account.authorization_status");
    expect(buildCreativeContext).toBeTypeOf("function");
  });
  it("Growth Beauty produces engagement and follow concepts",async()=>{
    const context=creativeFixture("GROWTH","beauty"),generated=await generateValidated(new MockAIProvider(context),buildCreativePrompt(context));
    expect(generated.output.concepts).toHaveLength(5);
    expect(generated.output.concepts.some(c=>/ติดตาม|เซฟ|คอมเมนต์|ดูอีก/.test(c.cta))).toBe(true);
    expect(generated.output.concepts.every(c=>!c.cta.includes("ตะกร้า"))).toBe(true);
  });
  it.each([["home",/ตะกร้า|เช็กราคา/],["gadgets",/สาธิต|เทียบ|เดโม/i]])("Affiliate %s uses commerce/demo strategy",async(category,pattern)=>{
    const context=creativeFixture("AFFILIATE",category),{output}=await generateValidated(new MockAIProvider(context),buildCreativePrompt(context));
    expect(output.concepts.some(c=>pattern.test(c.cta+" "+c.coreMessage+" "+c.title))).toBe(true);
  });
  it("validates exact 8-second contiguous timing",async()=>{
    const context=creativeFixture(),{output}=await generateValidated(new MockAIProvider(context),buildCreativePrompt(context));
    expect(output.concepts.every(c=>creativeConceptSchema.safeParse(c).success)).toBe(true);
    const invalid={...output.concepts[0],scenePlan:[{start:0,end:2,visual:"x",motion:"x"},{start:3,end:5,visual:"y",motion:"y"},{start:5,end:9,visual:"z",motion:"z"}]};
    expect(creativeConceptSchema.safeParse(invalid).success).toBe(false);
  });
  it("five concepts pass deterministic diversity thresholds",async()=>{
    const context=creativeFixture(),{output}=await generateValidated(new MockAIProvider(context),buildCreativePrompt(context));
    expect(validateDiversity(output.concepts)).toEqual(expect.objectContaining({valid:true,angleCount:5,hookCount:5,ctaCount:5,sceneCount:5}));
  });
  it("scores with deterministic rules and penalizes risky claims",async()=>{
    const context=creativeFixture(),{output}=await generateValidated(new MockAIProvider(context),buildCreativePrompt(context));
    const safe=scoreCreativeConcept(output.concepts[0],context);
    const risky={...output.concepts[0],voiceScript:"รักษาโรคหายขาดแน่นอน"};
    const rejected=scoreCreativeConcept(risky,context);
    expect(safe.score).toBeGreaterThan(rejected.score);expect(rejected.riskStatus).toBe("REJECT");
  });
  it("flags fake scarcity and unsupported claims",async()=>{
    const context=creativeFixture(),{output}=await generateValidated(new MockAIProvider(context),buildCreativePrompt(context));
    expect(evaluateCreativeRisk({...output.concepts[0],cta:"เหลือ 2 ชิ้น วันนี้วันสุดท้าย"}).status).toBe("REVIEW");
    expect(evaluateCreativeRisk({...output.concepts[0],caption:"รายได้ รับประกัน รวยแน่นอน"}).status).toBe("REJECT");
  });
  it("blocks low-data assignments and enforces lifecycle",()=>{
    expect(canStartCreativeProject({final_score:0,status:"BLOCKED"})).toBe(false);
    expect(canStartCreativeProject({final_score:80,status:"CANDIDATE"})).toBe(true);
    expect(nextProjectStatus("DRAFT","GENERATE")).toBe("GENERATING");
    expect(nextProjectStatus("GENERATING","GENERATED")).toBe("READY");
    expect(nextProjectStatus("READY","SELECT")).toBe("SELECTED");
    expect(()=>nextProjectStatus("ARCHIVED","GENERATE")).toThrow();
  });
  it("tracks mock and economical model costs",()=>{
    expect(estimateCreativeGenerationCost("viralflow-deterministic-v1",1000,1000)).toBe(0);
    expect(estimateCreativeGenerationCost("gpt-5.4-nano",1_000_000,1_000_000)).toBe(1.45);
  });
});
