# ViralFlow AI — Final Production Readiness Handoff

วันที่ audit ล่าสุด: 2026-09-23

Phase 11C starting point: branch **feature/fal-wan-primary-provider**, HEAD **f0f54d421c76e4c6782301a48ee49efff97b81cb**

เอกสารนี้อ้างอิง repository และ Supabase project **viralflow-ai** ณ วันที่ audit เท่านั้น

## A. Current exact repository state

- Stack: Next.js 16.3.5 App Router, React 19.3.0, TypeScript 6.0.3, Tailwind CSS 4.3.3, Supabase JS/SSR 2.116.0
- Package manager: pnpm 11.19.0; Node.js ขั้นต่ำ 24
- Local migrations: 17 ไฟล์ ตั้งแต่ Phase 1 ถึง Phase 11C
- Live migrations: 17 รายการ โดย `phase_11c_recovery_observability` ถูก apply สำเร็จหนึ่งครั้ง
- Phase 11B เพิ่ม `generation_budget_reservations`, 18 transaction RPC, publish lease/reconciliation state และ critical indexes 3 รายการ
- RLS เปิดบน `generation_budget_reservations`; authenticated อ่านได้เฉพาะ owner และเขียนได้เฉพาะ service role
- tiktok_oauth_credentials และ tiktok_oauth_states ใช้ FORCE RLS, ไม่มี client policy และไม่มี grant ให้ authenticated โดยตั้งใจ
- Storage bucket video-assets เป็น private และใช้ owner-path policies ครบ
- Security Advisor หลัง Phase 11C: ไม่มี finding ใหม่; มี warning leaked-password protection disabled และ info สองรายการสำหรับ service-only OAuth tables
- Performance Advisor: unindexed foreign keys 34 รายการ และ unused indexes 27 รายการ; ต้องยืนยันด้วย workload ก่อนแก้
- Live operational rows: auto_runs=0, publishing_queue=0, generation_jobs=0, tiktok_oauth_credentials=0, video_analytics_snapshots=0
- Tracked secret-pattern scan: ไม่พบ secret pattern ในไฟล์ที่ Git track หรือ commit history ที่สแกน
- Local environment มี FAL_KEY และ SUPABASE_SECRET_KEY แบบ server-only; TikTok production secrets ไม่ได้ตั้ง
- VIDEO_BENCHMARK_ALLOW_PAID=true และ cap 0.30 เป็น local benchmark gate เท่านั้น ไม่ใช่ Auto Mode permission
- fal ใช้ default state PRIMARY_CANDIDATE; ยังไม่ใช่ PRODUCTION_APPROVED
- Google key ไม่มี และ Google fallback ถูกปิด
- ยังไม่มี GitHub Actions, vercel.json, production worker/cron หรือ external alert routing; Phase 11C มี internal recovery endpoint, health, alerts และ operator UI แล้ว

Working tree ตอนเริ่ม audit มี AGENTS.md, CLAUDE.md และ next-env.d.ts ที่ dev server สร้าง ไฟล์เหล่านี้ไม่ใช่งาน product และต้องไม่รวมใน audit commit

## B. Architecture summary

~~~mermaid
flowchart LR
  Auth[Supabase Auth] --> App[Next.js App Router]
  App --> Radar[Product and Category Radar]
  Radar --> Assign[Account Product Assignment]
  Assign --> Creative[Creative Brain]
  Creative --> Video[Video Factory]
  Video --> Compliance[Compliance and Originality]
  Compliance --> Queue[Publishing Queue]
  Queue --> TikTok[TikTok provider boundary]
  TikTok --> Analytics[Analytics and Winner Detection]
  Analytics --> Growth[Growth Learning]
  Growth --> Auto[Auto Orchestration]
  Auto --> Assign
  DB[(Supabase Postgres and RLS)] --- App
  Store[(Private video-assets)] --- Video
~~~

ข้อมูลเจ้าของทุก domain ใช้ owner_id และ RLS เป็นขอบเขตหลัก Server actions เริ่มจาก auth.getUser() ก่อนส่ง owner ID ไปยัง service. OAuth credentials ใช้ server-only admin client และ AES-GCM. External providers ถูกครอบด้วย provider interfaces และ environment gates. Phase 10 ปัจจุบันเป็น planner/checkpoint UI; ยังไม่มี production worker ที่ทำ external calls.

## C. What is DONE

- Phase 1–5B: auth, protected routes, multi-account brain, Product Radar, Category Intelligence, assignment และ Creative Brain
- Phase 6: local FFmpeg Video Factory, master/variation, quality gate, cost evidence และ private storage
- Phase 6B: provider benchmark harness, Google Veo adapter และ fal Wan adapter; fal benchmark ล่าสุดล้มเหลวด้วย Forbidden และบันทึก actual spend $0
- Phase 6C: compliance, product truth, AIGC disclosure, originality, account health, capacity และ owner approval
- Phase 7A: TikTok OAuth/creator-info foundation, encrypted tokens และ mock provider
- Phase 7B: queue, consent, Upload Draft/Direct Post contracts, polling และ signed webhook foundation
- Phase 7C: TikTok Shop/commerce readiness foundation และ fail-closed Affiliate eligibility
- Phase 8: analytics, winner scoring และ bounded learning
- Phase 9: Growth learning, experiment planning และ milestone recheck
- Phase 10: durable run schema, planning, checkpoints, pause/resume/stop, scheduling และ budget calculation
- Audit fix: Auto Mode ใช้ falAutoModeAvailability; Google key ไม่สามารถเปิด provider gate และ fal ต้องมี key พร้อม state PRODUCTION_APPROVED
- Phase 11A: webhook จำกัด 64 KiB และรับเฉพาะ JSON, signature/timestamp/client key/envelope ถูกตรวจแบบ strict, OAuth/webhook/owner mutations ใช้ shared database rate limit, TikTok upload URL และ pull URL fail closed, storage path ผูก owner, error response ไม่เผยรายละเอียดภายใน และเพิ่ม security headers
- Phase 11B: enqueue/transition/webhook เป็น transaction, external publish ใช้ stable operation key และ renewable lease, timeout หลังเริ่ม submit เข้า `SUBMITTED_UNKNOWN`, paid generation ใช้ atomic reservation/settlement/release ครบ per-video/day/month/run/account/provider และ Auto START/RESUME เป็น transaction

## D. What must NOT be changed

- ห้ามเปิด paid provider, real TikTok publishing หรือ Shop attachment จากการมี key เพียงอย่างเดียว
- ห้ามตั้ง fal เป็น PRODUCTION_APPROVED ก่อน real benchmark และ owner visual approval
- ห้ามใช้ Google Flow consumer UI เป็น automated provider
- ห้ามย้าย OAuth tokens ไป client, public policy หรือ NEXT_PUBLIC
- ห้ามเขียน auth.users โดยตรง
- ห้ามลด RLS, owner checks, compliance, originality, consent, creator cap หรือ commerce gates
- ห้ามเปลี่ยน Growth เป็น Affiliate จาก follower count อย่างเดียว
- ห้าม automatic paid retry ก่อนมี atomic budget reservation และ provider reconciliation
- ห้ามแก้ migration ที่ apply แล้ว; schema change ใหม่ต้องเป็น migration ใหม่
- ห้าม deploy หรือ publish จริงใน Phase 11A–11F

## E. Findings

### P0 — ห้าม production จนกว่าแก้

| ID | Finding | Status | Impact |
|---|---|---|---|
| P0-01 | Auto provider gate เคยใช้การมี Google key เป็น readiness | FIXED | เปลี่ยนเป็น fal key + PRODUCTION_APPROVED; Google fallback ไม่เปิด Auto |
| P0-02 | Provider side effect กับ database state ต้อง crash-safe และห้าม blind retry | CLOSED 11B | lease แยก RESERVING/SUBMITTING; timeout หลังเริ่มส่งถูกพักใน SUBMITTED_UNKNOWN และ reconcile ก่อน retry; provider ที่ไม่มี idempotency API ใช้ fail-closed/manual resolution เมื่อไม่มี provider ID |
| P0-03 | Paid generation ต้องมี atomic budget reservation/settlement ledger | CLOSED 11B | advisory transaction lock และ unique logical key ป้องกัน concurrent overspend/duplicate reserve; uncertain submission คง hold จน reconcile |

P0 ด้าน reliability ปิดแล้ว แต่ real publishing และ paid Auto ยังต้องคงปิดจนกว่า Phase 11E–11F, provider/TikTok approvals และ owner pilot approval จะครบ

### P1 — ต้องแก้ก่อน pilot จริง

| ID | Finding |
|---|---|
| P1-01 | Supabase leaked-password protection ยังปิด |
| P1-02 | FIXED 11A — webhook จำกัดขนาดก่อน buffer และบังคับ JSON |
| P1-03 | FIXED 11A — OAuth, webhook และ authenticated mutation groups ใช้ shared database rate limit |
| P1-04 | FIXED 11A — upload/pull URL บังคับ HTTPS, exact host, safe port, no credentials/private IP และ no redirect |
| P1-05 | FIXED 11B — concurrent START serialize ต่อ owner และคืน run เดิมแบบ idempotent |
| P1-06 | FIXED 11B — run/states/actions/steps/checkpoints สร้างใน transaction RPC เดียว |
| P1-07 | FIXED 11B — enqueue, transition, webhook และ external submission evidence เขียนใน transaction |
| P1-08 | บาง Video Factory execution/evidence tables ให้ authenticated owner insert/update โดยตรง ต้องแยก user intent จาก server-attested status/cost |
| P1-09 | PARTIAL 11E — GitHub Actions และ `release:check` บังคับ typecheck/lint/test/build ใน CI; owner ต้องเปิด branch protection และ 11F ต้องตรวจ release gates (next.config.ts ยังใช้ ignoreBuildErrors=true โดยมี typecheck แยก) |
| P1-10 | PARTIAL 11E — recovery heartbeat/operator UI และ Vercel Cron config มีแล้ว; owner ต้อง deploy/ตั้ง secret/เปิด scheduler หลัง sign-off |
| P1-11 | PARTIAL 11E — structured logs, internal health/alerts และ generic alert webhook boundary มีแล้ว; external destination/on-call routing ยังไม่ตั้ง |
| P1-12 | PARTIAL 11E — backup/restore/incident/rollback checklist มีแล้ว; owner ยังไม่ทำ restore drill และ 11F ต้องเก็บ rollback evidence |
| P1-13 | fal benchmark ยังไม่สำเร็จและไม่มี owner quality/reliability approval |
| P1-14 | TikTok Login, Content Posting, Shop และ Analytics production approvals ยังไม่ยืนยันจริง |

### P2 — แก้ก่อน scale

1. ตรวจ 34 unindexed foreign keys ด้วย query plan/load test แล้วเพิ่มเฉพาะที่จำเป็น
2. อย่าลบ 27 unused indexes จากสถิติของฐานข้อมูลที่แทบไม่มี workload
3. กำหนด retention policy ของ evidence ที่ cascade เมื่อ owner/account ถูกลบ
4. ทำ load test สำหรับ 3 และ 10 accounts พร้อม concurrent writes
5. เพิ่ม browser E2E สำหรับ auth, owner isolation, approval และ recovery
6. เพิ่ม storage lifecycle, orphan reconciliation และ quota monitoring
7. เพิ่ม dependency vulnerability scan, SBOM และ patch cadence
8. paginate dashboard queries ที่โหลดหลาย collection พร้อมกัน

### P3 — Improvement

1. จัดรูปแบบไฟล์บรรทัดยาวหลังปิด production blockers
2. เพิ่ม accessibility และ visual regression audit
3. เพิ่ม localization/error copy catalog
4. สร้าง operational dashboard หลัง metrics contract คงที่

## F. Exact order of remaining tasks

ลำดับบังคับ: **11A → 11B → 11C → 11D → 11E → 11F → owner approvals → 11G**

### 11A — Security Hardening

**Status: DONE (2026-09-23)** — migration อยู่ใน local/live history อย่างละหนึ่งครั้ง, RLS ยังเปิด 59/59 public tables, Security Advisor ไม่มี finding ใหม่, tests 248/248 ผ่าน และ typecheck/lint/build ผ่านครบ ผลที่ยังต้องทำโดยเจ้าของคือเปิด leaked-password protection ใน Supabase Dashboard

- Objective: ปิด attack surface ก่อนเปิด endpoint ภายนอก
- Likely files: src/app/api/tiktok/webhooks/content-posting/route.ts, src/features/publishing/webhook.ts, provider.ts, OAuth routes, src/lib/server-env.ts, .env.example, next.config.ts
- Inspect first: env gates, official host requirements, signature tests, proxy auth และ client/server import graph
- Permitted: body-size/content-type guards, rate limit, upload-host/private-IP guard, CSP/security headers, sanitized errors, durable replay state
- Forbidden: เปิด real provider, เปลี่ยน scopes, ลด RLS, expose secret, เปลี่ยน scoring
- Tests: signature/timestamp/replay, oversized body, bad content type, rate limit, bad host/private IP, owner auth, secret scan, full suite
- Completion: ปิด P1-02/03/04; review Security Advisor; leaked-password เป็น owner action
- Commit: **fix: harden production security boundaries**
- STOP: push แล้วหยุด

### 11B — Reliability / Idempotency

**Status: DONE (2026-09-23)** — migration rollback validation ผ่านและ apply live หนึ่งครั้ง, transaction RPC ครบ 18 ตัว, budget table เปิด RLS/service-only write, deterministic suite เพิ่มเป็น 262 tests และ external modes ยังปิด Security Advisor ไม่มี finding ใหม่; เหลือ warning leaked-password และ info ของ OAuth service-only เดิม

- Objective: ทำ paid generation และ publishing ให้ crash/retry-safe
- Likely files: auto/services.ts, video/jobs.ts, cost-router.ts, provider adapters, publishing/services.ts และ migration ใหม่
- Inspect first: unique keys และทุก failure window ระหว่าง reserve/call/persist
- Permitted: transaction RPC, insert-on-conflict return-existing, budget reservation/settlement/refund, outbox/inbox, reconcile, lease
- Forbidden: automatic paid retry, silent publish, removing consent, changing provider approval
- Tests: concurrent START, lost response, DB failure after acceptance, duplicate webhook, stale lease, token failure, budget oversubscription
- Completion: ปิด P0-02/P0-03 และพิสูจน์ no duplicate paid call/post ใน recovery paths
- Commit: **fix: make external execution idempotent and budget safe**
- STOP: push แล้วหยุด ห้ามเปิด external mode

#### Publish state and recovery contract

`READY → RESERVING → SUBMITTING → SUBMITTED → CONFIRMED` คือเส้นทางปกติ ส่วนความล้มเหลวก่อนเริ่มส่งไป `FAILED_RETRYABLE` หรือ `FAILED_FINAL` ตาม policy เมื่อ lease หมดใน `RESERVING` ระบบนำกลับมาลองใหม่ได้ แต่ lease ที่หมดหลังเข้า `SUBMITTING` จะไป `SUBMITTED_UNKNOWN` และ `WAITING_FOR_RECONCILIATION` เสมอ

stable `external_operation_key` ผูก unique ต่อ owner และทุก attempt ของ logical operation เดิมใช้ key เดิมเป็นฐาน worker claim ใช้ transaction advisory lock พร้อม token/expiry ผู้ชนะเพียงรายเดียวจึงเริ่ม submit ได้ การตอบ webhook ซ้ำถูก deduplicate ด้วย provider event key และ update queue/event ใน transaction เดียว

TikTok Content Posting contract ปัจจุบันไม่มี idempotency key ที่เรายืนยันได้สำหรับ init request ดังนั้น timeout หลังส่งแต่ก่อนรับ `publish_id` ไม่สามารถพิสูจน์ผลจาก provider ได้ ระบบเลือกความปลอดภัยแบบ at-most-once: ห้ามส่งซ้ำอัตโนมัติและต้องให้ operator reconcile/ปิดรายการ หากมี `publish_id` จะ poll สถานะเดิมก่อน การจำกัดนี้ลด availability แต่ป้องกัน duplicate post

#### Atomic paid budget contract

ทุก paid logical operation ต้อง reserve ยอดสูงสุดก่อน call ภายใต้ owner advisory lock จากนั้นตรวจ cap `per-video`, `daily`, `monthly`, `run`, `account` และ `provider` ใน transaction เดียว reservation มีสถานะ `RESERVED`, `SETTLED`, `RELEASED`, `EXPIRED` และ provider state แยกต่างหาก การ reserve/settle/release ซ้ำใช้ logical key/row เดิมและไม่เพิ่มยอดซ้ำ

- provider ยังไม่ถูกเรียกและ reservation หมดอายุ: เปลี่ยนเป็น `EXPIRED` และคืนวงเงิน
- provider ปฏิเสธก่อนส่งแบบพิสูจน์ได้: `RELEASED`
- เริ่มส่งแล้ว timeout/crash: คง `RESERVED`, เปลี่ยนเป็น `SUBMITTED_UNKNOWN`, ห้าม retry/release อัตโนมัติ
- provider ยืนยันผล: `SETTLED`; actual ต้องไม่เกิน reserved และ ledger cost เขียนครั้งเดียว
- provider ยืนยันไม่คิดเงินภายหลัง: operator จึง release โดยระบุ known-not-submitted ได้

Recovery job เรียก `recover_publish_operations` และ `recover_generation_budget_reservations` ได้อย่าง idempotent หลัง worker restart; Phase 11C เพิ่ม scheduler service, alert และ operator UI แล้ว แต่ Phase 11E ยังต้องตั้ง production trigger ก่อน pilot

### 11C — Observability / Monitoring

- **Status: DONE (2026-09-23)**. Migration `20260923150000_phase_11c_recovery_observability.sql` อยู่ใน local หนึ่งไฟล์และ `phase_11c_recovery_observability` อยู่ใน live history หนึ่งรายการ (live version `20260922192051` จาก connector); สร้าง `operations_scheduler_runs`, `operations_incidents`, `operations_action_events`, `operations_alerts`, `operations_webhook_failures` โดยเปิด RLS ทั้งหมด เจ้าของอ่าน incidents/actions/alerts ได้เฉพาะของตน และ authenticated เขียนไม่ได้ RPC จัดการสงวนไว้ให้ service role
- Recovery service `runRecoveryCycle` ใช้ window 5 นาทีแบบ unique claim แล้วเรียก Phase 11B `recover_publish_operations` และ `recover_generation_budget_reservations` ก่อนสแกนคิว, budget, Auto และ generation jobs. งานที่เกิด side effect ภายนอกไม่ถูก resubmit. หากสแกนเกินขอบเขต 200 รายการต่อชนิด รอบตรวจล้มเหลวชัดเจน แทนการรายงานสุขภาพผิด
- Policy: `AUTO_RECOVERABLE` เฉพาะ pre-send lease/unsent reservation และ retryable publish ที่ไม่มี provider ID; `RECONCILIATION_REQUIRED` สำหรับ submitted unknown, post-send lease, provider pending และ Auto run ค้าง; `FINAL_FAILURE` สำหรับ retry หมดหรือ terminal failure. Unknown result คง budget hold และไม่มี force-retry
- Operator ที่ `/operations` เห็น account, operation, provider, first/last seen, reason, external ID, budget status และคำแนะนำ; action ผ่าน server auth, owner rate limit, service RPC ที่ lock แถว, owner-scope, unique idempotency key และ append-only audit. `MARK_CONFIRMED` หมายถึงยืนยันรหัส provider และเปลี่ยนไป `PROCESSING` เพื่อรอตรวจสถานะ **ไม่ใช่ยืนยันว่าโพสต์สำเร็จ**. การคืนงบจำกัดเฉพาะ reservation ที่ยังไม่ส่งคำขอ provider
- Dead letter ใช้ `operations_incidents` classification `FINAL_FAILURE`; รับทราบ/ปิดพร้อมหลักฐานได้โดยไม่ลบ evidence. Structured log บันทึก ID/state/error code ที่อนุญาตและ redact token/secret; ไม่บันทึก payload หรือ credential. Correlation ใช้ run/job/publish/reservation ID เดิม
- `/api/operations/health` ต้องมี Supabase user session และคืนข้อมูลเฉพาะ owner. `/api/operations/recovery` เป็น POST ที่ต้องมี `OPS_RECOVERY_TOKEN` แบบ server-only; หากไม่ได้ตั้งจะปฏิเสธทุกคำขอ. Internal alert records dedupe ตาม owner/rule/subject; webhook failure spike บันทึกเป็น minute counter และ structured warning
- **ข้อจำกัด:** ยังไม่ได้ตั้ง cron/worker ภายนอกจริง, alert destination/on-call, auth-refresh telemetry, full recovery browser E2E และ restore drill. ต้องตั้ง trigger กับ token ใน Phase 11E ก่อนถือว่า scheduler ทำงานจริง; health จะแสดง unhealthy เมื่อไม่มี heartbeat. Phase 11D ต้องตรวจ query/load, 11F ต้องเพิ่ม CI/E2E/runbook drill. ห้ามใช้หน้าจอนี้เป็นเหตุให้เปิด real publish หรือ paid Auto
- Objective: ตรวจพบและสืบเหตุได้โดยไม่ log secret
- Likely files: logging utility, auto/video/TikTok/publishing boundaries, health route และ runbook
- Inspect first: error paths, correlation IDs และ sensitive fields
- Permitted: structured logs, redaction, metrics, health/readiness, error adapter, alert thresholds
- Forbidden: log token/credential/raw webhook/user content ที่ไม่จำเป็น
- Tests: redaction, correlation, fail-closed readiness และ metric emission
- Completion: alerts ครอบคลุม queue age, failure, budget, webhook, stale worker และ auth refresh
- Commit: **feat: add production observability and health checks**
- STOP: push แล้วหยุด

### 11D — Performance / Database

**Status: DONE (2026-09-23)** — migration `20260923153000_phase_11d_performance_indexes.sql` อยู่ใน local หนึ่งไฟล์และ live `phase_11d_performance_indexes` หนึ่งรายการ (connector version `20260923024728`). ทดสอบ DDL ด้วย transaction rollback ก่อน apply; เพิ่ม 12 indexes, ไม่ลบ index เดิม, ไม่เปลี่ยน RLS/schema semantics. หลัง apply ตรวจ catalog พบครบ 12 และ RLS ยังเปิด 65/65 public tables.

**Query findings/fixes:** Publishing Queue, Video Factory, Operations และ Auto run history เคยอ่านรายการกว้างหรือดึงข้อมูลประกอบทั้ง owner; ตอนนี้หน้าแสดง 50 รายการต่อหน้า + 1 lookahead, ดึงข้อมูลประกอบเฉพาะ ID ในหน้านั้น และใช้ tie-break ID สำหรับลำดับคงที่. Analytics account/video/product detail กรอง owner + target ในฐานข้อมูล แทนการโหลด overview ทั้งหมดแล้วกรองในแอป. Video detail ดึง cost เฉพาะ job ที่แสดง. Recovery เคยสแกนได้สูงสุด 200 แถวต่อ state; เปลี่ยนเป็น keyset scan ทีละ 200 โดยมีเพดาน 10,000 และ fail-closed เมื่อเกินเพดาน. ไม่มีการเปลี่ยน scoring, provider หรือ authorization.

**Index evidence:** `EXPLAIN` ก่อนแก้พบ sort ใน owner/recent incident, owner/priority queue และ owner/recent master paths และ owner-only scan ก่อนกรอง video analytics. Indexes ใหม่ครอบคลุม owner/order pagination, owner/master job, owner/video/product time และ partial recovery state scans ตาม query ที่เรียกจริง. `EXPLAIN` หลังแก้บน live สำหรับ owner/recent incident ใช้ `operations_incidents_owner_seen_page_idx`. Live tables ส่วนใหญ่ยังว่าง/เล็กมาก จึงไม่อ้างว่าได้วัด latency ที่ 10 accounts หรือ 200 candidates/day แล้ว. Performance Advisor ยังแจ้ง 36 unindexed FK ซึ่งต้องพิจารณาตาม deletion/join workload ที่มีหลักฐาน; คำเตือน unused index บนฐานข้อมูลเล็กไม่ใช่เหตุให้ drop.

**Concurrency/scale:** ตรวจ transaction-backed START/transition, publish lease, budget reservation, webhook และ scheduler claims แล้วไม่เปลี่ยน lock/unique/reconciliation primitives. Live scheduler claim 8 คำขอพร้อมกันใน window ทดสอบเดียว: 1 true, 7 false; ลบแถวทดสอบแล้ว. Deterministic tests ครอบคลุม pagination 50/51 และ large input, recovery scan 200/201/2,000 พร้อม duplicate cursor/scan-limit fail-closed, และ fair schedule 10 accounts × 15/20 = 150/200 candidates โดยไม่เรียก provider. Existing tests ยังคุ้มครอง publish lease, atomic budget และ duplicate webhook. ยังไม่มี live DB contention test ของ concurrent publish/budget เพราะไม่มี account/queue test fixture ที่เหมาะสม; ต้องทำใน staging พร้อมข้อมูลสังเคราะห์ก่อน production scale.

**Retention/orphan policy:** ไม่ลบ append-only audit, cost, attempts, snapshots หรือ failure evidence อัตโนมัติใน phase นี้. Recovery scan เพดาน 10,000 จะหยุดแบบ fail-closed หาก backlog โตเกินขอบเขต; ต้องกำหนด archival/retention, orphan reconciliation และ restore policy หลัง backup/PITR sign-off ใน 11E/11F. UI detail histories ถูกจำกัดล่าสุด 100–500 ตาม service เพื่อป้องกัน payload โต; complete audit ยังคงอยู่ในฐานข้อมูล. Analytics overview ยังเป็น recent 500-row window จึงห้ามตีความ totals เป็น all-time เมื่อข้อมูลมากกว่าขอบเขตนี้.

**Advisors:** Security Advisor หลัง migration คง warning leaked-password protection และ info ของ OAuth service-only no-policy สองตาราง; ไม่มี finding ใหม่จาก 11D. Production readiness ตาม rubric ใน `PROJECT_MASTER_STATUS.md` คง 63%; coding completion คง 94% เพราะ CI/E2E/staging proof และ external approvals ยังไม่เสร็จ. Phase 11E และ 11F ยังคงค้าง; ห้ามเปิด real provider หรือ TikTok publishing จากผล load simulation นี้.

**Quality gate:** `pnpm typecheck` ผ่าน, `pnpm lint` ผ่านโดยมี warning เดิม 8 รายการ, `pnpm test` ผ่าน 278/278 (รวม FFmpeg ภายใต้สิทธิ์ที่อนุญาต), `pnpm build` ผ่าน. ไม่ได้เรียก paid provider, ไม่ได้ deploy หรือ publish TikTok.

- Objective: ยืนยัน query/index/retention สำหรับ concurrent accounts
- Likely files: migration ใหม่, analytics/publishing/auto/video queries และ load tests
- Inspect first: 34 FK findings, EXPLAIN plans และ row-growth estimates
- Permitted: evidence-backed indexes, pagination, bounded queries, retention/orphan reconciliation
- Forbidden: ลบดัชนีจาก unused warning อย่างเดียว, rewrite scoring
- Tests: query plans, 3/10-account load และ concurrent writes
- Completion: critical query latency documented และ Advisor reviewed
- Commit: **perf: harden database paths for pilot load**
- STOP: push แล้วหยุด

### 11E — Production Environment

**Status: DONE (code/config/docs, 2026-09-23)** — เพิ่ม GitHub Actions quality gates แบบไม่มี production secrets, `pnpm release:check` ที่ตรวจ environment/local migration uniqueness และรัน typecheck/lint/test/build, `vercel.json` สำหรับ Cron ทุก 5 นาที, endpoint GET แบบ constant-time `CRON_SECRET` พร้อม `OPS_RECOVERY_ENABLED=false` เป็นค่าเริ่มต้น, environment contract ของ development/staging/production, alert summary webhook แบบ best effort, และ scheduler health ที่แสดง last success/failure/recovery count. ใช้ recovery RPC/idempotent window ของ 11C เดิม; ไม่สร้าง migration, ไม่ deploy และไม่เปิด real provider/publishing.

**Verification:** local/live migration history 18/18 เดิม; tests 288/288 ผ่าน, typecheck/lint/build และ `pnpm release:check` ผ่าน (lint มี warning เดิม 8 รายการ). Tests ครอบคลุม unauthorized/authorized/duplicate Cron, stale health, staging real-publishing block, missing scheduler credentials, optional provider env และ alert-delivery failure หลัง recovery commit. GitHub-hosted CI ต้องผ่านก่อน merge; CI ใช้ system FFmpeg ที่มี `drawtext` หลังตรวจพบ bundled Linux binary ขาด filter นี้. Branch protection ต้องเปิดโดย owner.

รายละเอียด deployment prerequisites, secret ownership, Vercel/Supabase setup, Cron plan/health, incident startup, backup/restore, rollback และ release checklist อยู่ใน `docs/PRODUCTION_OPERATIONS.md`. Owner ยังต้องเชื่อม Vercel project/domain, ใส่ vault secrets, แยก Supabase staging/production, เปิด branch protection, ยืนยันแผน Cron ที่รองรับทุก 5 นาที, ตั้ง alert destination/on-call, เปิด leaked-password protection และทำ restore drill. Phase 11F ยังต้องพิสูจน์ staging E2E, rollback/release gates และ security scan; จึงห้ามถือว่า production launch approved.

- Objective: เตรียม staging/production config โดยยังไม่ deploy
- Likely files: .env.example, environment validation, Vercel/Supabase docs, disabled worker/cron config
- Inspect first: environment reads, defaults, server-only imports, region/timeouts
- Permitted: fail-closed production validation, secret ownership/rotation matrix, disabled schedules
- Forbidden: commit secret, deploy, enable paid/publishing flags
- Tests: production env matrix, missing-secret failure, public bundle scan, worker dry run
- Completion: platform vault พร้อมและ production boot fail ชัดเจนเมื่อ config ขาด
- Commit: **chore: prepare production environment boundaries**
- STOP: push แล้วหยุด

### 11F — Release Readiness

- Objective: สร้าง release gate และ rollback evidence
- Likely files: .github/workflows, next.config.ts, package scripts, E2E และ runbooks
- Inspect first: build behavior, migration sequencing, preview env และ branch protection
- Permitted: CI, type safety, tests/build, migration validation, security scan, release checklist
- Forbidden: production deploy หรือ destructive migration
- Tests: clean install, typecheck, lint, tests, build, migration validation, smoke E2E, rollback rehearsal
- Completion: merge/deploy ถูก block เมื่อ gate ล้มเหลว
- Commit: **ci: add production release readiness gates**
- STOP: push แล้วรอ owner actions

### 11G — 1-account Growth Pilot

- Objective: pilot หนึ่ง Growth account ด้วย cap ต่ำสุดและ human approval ทุก publish
- Likely files: production config, worker controls, operational views และ pilot runbook
- Inspect first: 11A–11F, TikTok/provider approvals, backup, alerts และ owner sign-off
- Permitted: account allowlist, low limits, kill switch, manual approval, observation
- Forbidden: Affiliate, multi-account, silent Direct Post, cap increase, paid auto retry
- Tests: staging rehearsal, reserved paid generation, draft upload first, reconcile, kill switch, restore
- Completion: owner sign-off ต่อ cost, quality, compliance, post status, analytics และ recovery
- Commit: **chore: prepare one-account growth pilot**
- STOP: report pilot; ห้ามขยายอัตโนมัติ

## G. Ready-to-paste prompts

ทุก prompt ด้านล่างมี guardrails เดียวกัน: ใช้ repository เป็น source of truth, ตรวจ branch/HEAD และ implementation ก่อนแก้, ระบุไฟล์ที่จะเปลี่ยน, ไม่ refactor งานอื่น, ไม่แก้ phase ที่เสร็จแล้วถ้าไม่จำเป็น, หลังแก้ต้อง typecheck/lint/test/build/commit/push และ STOP

### Prompt 11A

~~~text
ทำ Phase 11A Security Hardening เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.
Do not deploy, publish TikTok, call a paid provider, or weaken RLS.

แก้ FINAL_PRODUCTION_HANDOFF P1-02, P1-03 และ P1-04: hard webhook body limit ก่อน buffer, strict content type, rate limiting สำหรับ public OAuth/webhook boundaries และ fail-closed TikTok upload URL hostname/private-IP guard. รักษา signature, timestamp, replay idempotency, consent และ owner isolation

Before changing code: verify branch/HEAD, inspect implementation, list intended files.
Add tests for oversized payload, content type, rate limit, bad host/private IP, valid flow, signature/timestamp/replay และ secret redaction. Re-run Security Advisor. Leaked-password protection เป็น owner action.

After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; commit "fix: harden production security boundaries"; push; STOP.
~~~

### Prompt 11B

~~~text
ทำ Phase 11B Reliability / Idempotency เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.
Do not enable paid providers or real TikTok publishing.

ปิด P0-02 และ P0-03 ด้วย transaction-backed idempotency, durable leases, provider reconciliation, atomic queue/status evidence และ atomic budget reservation/settlement/refund ครบ run/account/provider/day/month. ใช้ migration ใหม่ ห้ามแก้ migration ที่ apply แล้ว.

Before changing code: verify branch/HEAD, inspect implementation, list files and failure windows.
Test concurrent START/generation, lost response, DB failure after external acceptance, duplicate webhook, worker restart, stale lease, token failure และ budget oversubscription. พิสูจน์ no duplicate paid call/post.

After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; validate migration; commit "fix: make external execution idempotent and budget safe"; push; STOP.
~~~

### Prompt 11C

~~~text
ทำ Phase 11C Observability / Monitoring เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.
Do not deploy or call external providers.

เพิ่ม structured logs, correlation IDs, redaction, health/readiness, metrics และ alert contracts สำหรับ auth, OAuth, provider, budgets, queue age, webhook, stale worker และ recovery. ห้าม log token, secret หรือ raw credentials.

Before changing code: verify branch/HEAD, inspect implementation, list intended files.
Test redaction, correlation, readiness และ metrics.
After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; commit "feat: add production observability and health checks"; push; STOP.
~~~

### Prompt 11D

~~~text
ทำ Phase 11D Performance / Database เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.
Do not remove indexes only because an empty database marks them unused.

ตรวจ 34 unindexed foreign keys กับ query filters/EXPLAIN เพิ่มเฉพาะ evidence-backed indexes ใน migration ใหม่, paginate unbounded reads, กำหนด retention/orphan reconciliation และสร้าง 3/10-account load tests.

Before changing code: verify branch/HEAD, inspect implementation, list intended files and plan evidence.
After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; re-run advisors; commit "perf: harden database paths for pilot load"; push; STOP.
~~~

### Prompt 11E

~~~text
ทำ Phase 11E Production Environment เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.
Do not deploy, add real secrets, or enable external modes.

สร้าง fail-closed staging/production validation, server-only secret ownership/rotation matrix, disabled-by-default worker/cron config และ Vercel/Supabase setup docs. รักษา mock defaults. ตรวจว่า secret ไม่เข้า NEXT_PUBLIC, client bundle, logs, errors หรือ client-readable rows.

Before changing code: verify branch/HEAD, inspect implementation, list intended files.
After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; commit "chore: prepare production environment boundaries"; push; STOP.
~~~

### Prompt 11F

~~~text
ทำ Phase 11F Release Readiness เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.
Do not deploy production.

เพิ่ม CI สำหรับ clean install, typecheck, lint, tests, build, migration validation, dependency/security scan, browser smoke E2E, staging checklist, rollback rehearsal และ incident runbook. ห้าม destructive migration.

Before changing code: verify branch/HEAD, inspect implementation, list intended files.
After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; commit "ci: add production release readiness gates"; push; STOP.
~~~

### Prompt 11G

~~~text
ทำ Phase 11G 1-account Growth Pilot เท่านั้น

Use repository as source of truth.
Do not refactor unrelated architecture.
Do not modify completed phases unless required by this task.

ทำต่อเฉพาะเมื่อ 11A-11F และ owner actions เสร็จ เตรียมหนึ่ง allowlisted Growth account ด้วย cap ต่ำสุด, transactional budget reservation, human approval ทุก publish, draft upload ก่อน Direct Post, kill switch, alerts และ rollback. ห้าม Affiliate, multi-account, silent publishing, paid auto retry หรือเพิ่ม cap.

Before changing code: verify branch/HEAD, inspect implementation, list files, prove prerequisites.
After changes: pnpm typecheck; pnpm lint; pnpm test; pnpm build; commit "chore: prepare one-account growth pilot"; push; STOP.
~~~

## External owner actions

1. เติม fal billing/credit แล้วทำ benchmark ใหม่ภายใต้ cap; ตรวจ Beauty/Home/Gadget และอนุมัติเมื่อผ่านเท่านั้น
2. ปิด VIDEO_BENCHMARK_ALLOW_PAID หลัง benchmark ถ้าไม่ต้องการ paid CLI run
3. เปิด Supabase leaked-password protection
4. ยืนยัน backup/PITR retention, restore owner และทำ restore drill
5. ขอ TikTok Login Kit, Content Posting, Direct Post audit, scopes, test users และ webhook approvals
6. ขอ TikTok Shop/Affiliate category/API approval, creator/seller authorization และ product attachment
7. ขอ TikTok Display/Analytics และ Shop Analytics permissions
8. ใส่ production secrets ผ่าน platform vault และกำหนด rotation owner
9. เลือก Vercel project/domain/region และ Supabase capacity
10. เลือก monitoring vendor, on-call owner และ alert destination
11. อนุมัติ pilot budget, daily cap, account allowlist, reviewer และ kill-switch owner

## Final GO / NO-GO matrix

| Level | Status | Owner action | Engineering action |
|---|---|---|---|
| Local development | READY | รักษาข้อมูลทดสอบเฉพาะ local | ใช้ mock providers และ quality suite |
| Technical pilot แบบ mock/local | READY | กำหนด test data | external calls = 0 |
| 1-account Growth pilot | BLOCKED | fal/TikTok approvals, secrets, backup, monitoring | 11A–11F และปิด P0-02/P0-03 |
| Real publishing pilot | BLOCKED | Content Posting approval/audit และ consent owner | exactly-once, reconcile, rate limits, observability |
| 3-account pilot | BLOCKED | account auth และ budget | ผ่าน 1-account pilot และ load test |
| 10-account scale | BLOCKED | capacity/cost/on-call approval | indexes, worker scaling, SLO, restore/load evidence |

## Audit conclusion

ระบบพร้อมสำหรับ local/mock technical validation แต่ยังไม่ production ready. Phase 11B ปิด external exactly-once และ atomic money reservation แล้ว; Phase 11D ปิด query/index/pagination ระดับ pilot โดยยังไม่มี production-sized latency proof. ตัวบล็อกที่เหลือคือ real provider evidence, TikTok approvals, production environment/operations, CI/release และ owner actions. ห้ามเปิด paid Auto Mode หรือ real publishing จนกว่า 11A–11F และ owner actions ที่เกี่ยวข้องจะเสร็จครบ

## FINAL CODEX COMPLETION — audit 2026-09-23

**สถานะ: PARTIAL; CODEX / REPOSITORY 96%; production readiness 69%.** ส่วนที่ระบุ Phase 11G ในเอกสารเดิมเป็นแผนประวัติที่ถูกยกเลิกแล้ว; ไม่มี Phase 11G หรือ Phase 12. งาน engineering ที่เหลือยังนับใน Phase 11F. ห้ามใช้ข้อความ `PHASE 11 COMPLETE` จนกว่า acceptance ครบจริง.

**CODEX / REPOSITORY — DONE:** หน้า Operator `/auto` มี account/mode/target/budget และสถานะจริง; START ใช้ transaction เดิมพร้อมตั้งงบแบบ atomic, PAUSE/RESUME/STOP ใช้ RPC เดิม; RESUME คง provider blocker. หน้า login/root พาผู้ใช้ไป Operator; เครื่องมือเดิมย้ายเข้า Advanced. RLS/privilege migration ปิด direct authenticated writes บน 11 attested tables และ storage write boundary. Browser mock account ยืนยัน START → `WAITING_FOR_PROVIDER`, PAUSE/RESUME, mobile smoke และไม่มี console warning บน Auto. Tests 292/292, typecheck, lint (0 errors/8 warning เดิม), build, `release:check` ผ่านเมื่อ FFmpeg รันในสภาพแวดล้อมที่อนุญาต. Test Auth user/account/run ถูกลบด้วย Auth Admin API แล้ว.

**CODEX / REPOSITORY — OPEN (P0):** ยังไม่มี production/sandbox executor ที่ consume `auto_actions` แล้วเรียก service chain จาก opportunity จน analytics/learning. ดังนั้น one-click happy/failure E2E ที่ร้องขอยังไม่ผ่าน และ START ยังเป็นการเริ่มแผน ไม่ใช่การจบ workflow อัตโนมัติ. ต้องเชื่อม worker เดิมกับ domain services, transaction/checkpoint/idempotency และ mock publisher โดยไม่ bypass gates; ทดสอบ provider unavailable, budget, compliance reject, unknown publish/reconciliation, scheduler, duplicate START และ STOP. **P1:** audit เขียนจาก Creative/Radar/Analytics เพิ่ม, staging browser/accessibility/release/restore evidence. ห้ามเปิด real publishing หรือ paid Auto จาก UI นี้.

**OWNER / EXTERNAL — ACTION REQUIRED:** เปิด leaked-password protection; จัด provider billing/quality approval, TikTok authorization/scopes/production audit/consent และ Shop/Analytics; provision staging/production secrets/domain/scheduler/alert owner; ทำ restore drill และอนุมัติ pilot. ข้อนี้ไม่ถูกนำมาสร้างเฟสใหม่ แต่ production readiness ยังต่ำกว่า 100%.
