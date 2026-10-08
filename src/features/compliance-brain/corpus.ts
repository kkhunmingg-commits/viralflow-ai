import type {ComplianceChannel,ComplianceDecisionStatus,ComplianceInput,ProductClaim,ProductEvidence} from "./contracts";
import {POLICY_TEST_NOW} from "./policy-test-fixtures";

/** Isolated regression data. Expectations describe the synthetic verified test pack. */
export interface ComplianceCorpusCase {
  id:string;category:"skincare"|"general"|"electronics";text:string;
  approvedClaim?:string;aliases?:string[];expected:ComplianceDecisionStatus;
  grounding?:"UNVERIFIED_CLAIM"|"UNVERIFIED_EVIDENCE"|"EXPIRED"|"WRONG_OWNER"|"WRONG_PRODUCT"|"WRONG_COUNTRY"|"WRONG_CHANNEL"|"UNMET_CONDITION";
}
const safe=(id:string,category:ComplianceCorpusCase["category"],text:string):ComplianceCorpusCase=>({id,category,text,approvedClaim:text,expected:"PASS"});
const unknown=(id:string,category:ComplianceCorpusCase["category"],text:string,approvedClaim?:string):ComplianceCorpusCase=>({id,category,text,approvedClaim,expected:approvedClaim?"AUTO_REWRITE":"REVIEW_REQUIRED"});
const blocked=(id:string,text:string,category:ComplianceCorpusCase["category"]="skincare"):ComplianceCorpusCase=>({id,category,text,expected:"BLOCK"});

export const COMPLIANCE_CORPUS:readonly ComplianceCorpusCase[]=[
  safe("skin.th.moisture","skincare","ช่วยให้ผิวดูชุ่มชื้น"),
  safe("skin.en.moisture","skincare","Helps skin feel moisturized"),
  safe("skin.mixed.texture","skincare","เนื้อเจล lightweight เกลี่ยง่าย"),
  safe("skin.th.size","skincare","ปริมาณสุทธิ 30 มิลลิลิตร"),
  safe("skin.th.ingredients","skincare","มีส่วนผสมของกลีเซอรีนตามฉลากสินค้า"),
  safe("skin.en.fragrance","skincare","Fragrance-free formula as stated on the label"),
  safe("skin.th.acne.context","skincare","กล่องจัดเก็บสำหรับเครื่องสำอางและอุปกรณ์ดูแลสิว"),
  safe("skin.th.cosmetic.instant","skincare","คอนซีลเลอร์ปกปิดรอยสิวทันทีแบบชั่วคราว"),
  safe("skin.en.cosmetic.instant","skincare","Instant temporary coverage of blemishes with makeup"),
  safe("skin.th.cosmetic.beforeafter.context","skincare","ภาพก่อนและหลังแสดงการปกปิดด้วยเครื่องสำอางชั่วคราว"),
  safe("skin.th.package.price","skincare","ราคาปัจจุบัน 299 บาท"),
  safe("skin.en.test.conditions","skincare","Tested on 30 participants under the documented conditions"),
  safe("general.th.material","general","วัสดุเป็นผ้าฝ้าย 100% ตามฉลาก"),
  safe("general.th.silk.not.question","general","วัสดุเป็นผ้าไหมตามฉลากสินค้า"),
  safe("general.en.material","general","Made from 100% cotton according to the product label"),
  safe("general.th.drug.word.context","general","กล่องเก็บยาแบ่งได้ 7 ช่อง"),
  safe("general.en.acne.word.context","general","Storage pouch for acne-care accessories"),
  safe("general.th.capacity","general","ความจุ 5 ลิตร"),
  safe("general.en.capacity","general","Capacity 5 L"),
  safe("general.mixed.numeric","general","ความจุ 10.5 L ตามข้อมูลสินค้า"),
  safe("general.th.bundle","general","ชุด 3 ชิ้นราคา 299 บาท"),
  safe("general.en.bundle","general","Bundle of 3 units costs THB 299"),
  safe("general.th.promo.conditions","general","ส่วนลด 10% เมื่อซื้อครบ 500 บาทตามเงื่อนไขคูปอง"),
  safe("general.en.shipping.conditions","general","Free shipping applies only to eligible orders"),
  safe("general.th.no.promo.context","general","สีสินค้าคือสีครีม"),
  safe("electronics.th.compatibility","electronics","รองรับ iPhone 15 เท่านั้น"),
  safe("electronics.en.compatibility","electronics","Compatible with USB-C devices listed in the manual"),
  safe("electronics.mixed.material","electronics","ตัวเครื่องทำจาก ABS plastic"),
  safe("electronics.en.runtime","electronics","Runtime is 20 minutes under the stated test conditions"),
  safe("electronics.th.setup","electronics","ต้องติดตั้งด้วยมือก่อนใช้งาน"),
  safe("electronics.en.recharge","electronics","Recharge after use according to the manual"),
  {id:"neutral.th.not.medicine",category:"skincare",text:"ไม่ใช่ยา",expected:"PASS"},
  {id:"neutral.th.no.guarantee",category:"skincare",text:"ไม่มีการรับประกันผลลัพธ์",expected:"PASS"},
  {id:"neutral.th.not.replacement",category:"skincare",text:"ไม่ใช้แทนการรักษา",expected:"PASS"},
  {id:"neutral.en.negated.cure",category:"skincare",text:"Does not cure acne",expected:"PASS"},
  {id:"neutral.th.negated.cure",category:"skincare",text:"ไม่รักษาสิว",expected:"PASS"},
  blocked("skin.th.cure","รักษาสิวให้หายขาด"),
  blocked("skin.en.cure","This cream cures acne"),
  blocked("skin.mixed.cure","ครีมนี้ cure acne ได้"),
  blocked("skin.en.eczema","Treat eczema with this cream"),
  blocked("skin.th.prevent","ป้องกันโรคเบาหวานได้"),
  blocked("skin.en.prevent","Prevents cancer"),
  blocked("skin.th.diagnosis","ครีมนี้ช่วยวินิจฉัยโรคผิวหนังได้"),
  blocked("skin.en.diagnosis","Diagnosis of disease using this product"),
  blocked("skin.th.replace","ใช้แทนยาได้ไม่ต้องไปหาหมอ"),
  blocked("skin.en.replace","Replace medicine with this cream"),
  blocked("skin.th.guarantee","ทุกคนเห็นผลแน่นอน"),
  blocked("skin.en.guarantee","Guaranteed results for everyone"),
  blocked("skin.th.disclaimer.not.fix","รักษาสิวให้หายขาดแต่ไม่ใช่ยา"),
  blocked("skin.th.paraphrase.guarantee","ไม่มีทางที่ผิวจะเหมือนเดิมหลังใช้"),
  blocked("skin.th.ai.body","AI แสดงภาพผมงอกหลังใช้"),
  blocked("skin.en.ai.body","AI hair regrowth transformation"),
  blocked("general.en.infinite","Infinite battery without recharging","electronics"),
  blocked("general.th.impossible","ไม่ต้องชาร์จไฟอีกเลย","electronics"),
  unknown("skin.th.no.keyword.falsefact","skincare","ทำให้เซลล์ผิวเกิดใหม่ทุกคืน"),
  unknown("skin.en.no.keyword.falsefact","skincare","Changes your skin biology permanently"),
  unknown("skin.th.certification.unknown","skincare","อย. รับรองประสิทธิภาพนี้"),
  unknown("skin.en.certification.unknown","skincare","Dermatologist approved"),
  unknown("skin.th.timeline.unknown","skincare","เห็นผลภายใน 3 วัน"),
  unknown("skin.en.timeline.unknown","skincare","Results within 3 days"),
  unknown("skin.th.question.medical","skincare","รักษาสิวได้ไหม"),
  unknown("skin.en.question.medical","skincare","Can this cream cure acne?"),
  unknown("general.th.rhetorical.unknown","general","เชื่อไหมว่าสินค้านี้ทำให้เดินบนผิวน้ำได้"),
  unknown("general.en.rhetorical.unknown","general","Can this device let you walk on water?"),
  unknown("skin.th.rhetorical.no.keyword","skincare","รู้ไหมว่าสูตรนี้ทำให้เซลล์ผิวเกิดใหม่ทุกคืน"),
  unknown("general.mixed.rhetorical.unknown","electronics","เชื่อไหมว่า device นี้ทำให้คุณเดินบนผิวน้ำได้"),
  unknown("general.th.capacity.changed","general","ความจุ 10 ลิตร","ความจุ 5 ลิตร"),
  unknown("general.en.capacity.changed","general","Capacity 50 L","Capacity 5 L"),
  unknown("general.mixed.decimal.changed","general","ความจุ 105 L","ความจุ 10.5 L"),
  unknown("general.th.material.changed","general","วัสดุเป็นทองแท้","วัสดุเป็นสแตนเลส"),
  unknown("general.en.material.changed","general","Made of titanium","Made of stainless steel"),
  unknown("general.th.compatibility.changed","electronics","รองรับ iPhone ทุกรุ่น","รองรับ iPhone 15 เท่านั้น"),
  unknown("general.en.compatibility.changed","electronics","Compatible with every phone","Compatible with iPhone 15 only"),
  unknown("general.mixed.power.changed","electronics","กำลังไฟ 2000 W","กำลังไฟ 200 W"),
  unknown("general.th.setup.omitted","electronics","เปิดแล้วใช้งานได้เลย","ต้องติดตั้งด้วยมือก่อนใช้งาน"),
  unknown("general.en.filter.unverified","general","Removes every microscopic contaminant"),
  unknown("general.th.price.changed","general","ราคา 99 บาท","ราคา 299 บาท"),
  unknown("general.en.expired.discount","general","Discount 90% off today"),
  unknown("general.th.fake.scarcity","general","เหลือเพียง 2 ชิ้น"),
  unknown("general.en.fake.testimonial","general","Real customer testimonial confirms the result"),
  unknown("neutral.then.unknown.th","skincare","ไม่รักษาสิว, ทำให้เซลล์ผิวเกิดใหม่ทุกคืน"),
  unknown("neutral.then.unknown.en","skincare","Does not cure acne, changes your skin biology permanently"),
  blocked("neutral.unrelated.prefix","ไม่ได้อ้างว่าราคาแพง ครีมนี้รักษาสิวได้"),
  blocked("negation.then.cure.th","ไม่ใช่ยา แต่รักษาสิวได้"),
  blocked("negation.then.cure.en","Does not cure acne but treats eczema"),
  {id:"grounding.claim.unverified",category:"general",text:"ความจุ 5 ลิตร",approvedClaim:"ความจุ 5 ลิตร",grounding:"UNVERIFIED_CLAIM",expected:"REVIEW_REQUIRED"},
  {id:"grounding.evidence.unverified",category:"general",text:"ความจุ 5 ลิตร",approvedClaim:"ความจุ 5 ลิตร",grounding:"UNVERIFIED_EVIDENCE",expected:"REVIEW_REQUIRED"},
  {id:"grounding.expired",category:"general",text:"ราคา 299 บาท",approvedClaim:"ราคา 299 บาท",grounding:"EXPIRED",expected:"REVIEW_REQUIRED"},
  {id:"grounding.owner",category:"general",text:"ความจุ 5 ลิตร",approvedClaim:"ความจุ 5 ลิตร",grounding:"WRONG_OWNER",expected:"REVIEW_REQUIRED"},
  {id:"grounding.product",category:"general",text:"ความจุ 5 ลิตร",approvedClaim:"ความจุ 5 ลิตร",grounding:"WRONG_PRODUCT",expected:"REVIEW_REQUIRED"},
  {id:"grounding.country",category:"general",text:"ความจุ 5 ลิตร",approvedClaim:"ความจุ 5 ลิตร",grounding:"WRONG_COUNTRY",expected:"REVIEW_REQUIRED"},
  {id:"grounding.channel",category:"general",text:"ความจุ 5 ลิตร",approvedClaim:"ความจุ 5 ลิตร",grounding:"WRONG_CHANNEL",expected:"REVIEW_REQUIRED"},
  {id:"grounding.conditions",category:"general",text:"ส่วนลด 10%",approvedClaim:"ส่วนลด 10%",grounding:"UNMET_CONDITION",expected:"REVIEW_REQUIRED"},
];

export function complianceCorpusInput(test:ComplianceCorpusCase,channel:ComplianceChannel="POST"):ComplianceInput {
  const scope={ownerId:"fixture.owner",productId:"fixture.product",platform:"TIKTOK_SHOP",country:"TH",region:"TH",category:test.category,channel};
  const evidence:ProductEvidence={id:"fixture.evidence",ownerId:scope.ownerId,productId:scope.productId,kind:"PDP",source:"fixture://reviewed-product-data",
    sourceHash:"a".repeat(64),jurisdiction:"TH",verified:true,expiresAt:null};
  const claim:ProductClaim={id:"fixture.claim",ownerId:scope.ownerId,productId:scope.productId,text:test.approvedClaim??"",type:"PRODUCT_FACT",
    source:evidence.source,evidenceRefs:[evidence.id],jurisdiction:"TH",expiresAt:null,verified:true,allowedChannels:["POST","LIVE"],conditions:[],aliases:test.aliases};
  switch(test.grounding){
    case"UNVERIFIED_CLAIM":claim.verified=false;break;
    case"UNVERIFIED_EVIDENCE":evidence.verified=false;break;
    case"EXPIRED":evidence.expiresAt="2026-10-06T00:00:00Z";break;
    case"WRONG_OWNER":claim.ownerId="fixture.other-owner";break;
    case"WRONG_PRODUCT":claim.productId="fixture.other-product";break;
    case"WRONG_COUNTRY":evidence.jurisdiction="SG";break;
    case"WRONG_CHANNEL":claim.allowedChannels=[channel==="POST"?"LIVE":"POST"];break;
    case"UNMET_CONDITION":claim.conditions=["minimum-spend-500"];break;
  }
  return{scope,stage:channel==="LIVE"?"LIVE_SPEECH":"PRE_GENERATION",content:{script:test.text},claims:test.approvedClaim?[claim]:[],
    evidence:test.approvedClaim?[evidence]:[],aiGenerated:false,now:POLICY_TEST_NOW};
}
