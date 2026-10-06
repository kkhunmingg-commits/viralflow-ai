# POST multi-account

สถานะ: โค้ดและการตรวจภายในพร้อมบน `feature/post-multi-account` ยังไม่ apply migration หรือ deploy Production

## การทำงาน

- หนึ่ง active run ต่อบัญชี รวมงานที่ paused, waiting และ blocked ผู้ใช้เดียวเริ่มหลายบัญชีได้
- บัญชีอื่นไม่ถูก STOP ตามกัน การประมวลผลแต่ละรอบพร้อมกันสูงสุด 3 run และบันทึกลำดับการสแกนเพื่อไม่ให้งานรอขัดขวางบัญชีอื่น
- แต่ละบัญชีเลือก AUTO/DRAFT/EXPORT, เป้าหมายต่อวัน, เวลา, timezone, วันทำงาน, ระยะห่าง และงบของตนเอง
- ตารางเวลาและ slot อยู่ในฐานข้อมูล ใช้ account/date/ordinal เป็น identity กู้ run ที่สร้างก่อน worker หยุดได้โดยไม่สร้างซ้ำ งานที่พลาดจะถูกรวมและข้ามตามเวลา ไม่ยิงงานชดเชยไม่จำกัด
- START เปิดตารางเดิมและ resume งานที่ยังไม่จบ STOP ปิดเฉพาะบัญชี ไม่ replay slot ที่ใช้แล้ว และไม่เริ่ม generation ใหม่ระหว่าง lease/เงินของงานเก่ายังรอยืนยัน
- เป้าหมายและตัวนับรายวันใช้ timezone ของบัญชี ส่วน financial daily/monthly guards คงปฏิทิน UTC เดิม เพื่อรักษาเพดาน account/owner/provider/run ไม่เปลี่ยนนโยบายการเงิน

## Posting modes และสถานะจริง

| โหมด | พร้อมในโค้ด | เงื่อนไขใช้งานจริง |
| --- | --- | --- |
| AUTO | ใช้ generation, quality/compliance, queue, consent และ Direct Post เดิม | บัญชี authorized, scope/capability/approval ที่ได้รับจริง, official adapter, production flags และ generation provider พร้อม |
| DRAFT | ใช้ official inbox upload/status เดิม ส่งแล้วแสดงรอผู้ใช้ ไม่ถือว่า published | ต้องได้รับ `video.upload` และ upload approval จริง OAuth ปัจจุบันยังขอ Direct Post เท่านั้น รอบนี้ไม่เปลี่ยน scopes |
| EXPORT | persisted output + ZIP วิดีโอ/คำบรรยาย/hashtags/สินค้า/เวลาแนะนำ ตรวจ owner/account และ checksum | ต้องมีวิดีโอผ่าน quality/compliance/originality ไม่ต้องมี TikTok posting permission |

`DRAFT_UPLOADED`/`WAITING_FOR_USER` ไม่ถูกนับเป็น posted ผล published ต้องมี publishing queue ยืนยันจริง การอัปเดตผลภายหลังทำให้ output เปลี่ยนตามด้วย trigger

การ poll ผลเผยแพร่จำกัด 24 ครั้งหรือ 2 ชั่วโมง บันทึกจำนวนครั้งใน checkpoint ก่อนเข้าสู่ reconciliation ห้าม init/upload ใหม่เพียงเพราะยังไม่ได้ terminal status

## Customer UI

`/post` แสดงหลายบัญชีและผลจริง ส่วน `/post/[id]` แสดงคลิป คำบรรยาย ตัวอย่าง ตรวจยืนยัน ลองใหม่ และดาวน์โหลด EXPORT

ตัวเลข generated/ready/scheduled/posted/waiting/failed อ่านจาก media/output/queue ไม่ใช้ progress สมมติ ข้อมูลยอดขาย/จำนวนขาย/ค่าคอมมิชชันที่ยังไม่มีแสดง `—` ไม่แทนด้วยศูนย์ และไม่ถือว่า orders เป็น units

Customer DTO ไม่คืน provider/model/scopes/token/raw JSON หรือ run ID ข้อมูล preview/download/review ต้อง authenticate และตรวจ ownership สิทธิ์ mutation ของตารางใหม่ให้เฉพาะ server

ผล POST ที่สังเกตได้จริงเข้าสู่ shared performance-event projection เดิม พร้อม account/product/clip/creative/script/hook/posting time และ metric ที่มีหลักฐาน snapshot ใช้ key เดิมเพื่อ deduplicate และคง cumulative semantics ไม่มีผลจำลองส่งเข้า learning

## Migration และการเปิดใช้ภายหลัง

Migration: `supabase/migrations/20261006142353_post_multi_account_schedules.sql`

รักษาข้อมูลเก่าและ append-only evidence เพิ่ม account locks, schedules, slots และ post outputs ตรวจ RLS/grants และบังคับ identity/ผล published ในฐานข้อมูลด้วย

ก่อนเปิดใช้กับ environment จริงต้อง review/apply migration และ release branch นี้ จากนั้นมี server-side scheduler ที่ได้รับอนุญาตเรียก endpoint `/api/auto/process` เดิมเป็นระยะ การบันทึก schedule อย่างเดียวไม่ทำให้ browser เป็น worker และรอบนี้ไม่เปิด flag, Cron หรือ deploy แทนเจ้าของ

ยังต้องมี generation credentials/billing/provider approval, สินค้าและภาพที่ใช้ได้, visual quality verification และงบที่พอ AUTO/DRAFT ยัง fail-closed ตามสิทธิ์ TikTok จริง ไม่ประกาศว่า external production E2E ผ่าน

## หลักฐานการตรวจ

- TypeScript tests ครอบคลุม 10 บัญชี, isolation, bounded concurrency, scheduling/restart/missed/retry, timezone/DST, modes, privacy และ export/review
- `node scripts/verify-post-multi-account-sql.mjs` ตรวจ migration ทั้ง 27 ไฟล์ใน PostgreSQL 18.3 ผ่าน PGlite ที่ pin รุ่น 0.5.8 และทดสอบ RPC/RLS/grants 42 กรณี ใช้ฐานข้อมูลในหน่วยความจำ ไม่โหลด credentials และไม่เชื่อม Supabase จริง managed auth/storage/default grants ถูกจำลองเฉพาะ environment ทดสอบ ไม่ใช่ load test ของ Postgres หลาย connection
- Browser fixture ใช้คอมโพเนนต์ production จริงและข้อมูลทดสอบติดป้าย ตรวจ 3/10 บัญชีที่ 1440/1280/768/390 รวมรายละเอียดและ settings มือถือ ไม่พบ overflow หรือ page error การตรวจนี้เป็น UI verification ไม่ใช่ external generation/publishing E2E
- `phase11f-db.e2e.test.ts` ที่ต้องมีฐานข้อมูลจริงยัง skipped ไม่แทนด้วยผลผ่าน และไม่มี paid/network provider calls
- การตรวจชุดที่เกี่ยวข้องผ่าน 134 tests, typecheck และ production build; lint ไม่มี error แต่มี warning เดิม 8 รายการใน video benchmark/tests ที่อยู่นอกขอบเขตนี้
- ไม่แก้ TikTok config/scopes/OAuth, `.env.local`, AI LIVE core หรือ Production
