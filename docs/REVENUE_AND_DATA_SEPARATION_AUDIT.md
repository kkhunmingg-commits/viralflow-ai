# ตรวจสอบการแยกรายได้ VIDEO/LIVE และข้อมูลจริง/จำลอง

วันที่ตรวจ: 2026-10-20 · สาขา `claude/phase4-1-hybrid-ai`

สถานะ: **PASS** = ถูกต้องอยู่แล้ว · **FIXED** = แก้ในรอบนี้ มีเทสต์ · **ISSUE** = พบปัญหาแต่ยังไม่ได้แก้ (มีข้อเสนอ)

## A. รายได้ VIDEO / LIVE (`channelRevenue`)

| # | สิ่งที่ตรวจ | หลักฐาน | ผล |
|---|---|---|---|
| A1 | นับออเดอร์แต่ละรายการครั้งเดียว ที่สถานะไกลสุด (CANCELLED > SETTLED > CREATED) | `src/features/analytics/report-import.ts:246-251` คีย์ = `orderId:productId` ตัดชื่อสถานะท้ายออก | PASS |
| A2 | `COMMISSION_UPDATED` (มีใน schema) ไม่ถูกตัด suffix ทำให้กลายเป็นออเดอร์ที่สอง | เดิม regex ตัดเฉพาะ `ORDER_*` · แก้ที่ `report-import.ts:249` | FIXED |
| A3 | แถว `source = MOCK` ต้องไม่ถูกนับเป็นรายได้ | เพิ่ม `if (o.source === "MOCK") continue` ที่ `report-import.ts:248` (field เป็น optional จึงไม่กระทบ `scripts/pilot/import-proof.ts`) | FIXED |
| A4 | UNKNOWN / SHOWCASE ไม่ถูกนับเป็น VIDEO หรือ LIVE | `channelRevenue` ใช้ `o.channel` ตามจริง แยก bucket; `products/evidence-summary.ts:15-16` ใช้เฉพาะ `VIDEO`/`LIVE` | PASS |
| A5 | การอ่านช่องทางจากรายงาน: เดิมใช้ `/live/` แบบไม่มีขอบคำ ทำให้ "Delivered" กลายเป็น LIVE | แก้เป็นคำเต็ม `\blive\b`, `\bvideos?\b` ที่ `report-import.ts:83-87` | FIXED |
| A6 | การอ่านสถานะ: เดิม "Unpaid" ตรง `/paid/` → SETTLED และ "ไม่สำเร็จ" ตรง `สำเร็จ` → SETTLED | แยกเป็น `reportOrderEvent()` `report-import.ts:89-93` ตรวจกรณียกเลิก/ล้มเหลวก่อน และใช้ขอบคำภาษาอังกฤษ | FIXED |
| A7 | ไม่มีโค้ดใดรวม `video_analytics_snapshots.gmv/commission` กับ `affiliate_conversion_events` | `affiliate_conversion_events` ถูกอ่าน/เขียนเฉพาะใน `report-import.ts` (และ `scripts/pilot`) ; การนำเข้าผลวิดีโอไม่ใส่ gmv/commission (`report-import.ts:203-212`) | PASS |
| A8 | ออเดอร์ VIDEO เท่านั้นที่ผูก `external_video_id` | `report-import.ts:222` | PASS |

## B. ข้อมูลจริง / จำลอง (MOCK) กับการเรียนรู้

| # | สิ่งที่ตรวจ | หลักฐาน | ผล |
|---|---|---|---|
| B1 | `importOwnerReport` ปฏิเสธบัญชีทดลอง | `report-import.ts:152-157` (`is_mock !== false` → `REPORT_ACCOUNT_IS_MOCK`) ใช้ร่วมกับ preview `report-import.ts:343` | PASS |
| B2 | creative intelligence อ่านเฉพาะบัญชีจริงและ source จริง | `src/features/creative/intelligence-service.ts:46` (`is_mock===false`), `:54` (`.in("source",[TIKTOK_DISPLAY,TIKTOK_SHOP_ANALYTICS,OWNER_REPORT_IMPORT])`) | PASS |
| B3 | creative learning ไม่รับ MOCK | `src/features/analytics/creative-learning.ts:43` (whitelist source + `authorized`) | PASS |
| B4 | adaptive experiments ไม่รับ MOCK ในบริบท REAL | `src/features/creative/self-learning.ts:53` แปลง MOCK → `SIMULATED` + `authorized:false`; `src/features/growth/adaptive-experiments.ts:133` บริบท REAL รับเฉพาะ source จริง, `:105` commerce ต้องเป็น source ที่ยืนยันแล้ว | PASS |
| B5 | trend discovery ไม่รับ MOCK | `src/features/growth-manager/trend-discovery.ts:132` (รับเฉพาะ TIKTOK_DISPLAY / OWNER_REPORT_IMPORT), `:157` (ตัด MOCK) | PASS |
| B6 | Auto pipeline (dev เท่านั้น) สร้าง winner score + `learning_decisions` ให้บัญชีทดลอง | `src/features/auto/execution-ports.ts:250-275` → `src/features/analytics/auto-learning.ts:19` ไม่ตรวจ `is_mock`; ข้อมูลผูกกับบัญชีทดลองเท่านั้นและไม่มีโค้ดอื่นนำ `learning_decisions` ไปใช้นอกจากแสดงในหน้า Learning | ISSUE (ต่ำ) — เสนอให้ติดป้าย MOCK หรือกรองบัญชีทดลองออกจากหน้า Learning |

## C. ยอดรวมอื่น ๆ (dashboard / analytics / control-center)

| # | สิ่งที่ตรวจ | หลักฐาน | ผล |
|---|---|---|---|
| C1 | หน้า Analytics รวม Views/Orders/GMV/Commission จาก **ทุก** snapshot: นับยอดสะสมซ้ำทุกครั้งที่ถ่าย snapshot และรวม MOCK กับข้อมูลจริง | เดิม `src/features/analytics/services.ts:12` (`snapshots.reduce(...)`) · แก้เป็น `realSnapshotTotals()` `services.ts:11-16` ใช้ snapshot ล่าสุดต่อวิดีโอ (บัญชี + TikTok video id) จาก source จริงเท่านั้น และนับ MOCK แยก; หน้า `src/app/(app)/analytics/page.tsx` ระบุว่าไม่รวม MOCK | FIXED |
| C2 | Control center (`/auto`) อ่าน snapshot ล่าสุดหนึ่งรายการต่อวิดีโอ ไม่ได้รวมยอด | `src/app/(app)/auto/page.tsx:178-181` (`limit(1)`) | PASS |
| C3 | Winner board / จำนวน SCALE/WATCH บนหน้า Analytics และ Dashboard นับ winner score ของบัญชีทดลองด้วย | `services.ts:20` (`latestWinners(scores)` ไม่กรอง source ของ snapshot) | ISSUE — เสนอกรอง winner ที่ `video_snapshot_id` ชี้ไป snapshot MOCK หรือแสดงแยก |
| C4 | Dashboard รวม `account_daily_stats` และ `follower_count` ของทุกบัญชีรวมบัญชีทดลอง | `src/features/accounts/account-performance.ts:97-105`, `:139`; `src/app/(app)/dashboard/page.tsx:50-54` | ISSUE — เป็นยอดรายวันต่อบัญชี (ไม่ซ้ำ) แต่ปนบัญชีทดลอง เสนอให้ส่งเฉพาะบัญชี `is_mock=false` หรือแสดงยอดทดลองแยก |

## ข้อจำกัดที่ทราบ (ไม่ได้แก้)

- ถ้าออเดอร์เดียวกันถูกส่งออกครั้งหนึ่งมีรหัสสินค้าและอีกครั้งไม่มี คีย์จะต่างกัน (`orderId:` กับ `orderId:P1`) จึงอาจนับซ้ำได้ — ควรใช้คีย์ระดับออเดอร์เมื่อรายงานไม่มีรหัสสินค้า
- ออเดอร์ที่มีหลายบรรทัดของสินค้าเดียวกันและสถานะเดียวกันในไฟล์เดียว บรรทัดที่สองถูกปฏิเสธเป็น `DUPLICATE_ORDER_LINE_IN_FILE` (นับขาด ไม่ใช่นับเกิน)

## เทสต์

`src/features/analytics/report-import.test.ts` — กลุ่ม "revenue and real/mock separation" ครอบคลุม A2, A3, A5, A6, C1
