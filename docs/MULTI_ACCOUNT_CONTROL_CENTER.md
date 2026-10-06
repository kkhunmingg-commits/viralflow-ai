# ViralFlow AI — Multi-Account Customer Control Center

สถานะงานบน `feature/ai-live` ต่อจาก `1cfc25540990258a1920dcb882c5126c00f0f4a1` ตรวจจาก implementation ปัจจุบันใน workspace วันที่ 6 ตุลาคม 2026 ไม่มี merge หรือ deploy Production และไม่เปลี่ยน TikTok app, OAuth, scopes, approval flags, credentials หรือ Affiliate AUTO core

งานรอบนี้รวมหน้าลูกค้าและ read aggregation เดิมให้ดูหลายบัญชีได้ชัดเจน เพิ่มการแยก lifecycle ของ local LIVE rooms โดยยังไม่ประกาศ LIVE-1 complete, NVIDIA validation หรือ TikTok LIVE พร้อมใช้งานจริง

## หน้าที่ผู้ใช้เห็น

| หน้า | สิ่งที่ทำได้ | ขอบเขตข้อมูล |
| --- | --- | --- |
| `/home` | ภาพรวมทุกบัญชี เลือกวันนี้/7 วัน/30 วัน ดูยอดขาย ค่าคอมมิชชัน คลิปที่โพสต์ ข้อมูล LIVE ที่มีจริง อันดับบัญชี และสร้างภาพสรุป | authenticated owner-scoped projection; ข้อมูลที่ยังไม่วัดเป็น `null`/`—` |
| `/post` | การ์ดทุกบัญชี แยกสถานะ/เป้าหมาย/งานปัจจุบัน/จำนวนคลิป/ผลลัพธ์ START และ STOP รายบัญชีที่ระบบเดิมรองรับ | ใช้ AUTO domain services และ durable processor เดิม ไม่สร้าง AUTO engine ใหม่ |
| `/post/[id]` | คลิปของบัญชีที่เลือก ภาพสินค้า สถานะ เวลาโพสต์ ยอดดู/ยอดขาย และ Retry เมื่อ path เดิมอนุญาต | ตรวจ owner/account และใช้ publishing retry เดิม; ไม่ให้การ์ดบัญชีหนึ่งส่งงานของอีกบัญชี |
| `/ai-live` | ห้องตามบัญชี เลือกสินค้า/หมวด/คน LIVE ดูความพร้อม ภาพอ้างอิง preview และ lifecycle ที่ผ่าน gate จริง | paired LocalLiveClient/Local Agent เดิม; ไม่มี mock fallback ฝั่งลูกค้า |
| `/accounts` | จัดการ TikTok accounts เดิม | ไม่เปลี่ยน integration หรือสิทธิ์ของ TikTok |
| `/profile` | ข้อมูลสมาชิกและออกจากระบบ | เข้าถึงจากส่วนผู้ใช้ด้านบน |

เมนูหลักเหลือ Home / POST / AI LIVE / Accounts และ Profile อยู่ด้านบน หน้าระบบเดิมไม่ถูกลบ แต่ไม่วางเป็นเมนูหลักของลูกค้า Brand เปิด `/home` ส่วน public product homepage `/` ยังคงเป็นเว็บไซต์สาธารณะเดิม

Customer UI ไม่แสดง provider/model, scopes, tokens, raw error/status, database IDs, queue IDs หรือ debug JSON ตัว locator ที่จำเป็นต่อ URL/action ถูกตรวจสิทธิ์ฝั่ง server และไม่แสดงเป็นข้อความบนหน้า

## Home และ POST: ข้อมูลจริง

`customer-data.ts` ใช้ `auth.getUser()` ก่อนอ่านข้อมูลด้วย owner filter แล้วส่งเฉพาะ DTO ใน `customer-types.ts` ให้ components ไม่มีการส่ง record/token/secret ทั้งก้อนไป client และไม่เรียก paid video provider จากการอ่านหน้า

Read aggregation ใช้บัญชี สินค้า master/variation, generation jobs, publishing queue, AUTO run/account states และ official analytics snapshots ที่มีอยู่ บัญชี `is_mock` และบัญชีที่ซ่อนไว้ไม่เข้าสู่ customer projection

- ช่วงวันนี้/7 วัน/30 วันนับตาม UTC; เวลาโพสต์ที่แสดงอ่าน timestamp จริงและแปลงเป็นเวลาไทย ช่วงวันถูกอธิบายบนหน้า ไม่เปลี่ยน business timezone ในระบบเดิม
- `generated` นับ completed generation outputs แบบ deduplicate และ `published` นับรายการ `PUBLISHED` ที่มีเวลา completion จริงในช่วงที่เลือก
- จำนวนสร้าง/โพสต์วันนี้เป็น daily counts ส่วนพร้อมโพสต์/ต้องตรวจ/รอผู้ใช้โพสต์เป็น backlog ปัจจุบันที่บันทึกไว้ `ready` ใช้ queue `APPROVED`; master `READY` เพียงอย่างเดียวไม่ได้หมายความว่าผ่าน compliance/consent แล้ว
- `waiting` ที่ป้าย “รอคุณโพสต์” ใช้ `DRAFT_DELIVERED` เท่านั้น ไม่ใช้ทุก queued/processing row มาสร้างจำนวนรอผู้ใช้โพสต์
- ยอดดู ยอดขาย ค่าคอมมิชชัน และจำนวนขายใช้ `TIKTOK_DISPLAY` / `TIKTOK_SHOP_ANALYTICS` observations; จำนวนขายใช้ `items_sold` ไม่เรียก orders ว่าจำนวนชิ้น
- Snapshots เป็น cumulative counters จึงคำนวณ delta จาก baseline และเลือก observation ต่อ video/metric แทนบวก snapshot ซ้ำ เมื่อไม่มี baseline ที่พิสูจน์ช่วงเวลาได้ ค่าจะยังไม่พร้อม ไม่เดาเป็นศูนย์
- เงินต้องมี currency จริง การรวม/จัดอันดับข้ามสกุลเงินที่เทียบกันไม่ได้ไม่เกิดขึ้น ไม่มี hardcode THB หรืออ้างว่า GMV คือกำไร
- LIVE sessions/hours/sales-per-hour ใน Home ยังเป็น `null` เพราะยังไม่มี cloud observations จริง ไม่ใช้จำนวนห้องที่ตั้งไว้เป็นประวัติ LIVE หรือสร้างรายได้จำลอง

หน้า Home/POST ใช้ `AutoRefresh` เดิม refresh server projection ทุก 12 วินาทีเมื่อแท็บมองเห็น ไม่เปิด AUTO action หรือสร้าง job จาก polling

## POST controls และข้อจำกัดเดิม

`post/actions.ts` เป็น customer action boundary ที่ตรวจผู้ใช้และ rate limit ก่อน reuse `createAutoRun`, `transitionAutoRun`, assignment services และ `runAutoExecutionCycle` เดิม การ retry ตรวจ queue/account/owner ก่อนส่งเข้า publishing action เดิม ซึ่งตรวจสิทธิ์/consent/idempotency อีกครั้ง

**ยังมี active-owner-run limit ของ AUTO เดิม**: การมี 10 การ์ดไม่ได้แปลว่าเริ่ม AUTO 10 run พร้อมกันได้ START ของบัญชีอื่นรอ active run ของ owner จบก่อน ตรวจ scope ที่กลับจาก atomic run lock ซ้ำก่อน schedule execution เพื่อไม่เริ่มงานของบัญชีอื่นโดยผิดการ์ด

STOP รายบัญชีแสดงและทำงานได้เฉพาะ run ที่มี account state ของบัญชีนั้นเพียงบัญชีเดียว ถ้าเป็น shared run จะไม่เสนอการหยุดจากการ์ดบัญชีเดียว และ server ตรวจเงื่อนไขนี้ซ้ำ ไม่เปลี่ยน behavior ของ AUTO core

- START อยู่ใกล้สถานะบัญชีและแสดงตลอด; ตั้งค่าพับไว้ก่อนทุกการ์ด เพื่อให้หลายบัญชีบนมือถือไม่กลายเป็นแบบฟอร์มยาว
- โหมด AUTO/GROWTH/AFFILIATE, daily target และ daily budget ใช้กับ run ที่กำลังจะเริ่ม ภายใต้ limits เดิม ไม่อ้างว่า save account preferences ถาวรแล้ว
- วิธีเผยแพร่รองรับ AUTO ตาม path ปัจจุบัน ตัวเลือก DRAFT/EXPORT ยัง disabled; ไม่เพิ่ม draft-upload integration หรือ export engine
- แสดง scheduled post ที่มีจริง แต่ยังไม่เปิด recurring schedule window หรือ automation policy ใหม่
- หมวดสินค้า/ความสนใจอ่านจากข้อมูลบัญชีเดิม; การแก้ category affinity และตั้ง automation ประจำยังไม่เปิดให้แก้จากหน้านี้ ไม่มี fake save state
- Retry มีเฉพาะคลิปที่ผ่าน server-side eligibility projection และต้องผ่าน authorization ของ service เดิมอีกครั้ง ไม่เรียก retry จาก browser verification

## Shared performance contract และภาพสรุป

`performance-events.ts` กำหนด event กลางสำหรับ POST/LIVE: owner/account/product, creative/script/hook references, timestamp, views/comments/clicks, units/sales/commission/currency, audience questions และ live duration

POST ใช้ `CUMULATIVE_SNAPSHOT`; LIVE ใช้ `SESSION_TOTAL` แยก measurement ชัดเจน Validator ตรวจ ownership/account membership, observed evidence และ currency ก่อนรับเงิน Event key รองรับ deduplication และ `PerformanceEventSink` กำหนด durable append-once boundary สำหรับเชื่อม Learning เดียวกัน

รอบนี้มี adapter อ่าน POST observations จริงและ forwarding contract/test แล้ว **ยังไม่ได้สร้าง LIVE producer หรือ durable ingestion service ใหม่ที่ทำให้ทุก LIVE event เข้า Learning อัตโนมัติ** จึงไม่อ้างว่า live sales/comments/learning integration ผ่าน production แล้ว

Home มี “สร้างภาพสรุป” เลือกทุกบัญชีหรือบัญชีเดียวและวันนี้/7 วัน/30 วัน ดาวน์โหลด PNG จาก browser ใช้ DTO/owner-authenticated overview API เดียวกัน ไม่มีเลขตัวอย่างใน customer path ข้อมูลไม่ทราบแสดง `—`; rank และเงินใช้ observation/currency จริง

## LIVE: ห้องแยกและ measured capacity

Local Agent เก็บ sessions ตาม owner/account และ `ManagedRuntimeWorker` แยก inherited-pipe child process ต่อ physical room ภายใน child ใช้ `LocalWorkerBoundary`, presenter/audio/encoder/stream lifecycle เดิม การ Start ซ้ำบัญชีเดิมถูกกันไว้ routing ของ Pause/Resume/Stop/preview ใช้ session ของบัญชีที่เลือก ไม่หยุดหรือสลับสินค้าของอีกห้อง

ห้องหนึ่ง crash/timeout แสดงปัญหาเฉพาะห้องนั้น; Windows process ownership/job isolation ปิด child ที่รับผิดชอบ ไม่ฆ่าห้องอื่น เมื่อ Stop ยืนยัน child ที่ตายแล้วจะไม่สร้าง child ใหม่เพื่อส่ง Stop ไป session ที่ child ใหม่นั้นไม่รู้จัก

Concurrency **ไม่เปิดจากชื่อ GPU หรือค่าใน browser**: Agent ต้องอ่าน signed capacity evidence ที่ตรง owner/device/component versions/hardware fingerprint, ยังไม่หมดอายุ และผ่าน trust verification ก่อนรับห้องเพิ่ม ขาด evidence เป็น `UNVERIFIED_CAPACITY`, จำนวนสูงสุดเป็น `null`, Start ถูกปิดไว้ Hard upper bound 10 ใน code เป็น safety bound ไม่ใช่ผล benchmark ว่าเครื่องรองรับ 10 ห้อง

Tests ใช้ explicit test-only evidence/runtime boundaries เพื่อพิสูจน์ owner/account isolation และ failure handling ไม่มีการติดตั้ง evidence จำลองให้ customer runtime จำนวนห้องจริงที่รับไหวและ native GPU resource isolation ยังต้อง benchmark NVIDIA แบบ 1/2/3 ห้อง

Managed child ในรอบนี้แยก **generic transport lifecycle** แต่ยัง reuse generic managed destination config ไม่ใช่ official per-account TikTok LIVE broadcast routing ไม่มี TikTok LIVE credentials/eligibility/transport จริงและไม่ได้ใช้ private API หรือดึง stream key

ข้อจำกัดที่ยังคงอยู่:

1. MuseTalk/FasterLivePortrait/Ditto/Hybrid real incremental GPU backends, gesture sources, measured occlusion/quality detectors และ pack/voice runtime binding ยังรอการต่อ/ตรวจบน NVIDIA
2. ต้องวัด FPS/latency/VRAM/A/V/receiver/reconnect/Stop-release จริงก่อนออก signed capacity evidence ไม่มีผลใหม่ที่สร้างจาก mock tests
3. Speak Now/Change Product ยังไม่มี customer local execution endpoints ที่ทำงานจริง ปุ่มยัง disabled ไม่สร้าง event ปลอมเพื่ออ้างว่าพูดหรือเปลี่ยนสินค้าแล้ว
4. Real platform comments, LLM/TTS/customer conversational execution และ official TikTok LIVE transport ยังไม่ผ่าน customer production end-to-end
5. Presenter thumbnails เป็นภาพอ้างอิง; renderer-generated preview ต้องผ่าน validation gate ภาพอ้างอิงไม่ใช่หลักฐาน realtime lip-sync

## Verification และขอบเขตหลักฐาน

Browser รอบนี้ใช้ **development-only fixtures 10 accounts** กับ customer components จริงเพื่อตรวจ layout/interaction ที่ไม่ส่งงาน ไม่มี fixture records หรือ mock fallback ใน customer production loader ภาพเหล่านี้ไม่ใช่ Production E2E และไม่พิสูจน์ NVIDIA/TikTok LIVE broadcast ไม่มี paid call, publish, merge หรือ deploy

ตรวจ Home/POST/AI LIVE ที่ 1440/1280/768/390 px ด้วย 10 การ์ด; document width เท่ากับ viewport ไม่มี horizontal overflow, clipping, application errors หรือ implementation strings บนหน้าลูกค้า หลังพบ mobile POST ยาวเกินไปจึงพับ settings ทุกบัญชีและย้าย START ขึ้นก่อน metrics ปุ่ม START แรกที่ 390 px อยู่ที่ top 637 px ภาพสรุป canvas จริงขนาด 1200 × 1670 px ดาวน์โหลดได้

ตรวจ navigation จาก POST card ไป drill-down ของบัญชีนั้น และ Presenter wizard ครบ 6 ขั้นบนมือถือ: ถอดรหัสไฟล์ PNG จริงขนาด 600 × 800 px, preview โหลดได้ และบันทึก configuration ผ่าน development callback โดยยังแสดง motion/voice ว่ารอการเตรียม ไม่อ้าง presenter สำเร็จ ตรวจ decoder เพิ่มด้วย PNG 1440 × 4215 px ผ่านเช่นกัน การ upload ภาพหน้าจอผ่านเครื่องมือ browser ชุดแรก timeout จึงแยกตรวจด้วยไฟล์ PNG ที่สร้างภายใน browser; นี่ไม่ใช่การทดสอบติดตั้ง/บันทึก presenter ผ่าน Production

ชุด room-control fixture ตรวจคำสั่ง `pauseAccount(A)` → `resumeAccount(A)` → `stopAccount(B)` แล้วพบเพียงสามคำสั่งที่ scope ตรงบัญชี ปุ่ม Stop ของ A ยังใช้ได้และ B ถูกปิด ไม่มี console errors หรือ overflow ผลนี้พิสูจน์ UI routing; Python/TypeScript isolation tests เป็นหลักฐาน execution boundary ส่วน real multi-room stream บน NVIDIA ยังไม่ผ่าน benchmark

ภาพหลักฐานเก็บเป็นไฟล์ local ที่ Git ignore ใน `.ai-live-dev/` ไม่ถูกนำเข้า customer application:

- Home desktop: `multi-account-customer-ui-proof/screenshot-1791260764675.png`
- POST desktop: `multi-account-customer-ui-proof/screenshot-1791283092390.png`
- POST mobile: `multi-account-customer-ui-proof/screenshot-1791283100652.png`
- AI LIVE desktop: `multi-account-live-ui-proof/screenshot-1791283095602.png`
- AI LIVE mobile: `multi-account-live-ui-proof/screenshot-1791283103807.png`
- Presenter wizard mobile: `multi-account-live-ui-proof/screenshot-1791283595680.png`

| Quality gate | หลักฐานก่อน final verify | ผลล่าสุด |
| --- | --- | --- |
| TypeScript relevant suites | 226/226 ผ่าน ก่อน regression timestamp/period เพิ่มครั้งสุดท้าย | 227/227 ผ่านใน 42 files |
| Python suites | 317 tests: 315 ผ่าน / 2 opt-in skips | 315 ผ่าน / 2 opt-in skips, exit 0 |
| Typecheck | ผ่าน | ผ่าน |
| Lint | 0 errors / 8 existing warnings | 0 errors; 8 warnings เดิมใน `video-benchmark/runner.ts` และ `video/fal-wan.test.ts` |
| Production build ในเครื่อง | ผ่าน | ผ่าน; ไม่ได้ deploy |
| Browser / console / screenshots | development-only 10-account fixtures; desktop/tablet/mobile | Home/POST/AI LIVE ครบ 4 ขนาด; errors/overflow/clipping 0; share PNG ดาวน์โหลดผ่าน; wizard 6 ขั้นและ room-control routing ผ่าน |

ดู [AI LIVE Architecture](AI_LIVE_ARCHITECTURE.md) และ [Digital Human](AI_LIVE_DIGITAL_HUMAN.md) สำหรับ renderer/installer/streaming boundaries หลักฐาน CPU direct streaming เดิมยังเป็นหลักฐาน session เดียว ไม่ถือเป็น multi-room NVIDIA proof
