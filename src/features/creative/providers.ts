import { z } from "zod";
import { creativeOutputSchema,type CreativeConcept } from "./schemas";
import type { AIProvider,CreativeContext,ProviderResult } from "./types";
import { buildRepairPrompt } from "./prompts";
import { validateDiversity } from "./scoring";

const scene=(hook:string,middle:string,cta:string,kind:number)=>[
  {start:0,end:2,visual:hook,motion:["snap zoom","handheld reveal","top-down drop","quick pan","match cut"][kind]},
  {start:2,end:5,visual:middle,motion:["close-up demo","before/use contrast","feature callout","side-by-side","three-step cut"][kind]},
  {start:5,end:8,visual:cta,motion:["freeze frame","point to text","product hero","swipe cue","loop to opening"][kind]},
];
function concept(angleType:CreativeConcept["angleType"],title:string,hook:string,coreMessage:string,cta:string,index:number,hashtags:string[]):CreativeConcept {
  return {angleType,title,hook,coreMessage,voiceScript:`${hook} ${coreMessage} ${cta}`.slice(0,180),
    overlayText:[{start:0,end:2,text:hook},{start:2,end:5,text:coreMessage.slice(0,70)},{start:5,end:8,text:cta}],
    scenePlan:scene(`เปิดด้วย ${hook}`,`สาธิต ${coreMessage}`,`ปิดด้วย ${cta}`,index),
    cta,caption:`${title} — ${coreMessage}`,hashtags,visualStrategy:`ถ่ายแนวตั้ง แสงธรรมชาติ เน้นสินค้าและมือผู้ใช้ มุมที่ ${index+1}`,
    modelSignals:{hookStrength:88-index,novelty:86-index*2,visualFeasibility:94-index}};
}
function mockConcepts(context:CreativeContext):CreativeConcept[] {
  const p=context.product.title,category=context.product.category;
  if(context.account.mode==="GROWTH")return [
    concept("POV",`POV เจอ ${p}`,`POV: ของชิ้นนี้ทำอะไรได้?`,`โชว์ผลลัพธ์จริงใน 3 วิ`,"ติดตามไว้ดูของน่าใช้ชิ้นต่อไป",0,[`#${category}`,"#ของน่าใช้","#TikTokพาเพลิน"]),
    concept("MUST_HAVE",`ของมันต้องมี?`,`หยุดก่อน—นี่อาจเป็นของที่ขาด`,`เปิดใช้ให้เห็นจุดเด่นแบบไม่พูดเกินจริง`,"เซฟไว้เทียบก่อนตัดสินใจ",1,[`#${category}`,"#MustHave","#ไอเดียดี"]),
    concept("PROBLEM_SOLUTION",`แก้จุดกวนใจ`,`เคยเจอปัญหานี้ไหม?`,`${p} ช่วยให้ขั้นตอนง่ายขึ้นอย่างไร`,"คอมเมนต์ว่าคุณเจอแบบนี้ไหม",2,[`#${category}`,"#ProblemSolution","#แชร์ไอเดีย"]),
    concept("DEMONSTRATION",`เดโม 3 วินาที`,`ดูมือเดียวก็รู้เรื่อง`,`สาธิตวิธีใช้และภาพระยะใกล้`,"ดูอีกครั้งแล้วลองทำตาม",3,[`#${category}`,"#QuickDemo","#ดูให้จบ"]),
    concept("COMPARISON",`ก่อนใช้ vs ตอนใช้`,`ต่างกันตรงไหนใน 3 วิ?`,`เทียบขั้นตอนโดยไม่อ้างผลเกินข้อมูล`,"แชร์ให้เพื่อนที่ต้องใช้",4,[`#${category}`,"#เปรียบเทียบ","#ของดีบอกต่อ"]),
  ];
  const commerce=context.product.originalPrice&&context.product.originalPrice>context.product.price
    ?`เทียบราคาปกติ ${context.product.originalPrice} กับตอนนี้ ${context.product.price} บาท`
    :`แสดงราคา ${context.product.price} บาทพร้อมประโยชน์ที่ได้`;
  const demo=context.product.category==="gadgets"?"สาธิตปุ่ม การจับ และผลลัพธ์บนหน้าจอ":"สาธิตการใช้จริงและจุดที่ช่วยลดขั้นตอน";
  return [
    concept("PROBLEM_SOLUTION",`${p} แก้อะไร`,`มีปัญหานี้อยู่หรือเปล่า?`,demo,"กดดูรายละเอียดในตะกร้า",0,[`#${category}`,"#ของใช้ดี","#ป้ายยา"]),
    concept("PRICE_SHOCK",`คุ้มตรงไหน`,`ราคานี้ได้อะไรบ้าง?`,commerce,"เช็กราคาปัจจุบันก่อนตัดสินใจ",1,[`#${category}`,"#เช็กราคา","#ดีลน่าดู"]),
    concept("DEMONSTRATION",`เดโมก่อนซื้อ`,`8 วิรู้เลยว่าใช้ยังไง`,demo,"กดดูสเปกและสินค้าในตะกร้า",2,[`#${category}`,"#Demo","#รีวิวของใช้"]),
    concept("COMPARISON",`เทียบให้เห็น`,`แบบเดิมกับชิ้นนี้ต่างกันยังไง?`,`เทียบจำนวนขั้นตอนและการใช้งานจริง`,"ดูตัวเลือกและราคาที่ตะกร้า",3,[`#${category}`,"#Comparison","#เลือกให้คุ้ม"]),
    concept("REVIEW_DISCOVERY",`ลองใช้ให้ดู`,`ก่อนกดซื้อ มาดูของจริง`,`โชว์วัสดุ ขนาด และวิธีใช้โดยไม่แต่งคำรีวิว`,"กดดูรายละเอียดเพิ่มเติม",4,[`#${category}`,"#ลองให้ดู","#ช้อปอย่างมีข้อมูล"]),
  ];
}
export class MockAIProvider implements AIProvider {
  readonly provider="mock";readonly model="viralflow-deterministic-v1";
  constructor(private context:CreativeContext){}
  async generate():Promise<ProviderResult>{
    const output={concepts:mockConcepts(this.context)};
    return {raw:output,output,usage:{inputTokens:Math.ceil(JSON.stringify(this.context).length/4),outputTokens:Math.ceil(JSON.stringify(output).length/4)}};
  }
}
export class OpenAIProvider implements AIProvider {
  readonly provider="openai";
  constructor(private apiKey:string,readonly model="gpt-5.4-nano"){}
  async generate(prompt:string):Promise<ProviderResult>{
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":`Bearer ${this.apiKey}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:this.model,store:false,instructions:"Return safe, diverse Thai creative concepts.",input:prompt,
        text:{format:{type:"json_schema",name:"creative_concepts",strict:true,schema:z.toJSONSchema(creativeOutputSchema)}}})});
    const raw=await response.json();if(!response.ok)throw new Error(`OpenAI generation failed (${response.status})`);
    const body=raw as {output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>;usage?:{input_tokens?:number;output_tokens?:number}};
    const text=body.output_text??body.output?.flatMap(i=>i.content??[]).find(c=>c.type==="output_text")?.text;
    if(!text)throw new Error("OpenAI response contained no structured text");
    return {raw,output:JSON.parse(text),usage:{inputTokens:body.usage?.input_tokens??0,outputTokens:body.usage?.output_tokens??0}};
  }
}
export async function generateValidated(provider:AIProvider,prompt:string) {
  let result=await provider.generate(prompt,false);
  let parsed=creativeOutputSchema.safeParse(result.output);
  let issue=parsed.success?(validateDiversity(parsed.data.concepts).valid?null:"Concepts are too similar"):z.prettifyError(parsed.error);
  if(issue){result=await provider.generate(buildRepairPrompt(prompt,issue),true);parsed=creativeOutputSchema.safeParse(result.output);issue=parsed.success?(validateDiversity(parsed.data.concepts).valid?null:"Concepts remain too similar"):z.prettifyError(parsed.error);}
  if(!parsed.success||issue)throw new Error(issue??"Creative output validation failed");
  return {result,output:parsed.data};
}

