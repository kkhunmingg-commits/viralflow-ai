# VIDEO และ AI LIVE: Product Intelligence และ Learning Brain ร่วมกัน (เอกสารกำหนดจุดเชื่อม)

สถานะ: **ออกแบบเท่านั้น** ไม่ได้แก้ branch `feature/ai-live` และไม่ได้สร้าง AI LIVE เพิ่ม ตรวจจาก `origin/feature/ai-live` ที่ `a7d5530` (สำรองไว้ที่ `backup/ai-live-a7d5530-20261018`) และ `feature/ai-live-lite` เมื่อ 2026-10-20

## สิ่งที่ AI LIVE มีอยู่แล้ว

- `ProductBrain` (`src/features/ai-live/domain/product-brain.ts`) หมุนสินค้าที่สถานะ `available` ตามเวลาค้างและ cooldown ของ CTA ยังไม่ได้จัดอันดับสินค้า และไม่สร้างสินค้าใหม่
- `product-context-server.ts` อ่านตาราง `products`, `tiktok_accounts`, `product_assignments` ร่วมกับฝั่งวิดีโอแล้วลงลายเซ็นให้เครื่อง local
- `src/features/ai-live/analytics-contract.ts` (`UnifiedAccountPerformance`) แยก `post` กับ `live` แต่มี `commission` ระดับบัญชีช่องเดียว
- `src/features/control-center/performance-events.ts` (`PerformanceEvent`) มี `source: POST | LIVE`, `evidence: OBSERVED | INTERNAL_TEST`, `measurement: CUMULATIVE_SNAPSHOT | SESSION_TOTAL`
- migration เดียว `20261001091106_ai_live_device_registration.sql` (ตาราง `ai_live_devices*`) ไม่ชนชื่อกับฝั่งวิดีโอ
- ยังไม่มีตารางรายได้หรือผลการเรียนรู้ของ LIVE ที่บันทึกถาวร และ `PRODUCTION_READY=false`

## ข้อเสี่ยงที่ต้องรู้ก่อนรวม branch

- `feature/ai-live` มี merge-base กับ `main` เป็น initial commit คือสร้างบนประวัติแยก การรวมต้องทำทีละส่วน ไม่ใช่ merge ตรง
- branch นั้นไม่มี migration ของ main ตั้งแต่ 2026-10-10 และ timestamp ของ migration AI LIVE อยู่ระหว่าง migration เดิม ต้องเปลี่ยน timestamp ให้ต่อท้ายตอนรวม
- `src/app/(app)/post/page.tsx` มีทั้งสองฝั่งแต่เนื้อหาต่างกัน (ชน route)
- `observedPostEvents` รับเฉพาะ `TIKTOK_DISPLAY` และ `TIKTOK_SHOP_ANALYTICS` ถ้าจะใช้ผลที่เจ้าของนำเข้า (`OWNER_REPORT_IMPORT`) ต้องเพิ่มและติดป้ายแยก ไม่แปลงเป็น API

## หลักกันนับรายได้ซ้ำ

1. **แหล่งความจริงของรายได้มีที่เดียว** คือ `affiliate_conversion_events` หนึ่งแถวต่อ order line ต่อสถานะ (`external_event_id` ไม่ซ้ำต่อ owner+source)
2. ทุกแถวมี `channel` = `VIDEO | LIVE | SHOWCASE | UNKNOWN` ตามที่รายงานของ TikTok ระบุ (เพิ่มใน migration `20261020090000`) ระบบไม่เดาช่องทางเอง `UNKNOWN` และ `SHOWCASE` ไม่ถูกนับให้ VIDEO หรือ LIVE
3. order line หนึ่งนับครั้งเดียวที่สถานะไกลที่สุด (CREATED → SETTLED หรือ CANCELLED) ตาม `channelRevenue()` ใน `src/features/analytics/report-import.ts`
4. `gmv` และ `commission` ใน `video_analytics_snapshots` เป็นตัวนับสะสมต่อคลิป ใช้ดูแนวโน้มได้ แต่ **ห้ามนำไปบวกกับ** `affiliate_conversion_events` เพราะเป็นยอดเดียวกันที่มองคนละมุม
5. `UnifiedAccountPerformance.commission` ควรคำนวณจากข้อ 1 แยกเป็น `commissionByChannel` แทนการรวมช่องเดียว
6. ค่าใช้จ่ายแยกช่องทาง: `generation_costs` ควรมี `channel` (ค่าเริ่มต้น `VIDEO`) และฝั่ง LIVE บันทึกค่าเครื่อง/ไฟ/เวลา session เป็น `LIVE` โดยแยก actual กับ estimate เหมือน `content_bank_items` (`cost_actual_usd` กับ `cost_estimated_thb`)
7. กำไรต่อช่องทาง = ค่าคอมที่ settle แล้วของช่องนั้น − ค่าใช้จ่ายจริงของช่องนั้น ถ้าข้อมูลใดไม่มี ผลเป็น `UNKNOWN` ไม่เติมศูนย์

## Product Intelligence ร่วม

| ข้อมูล | ที่เก็บ | VIDEO ใช้ | LIVE ควรใช้ |
|---|---|---|---|
| สินค้า ราคา อัตราค่าคอมจากแค็ตตาล็อก | `products` | มีแล้ว | มีแล้ว (product-context-server) |
| คะแนนความเหมาะสมต่อบัญชี | `account_product_scores`, `product_assignments` | มีแล้ว | ให้ `ProductBrain` เรียงตาม `final_score` แทนการหมุนตามลำดับ |
| ข้อเท็จจริงที่ตรวจแล้ว | `content_evidence` | Creative Brain อ้างได้เฉพาะข้อนี้ | สคริปต์ LIVE ควรพูดเฉพาะข้อนี้เช่นกัน |
| สิทธิ์สื่อ | `media_asset_rights`, `media_asset_usages` | ตรวจก่อนเข้าคลังและก่อน export | ภาพสินค้าที่ขึ้นจอ LIVE ควรผ่าน ledger เดียวกัน |
| ค่าคอมจริงแยกช่องทาง | `affiliate_conversion_events.channel` | `productEvidenceSummary()` | ใช้ฟังก์ชันเดียวกัน |

`productEvidenceSummary()` (`src/features/products/evidence-summary.ts`) คืนค่าทุกช่องพร้อมสถานะ `VERIFIED / OWNER_REPORTED / CATALOG_LISTED / UNKNOWN / WAIT_FOR_DATA / TEST_DATA` ฝั่ง LIVE เรียกใช้ได้โดยไม่ต้องสร้างตัวใหม่

## Learning Brain ร่วม

- ฝั่งวิดีโอเรียนรู้ผ่าน `decideAdaptiveExperiment` (`src/features/growth/adaptive-experiments.ts`) ด้วย arm = hook pattern + angle + topic + วิธีผลิต ต้องมีอย่างน้อย 6 คลิปในอย่างน้อย 3 วันก่อนเลือกตามผล
- LIVE ควรส่ง `PerformanceEvent` แบบ `SESSION_TOTAL` และ **ไม่** ใส่ในการทดลองเดียวกับคลิป เพราะหน่วยวัดต่างกัน (คลิปวัดต่อการดู LIVE วัดต่อชั่วโมง)
- สิ่งที่แชร์ได้อย่างปลอดภัยคือ **สัญญาณระดับสินค้าและหัวข้อ** เช่น สินค้าไหนมีค่าคอม settle จริงจากทั้งสองช่องทาง หรือคำถามจากผู้ชม LIVE (`audienceQuestions`) ที่ Creative Brain ใช้เป็นหัวข้อคลิปใหม่ได้โดยติดป้ายว่ามาจาก LIVE
- ห้ามนำผล `INTERNAL_TEST` หรือ `MOCK` เข้าการเรียนรู้จริง ซึ่งตรงกับการแยก `SIMULATED` ในฝั่งวิดีโอ

## จุดเชื่อมที่เสนอ (ยังไม่สร้าง)

```ts
// ฝั่ง LIVE ส่งเข้า ledger เดียวกับวิดีโอ ไม่สร้างตารางรายได้ใหม่
interface LiveSessionOutcome {
  ownerId: string; accountId: string; sessionId: string; productIds: string[];
  startedAt: string; endedAt: string; evidence: "OBSERVED" | "INTERNAL_TEST";
  viewers: number | null; audienceQuestions: string[];
  // รายได้ไม่อยู่ที่นี่: มาจาก affiliate_conversion_events ที่ channel = 'LIVE'
  actualCostThb: number | null; estimatedMachineThb: number | null;
}
```

ลำดับงานเมื่อจะรวมจริง: (1) ย้าย migration AI LIVE มาต่อท้าย (2) เพิ่ม `channel` ใน `generation_costs` (3) ให้ `ProductBrain` รับรายการที่จัดอันดับจาก `product_assignments` (4) เปลี่ยน `UnifiedAccountPerformance.commission` เป็นค่าจาก `channelRevenue()` (5) เพิ่ม `OWNER_REPORT_IMPORT` ใน `observedPostEvents` พร้อมป้ายแยก
