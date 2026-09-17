import {evaluateCreativeRisk} from "../creative/risk";
import type {CreativeConcept} from "../creative/schemas";
import {COMPLIANCE_VERSION,type AIGCDisclosure,type ComplianceInput,type ComplianceIssue,type ComplianceResult,type TriStatus} from "./types";

const rejectRules:[RegExp,string][]=[
  [/รักษา|หายขาด|ป้องกันโรค|ลดน้ำหนักแน่นอน|เห็นผลทางการแพทย์/i,"UNSUPPORTED_MEDICAL_CLAIM"],
  [/รับประกัน(?:ผล|รายได้)|รวยแน่นอน|กำไรแน่นอน/i,"GUARANTEED_RESULT_OR_EARNINGS"],
  [/รีวิวจริงจากลูกค้า|ผู้ใช้ทุกคนยืนยัน/i,"FABRICATED_REVIEW"],
  [/ก่อน.?หลัง.*(?:รับรอง|แน่นอน)/i,"MISLEADING_BEFORE_AFTER"],
];
const reviewRules:[RegExp,string][]=[
  [/เหลือ\s*\d+\s*ชิ้น|วันนี้วันสุดท้าย|หมดใน\s*\d+\s*นาที/i,"UNVERIFIED_SCARCITY"],
  [/ดีที่สุด|อันดับ\s*1|เหนือกว่าทุกแบรนด์|100%/i,"UNSUPPORTED_SUPERLATIVE"],
];
const discountPattern=/(?:ลด(?:ราคา)?|ส่วนลด)\s*\d+\s*%|จาก\s*\d[\d,]*\s*(?:บาท)?\s*เหลือ\s*\d[\d,]*|โค้ดลด|ลดทันที/i;
const affiliateCtaPattern=/กดตะกร้า|สั่งซื้อ|ช้อปเลย|ลิงก์ซื้อ|รับคอมมิชชั่น/i;
const shopClaimPattern=/ร้านทางการ|official\s+shop|มี(?:สินค้าใน)?ตะกร้า|ซื้อผ่าน\s*tiktok\s*shop/i;
const severity=(issues:ComplianceIssue[]):TriStatus=>issues.some(i=>i.severity==="REJECT")?"REJECT":issues.some(i=>i.severity==="REVIEW")?"REVIEW":"PASS";

export function checkProductTruth(text:string,approvedFacts:string[]):{status:TriStatus;issues:ComplianceIssue[]} {
  const issues:ComplianceIssue[]=[];
  for(const [pattern,code] of rejectRules)if(pattern.test(text))issues.push({code,severity:"REJECT",message:"ข้อความมีคำกล่าวอ้างที่ไม่รองรับและห้ามเผยแพร่"});
  for(const [pattern,code] of reviewRules)if(pattern.test(text)&&!approvedFacts.some(f=>pattern.test(f)))issues.push({code,severity:"REVIEW",message:"ต้องมีหลักฐานสินค้าอนุมัติก่อนใช้ข้อความนี้"});
  if(discountPattern.test(text)&&!approvedFacts.some(f=>discountPattern.test(f)))issues.push({code:"UNVERIFIED_DISCOUNT",severity:"REJECT",message:"ส่วนลดหรือราคาที่กล่าวอ้างไม่มีอยู่ในข้อมูลสินค้าที่อนุมัติ"});
  return {status:severity(issues),issues};
}

export function determineAIGCDisclosure(input:Pick<ComplianceInput,"aiGenerated"|"aiModified"|"provider"|"providerRequiresDisclosure"|"platformRequiresDisclosure"|"provenanceAvailable">):AIGCDisclosure {
  const indicated=Boolean(input.providerRequiresDisclosure||input.platformRequiresDisclosure);
  return {ai_generated:input.aiGenerated,ai_modified:input.aiModified,disclosure_recommended:input.aiGenerated||input.aiModified,disclosure_required_if_provider_or_platform_indicates:indicated,provenance_available:Boolean(input.provenanceAvailable),provider:input.provider};
}

export function runContentComplianceCheck(input:ComplianceInput):ComplianceResult {
  const truth=checkProductTruth(input.text,input.approvedProductFacts),issues=[...truth.issues];
  if(input.mode==="GROWTH"&&affiliateCtaPattern.test(input.text))issues.push({code:"CTA_MODE_MISMATCH",severity:"REVIEW",message:"Growth mode ใช้ได้เฉพาะ CTA เพื่อ follow, save, comment หรือ engagement"});
  if(affiliateCtaPattern.test(input.text)&&!input.cartAvailable)issues.push({code:"CART_UNAVAILABLE",severity:"REJECT",message:"บัญชีนี้ยังใช้ตะกร้าสินค้าไม่ได้"});
  if(shopClaimPattern.test(input.text)&&(!input.cartAvailable||!input.affiliateAvailable))issues.push({code:"UNVERIFIED_SHOP_CLAIM",severity:"REJECT",message:"ห้ามอ้างว่ามีร้านค้าหรือตะกร้าเมื่อบัญชียังไม่มีสิทธิ์"});
  if(input.mode==="AFFILIATE"&&!input.affiliateAvailable)issues.push({code:"AFFILIATE_UNAVAILABLE",severity:"REJECT",message:"บัญชียังไม่มีสิทธิ์ Affiliate"});
  if(input.inheritedRisk==="REVIEW")issues.push({code:"CREATIVE_RISK_REVIEW",severity:"REVIEW",message:"Creative Brain ส่งต่อสถานะ REVIEW"});
  if(input.inheritedRisk==="REJECT")issues.push({code:"CREATIVE_RISK_REJECT",severity:"REJECT",message:"Creative Brain ส่งต่อสถานะ REJECT"});
  // Reuse the Creative Brain matcher so later pattern additions remain fail-closed here.
  const concept={hook:input.text,coreMessage:input.text,voiceScript:input.text,cta:"ตรวจสอบ",caption:"ตรวจสอบ",angleType:"DEMONSTRATION",visualStrategy:"ตรวจสอบ",overlay:[],scenes:[]} as unknown as CreativeConcept;
  const inherited=evaluateCreativeRisk(concept,input.approvedProductFacts.join(" "));
  if(inherited.status!=="SAFE"&&!issues.some(i=>i.code.startsWith("CREATIVE_RISK")))issues.push({code:"CREATIVE_RISK_PATTERN",severity:inherited.status,message:inherited.reasons.join("; ")});
  const aigc=determineAIGCDisclosure(input),aigcStatus=aigc.disclosure_required_if_provider_or_platform_indicates||aigc.disclosure_recommended?"DISCLOSE":"PASS";
  const policyStatus=severity(issues),overallStatus=policyStatus;
  return {claimStatus:truth.status,productTruthStatus:truth.status,aigcStatus,policyStatus,overallStatus,issues,aigc,version:COMPLIANCE_VERSION};
}
