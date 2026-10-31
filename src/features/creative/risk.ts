import type { CreativeConcept } from "./schemas";
import type { RiskStatus } from "./types";
const rejectPatterns=[/รักษา|หายขาด|ป้องกันโรค|ลดน้ำหนักแน่นอน/i,/รายได้.*รับประกัน|รวยแน่นอน/i,/ก่อน.?หลัง.*รับรอง/i,/รีวิวจริงจากลูกค้า/i];
const reviewPatterns=[/ดีที่สุด|อันดับหนึ่ง|100%|ของแท้แน่นอน/i,/เหลือ.*ชิ้น|วันนี้วันสุดท้าย|หมดใน.*นาที/i];
export function evaluateCreativeRisk(concept:CreativeConcept,contextText=""):{status:RiskStatus;reasons:string[]} {
  const text=[concept.hook,concept.coreMessage,concept.voiceScript,concept.cta,concept.caption].join(" ");
  const reasons:string[]=[];
  if(rejectPatterns.some(p=>p.test(text)))reasons.push("Unsupported medical, earnings, transformation, or testimonial claim");
  if(reviewPatterns.some(p=>p.test(text))&&!reviewPatterns.some(p=>p.test(contextText)))reasons.push("Unverified superlative or scarcity claim");
  return {status:reasons.some(r=>r.startsWith("Unsupported"))?"REJECT":reasons.length?"REVIEW":"SAFE",reasons};
}

