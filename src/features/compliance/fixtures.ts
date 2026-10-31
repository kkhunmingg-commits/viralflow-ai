import type {OriginalityMetadata} from "./types";
const base:OriginalityMetadata={videoId:"original",accountId:"account-a",masterId:"master-a",productId:"product-a",creativeProjectId:"project-a",hook:"เปิด กล่อง เซรั่ม ดู เนื้อสัมผัส",scenes:["เปิด กล่อง","สาธิต เนื้อสัมผัส","ชวน บันทึก"],cta:"บันทึก ไว้ ดู ภายหลัง",audio:{voice:"thai-female",music:"bright"}};
export const originalityFixtures={
  history:base,
  A:{...base,videoId:"A"},
  B:{...base,videoId:"B",hook:"ทดลอง hook ใหม่ เซรั่ม เนื้อสัมผัส"},
  C:{...base,videoId:"C",masterId:"master-c",creativeProjectId:"project-c",hook:"เซรั่ม ดู เนื้อสัมผัส ก่อน เปิด กล่อง",scenes:["เปิด กล่อง มุมใหม่","สาธิต เนื้อสัมผัส บนมือ","ชวน คอมเมนต์"],cta:"บันทึก แล้ว คอมเมนต์ คำถาม",audio:{voice:"thai-female",music:"bright"}},
  D:{...base,videoId:"D",accountId:"account-b",masterId:"master-d",creativeProjectId:"project-d"},
  E:{...base,videoId:"E",accountId:"account-b",masterId:"master-e",productId:"product-e",creativeProjectId:"project-e",hook:"จัดโต๊ะทำงานให้น่าใช้",scenes:["เคลียร์โต๊ะ","จัดแสงโคมไฟ","เก็บสายไฟ"],cta:"แชร์ไอเดียจัดโต๊ะ",audio:{voice:"none",music:"calm"}},
} satisfies Record<string,OriginalityMetadata>;
