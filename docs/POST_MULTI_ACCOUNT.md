# POST multi-account

สถานะ: migration ทั้งสองรายการ apply ไป Supabase ที่เชื่อมอยู่แล้ว Supabase Cron ทำงานจริงใน SAFE บน `feature/post-multi-account` ยังไม่ deploy Production UI และไม่เปิดการสร้างวิดีโอหรือเผยแพร่จริง

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

Migration ที่ apply remote แล้ว และปรับชื่อไฟล์ให้ตรงกับ version ใน remote history:

- `supabase/migrations/20261007040333_post_multi_account_schedules.sql`
- `supabase/migrations/20261007040348_post_supabase_cron_safe_scheduler.sql`

รักษาข้อมูลเก่าและ append-only evidence เพิ่ม account locks, schedules, slots และ post outputs ตรวจ RLS/grants และบังคับ identity/ผล published ในฐานข้อมูลด้วย migration ไม่ลบ production table/column หรือ history เก่า และหยุดหากพบ legacy active-account records ที่ขัดกันแทนการลบข้อมูล

การตรวจ isolated replay รัน migration ใหม่ทั้งสองซ้ำหลังติดตั้ง schema ครบแล้ว โดยยังรักษาข้อมูลและใช้ Cron ชื่อเดิม ไม่สร้าง logical job หรือ Cron ซ้ำ

## Supabase Cron และ SAFE

Scheduler หลักเป็น Supabase Cron/`pg_cron` ในฐานข้อมูล ไม่พึ่ง browser หรือ Vercel Hobby Cron งานชื่อคงที่ `viralflow-post-account-automation` active ทุก 1 นาที และเรียก `SELECT public.tick_post_account_automation();` ตรวจ remote แล้วมีงานชื่อนี้เพียงหนึ่งรายการ และมี run history สำเร็จจริง การรัน migration ซ้ำใช้ `cron.alter_job` กับรายการเดิม แนวทาง SQL scheduling/history อ้างอิง [Supabase Cron](https://supabase.com/docs/guides/cron) และ [Cron Quickstart](https://supabase.com/docs/guides/cron/quickstart)

SAFE tick ทำ due detection, materialize slots, atomic account/job claim, job creation, next-run calculation และ bounded recovery จริง ใช้ production lease/finish RPC เดิมและเพดานรวม 3 accounts เก็บสถานะรอที่ `WAITING_FOR_PROVIDER` พร้อมเหตุผล `SAFE_EXECUTION_BOUNDARY` ไม่สร้างวิดีโอ ผล published หรือจำนวนสำเร็จจำลอง

Server-side `POST_AUTOMATION_EXECUTION_MODE` เป็น `SAFE|LIVE` ค่าเริ่มต้น SAFE และต้องมีทั้ง environment เป็น LIVE **และ** service-only `get_post_automation_execution_mode()` อ่าน DB เป็น LIVE จึงจะผ่าน external execution boundary หาก DB ไม่มีค่า อ่านไม่สำเร็จ หรือคืนค่าที่ไม่รู้จัก จะเป็น SAFE ไม่มี customer action ที่เปลี่ยนโหมดนี้ได้ `service_role` อ่าน runtime mode ได้ แต่ไม่ได้สิทธิ์แก้ execution mode/activation/capacity

Production ports ใน SAFE หยุดก่อน creative generation เมื่อยังไม่มี script, video generation, visual re-verification, TikTok queue/Direct Post/draft upload/status network และ analytics network อ่านหรือ reuse หลักฐานจริงที่มีอยู่ได้ EXPORT จากไฟล์ที่ผ่าน quality/compliance/originality แล้วสามารถสร้างแพ็กเกจได้ โดยยังตรวจ ownership และ checksum ไม่มีการ fallback เป็นผลสำเร็จปลอม

Provider readiness ของ SAFE หมายถึงพร้อม claim งาน orchestration เท่านั้น ไม่เปลี่ยนความพร้อมของ provider จริง TS planning ยังคง account/budget guards และบัญชีงบศูนย์ยังถูก BLOCK ตาม budget readiness เดิม การทดสอบใช้ positive planned budget กับ test accounts แต่ spend เป็น $0 ส่วน DB-only SAFE tick ตั้ง generation/publish capacity เป็น 0 และไม่มี paid reservation การป้องกันเพดานเงินจริงของ LIVE ไม่ถูกผ่อน

Observability เก็บ last tick, last successful tick, due accounts, claimed jobs, skipped duplicate, recovered jobs, failures และ next run ใน `private.post_scheduler_runtime`/`private.post_scheduler_ticks` มี service-only `get_post_scheduler_health()` สำหรับผู้ดำเนินระบบ ไม่มี customer grants หรือ technical log เพิ่มใน UI

**ขอบเขตที่ยังไม่พร้อม:** DB-only Cron นี้พิสูจน์ SAFE orchestration ไม่ใช่ LIVE delivery runner หาก runtime ถูกเปลี่ยนเป็น LIVE จะรายงาน `LIVE_EXECUTOR_REQUIRED` โดยไม่เรียก external provider ต้องมี authorized server executor ที่เชื่อม production execution path เดิมก่อนประกาศว่า automatic LIVE delivery พร้อม รอบนี้ไม่ได้ deploy UI หรือเพิ่ม HTTP/Edge Function สำหรับส่งงานจริง

ยังต้องมี generation credentials/billing/provider approval, สินค้าและภาพที่ใช้ได้, visual quality verification และงบที่พอ AUTO/DRAFT ยัง fail-closed ตามสิทธิ์ TikTok จริง ไม่ประกาศว่า external production E2E ผ่าน

## หลักฐานการตรวจ

- TypeScript tests ครอบคลุม 10 บัญชี, isolation, bounded concurrency, scheduling/restart/missed/retry, timezone/DST, modes, privacy และ export/review
- `node scripts/verify-post-multi-account-sql.mjs` ตรวจ migration ทั้ง 28 ไฟล์ใน PostgreSQL 18.3 ผ่าน PGlite ที่ pin รุ่น 0.5.8 และทดสอบ SQL/RPC/RLS/grants/scheduler 86 กรณีผ่าน รวม replay ทั้งสอง migration กับข้อมูลที่มี jobs/slots อยู่แล้ว, 3 leases และบัญชีเกินเพดาน, duplicate/restart/recovery สูงสุด 3 ครั้ง, timezone/day boundary และ SAFE ที่ไม่มี generation job/publishing request ใช้ฐานข้อมูลในหน่วยความจำ ไม่โหลด credentials และไม่เชื่อม Supabase จริง managed auth/storage/default grants และ Cron registration ถูกจำลองเฉพาะ environment ทดสอบ ไม่ใช่ load test ของ Postgres หลาย connection
- Remote SQL ตรวจ migration ทั้งสอง, Cron หนึ่งงาน/active/ประวัติสำเร็จ, SAFE runtime/เพดาน 3 และ catalog RLS/grants ผ่าน owner-only SELECT policies ใช้ `auth.uid()=owner_id`; authenticated/anon ไม่มี mutation grants และเรียก scheduler/health RPC ไม่ได้ `service_role` ไม่ได้สิทธิ์เปลี่ยน execution mode การตรวจ catalog นี้ไม่แทน authenticated-client isolation proof ที่ยังรอ credentials
- Browser fixture ใช้คอมโพเนนต์ production จริงและข้อมูลทดสอบติดป้าย ตรวจ 3/10 บัญชีที่ 1440/1280/768/390 รวมรายละเอียดและ settings มือถือ ไม่พบ overflow หรือ page error การตรวจนี้เป็น UI verification ไม่ใช่ external generation/publishing E2E
- SAFE-mode production boundary และ POST regression tests ล่าสุดผ่าน 48 tests ใน 8 ไฟล์ รวม injected production adapters และ environment/DB gating ที่ provider network calls = 0 ไม่มี paid generation หรือ TikTok posting calls
- ปรับเฉพาะ read projection ให้ `/post` แสดงคิวเริ่มงานจาก due slots แยกจากคลิปที่รอเผยแพร่ และแสดง WAIT/PAUSED/RETRY/FAILED เป็นข้อความตามสถานะจริง ไม่ส่ง lease/slot/run IDs หรือ technical reason ไป customer DTO จำกัด owner/date window และไม่ถือว่าการ STOP เป็น failed clip ไม่มี fixture ใน customer path และไม่ได้ deploy customer UI
- ไม่แก้ TikTok config/scopes/OAuth/approval, credentials, `.env.local` หรือ AI LIVE core

## ผลตรวจปลายรอบและ blocker

- Remote authenticated-client scheduler proof และ `phase11f-db.e2e.test.ts` ที่เคย skipped ยังไม่ถือว่าผ่าน: รอสิทธิ์เข้าถึง credentials ที่จำเป็นสำหรับ test client และการทดสอบพร้อม cleanup ของ explicit test owner/accounts ห้ามใช้ผล isolated SQL หรือ remote metadata แทนผล client E2E
- ชุดที่เกี่ยวข้อง Auto/POST/API/customer projection ผ่าน 115 tests ใน 19 ไฟล์; 2 remote tests ยัง skipped โดยไม่แทนด้วยผลผ่าน SQL isolated proof 86 กรณีผ่าน
- `pnpm test` ทั้ง repository: 678 ผ่าน, 1 ล้มเหลว, 2 skipped การล้มเหลวอยู่ใน `src/features/operations/scheduler.test.ts` ซึ่งยังคาดว่า `vercel.json` มี recovery Cron ทั้งที่ baseline `a80b454` มี `{}` อยู่แล้ว ไม่แก้ test/config ของ recovery ที่อยู่นอกขอบเขต POST นี้
- `pnpm typecheck` และ `pnpm build` ผ่าน; `pnpm lint` ผ่านโดยมี warnings เดิม 8 รายการนอกขอบเขตนี้ Build ใช้ public validation placeholders เฉพาะ process ไม่แก้ `.env.local`
- Browser fixture ภายในรอบนี้ตรวจ production POST components พร้อม projection ใหม่ที่ 1440/390px: WAIT และคิวเริ่มงานแสดงถูก, ไม่มี horizontal overflow, ไม่มี technical status รั่วและไม่มี console error/warning ไม่ใช่ remote customer E2E
- ไม่สร้าง remote test users/data ในรอบนี้: server key ไม่มีใน process และ automatic approval review ปฏิเสธการอ่าน key ผ่าน CLI จึงรอคำอนุญาตเฉพาะการใช้ key ในหน่วยความจำสำหรับ Auth Admin test users/cleanup ไม่อ่าน `.env.local` ไม่แสดงหรือบันทึก key และไม่เปลี่ยน credentials
- Remote catalog มี migrations 28 รายการเท่ากับ repository (26 logical migrations เดิม + POST 2 รายการใหม่); versions ของ POST ตรงกันตามชื่อไฟล์ด้านบน timestamp ของ migrations เก่าที่เคย apply ผ่าน MCP ต่างจากชื่อไฟล์เดิม จึงไม่ replay หรือเขียน history เดิมใหม่
- Security Advisor: INFO ใหม่ 2 ตาราง private ที่เปิด RLS แต่ไม่มี customer policy โดยตั้งใจ; scheduler tables/RPC ไม่มี anon/authenticated grants มี WARN เดิมเรื่อง leaked-password protection disabled ซึ่งรอบนี้ไม่แก้ [คำแนะนำ Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
