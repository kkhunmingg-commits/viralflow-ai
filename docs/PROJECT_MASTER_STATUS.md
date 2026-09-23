# ViralFlow AI — Project Master Status

อัปเดตจาก repository, DB-backed execution test และ live Supabase audit วันที่ 2026-09-24

Baseline branch: **feature/fal-wan-primary-provider**

Phase 11F baseline HEAD ก่อนงานรอบนี้: **91a73bfff7a2a029d11fda993aae714ef75d841e**

> สถานะล่าสุด 2026-09-24: Phase 11F **CODE COMPLETE** ตาม production-path contract และ DB-backed E2E; production GO ยัง **BLOCKED** ด้วย owner/external actions. ข้อความ audit ลงวันที่ 2026-09-23 ท้ายไฟล์เป็นประวัติ ไม่ใช่สถานะปัจจุบัน

## Executive status

| Metric | Result | Calculation |
|---|---:|---|
| Coding completion | **100%** | 100/100 engineering acceptance points ใน scope Phase 0–11F |
| Production readiness | **ไม่ประเมินเปอร์เซ็นต์ใหม่ในงานปิด 11F** | production GO ยังถูกบล็อกด้วย owner/external gates |
| Overall completion | **ไม่ประเมินเปอร์เซ็นต์ใหม่ในงานปิด 11F** | หลีกเลี่ยงการนำคะแนน release เก่ามาอ้างเป็นสถานะปัจจุบัน |

คะแนน code 100% หมายถึง acceptance ของ Phase 0–11F ใน repository เท่านั้น ไม่ได้แปลว่า production launch พร้อม. ตาราง production-readiness rubric ด้านล่างเป็นบันทึกการตรวจเมื่อ 2026-09-23 และไม่ได้ถูกคิดคะแนนใหม่ในงานนี้

### Coding completion rubric

| Area | Weight | Earned | Evidence |
|---|---:|---:|---|
| Foundation, auth, protected UI | 8 | 8 | Next.js/Supabase flow และ owner-authenticated routes |
| Product, category, assignment brains | 12 | 12 | deterministic scoring, persistence และ UI |
| Creative Brain | 8 | 8 | generate/select/edit/reject/regenerate และ risk/cost metadata |
| Video Factory | 10 | 10 | FFmpeg/master/variation/storage, fal production adapter และ actual-frame verification เชื่อมแล้ว; approval เป็น external gate |
| Compliance and originality | 10 | 10 | gates และ Phase 11A external-boundary hardening complete |
| TikTok OAuth and publishing foundation | 12 | 12 | official provider boundary, transaction queue, lease, consent และ fail-closed reconciliation; approval เป็น external gate |
| Shop and Affiliate foundation | 8 | 8 | readiness/attachment boundary และ fail-closed eligibility; real authorization เป็น external gate |
| Analytics and Growth learning | 12 | 12 | TikTok production ingestion adapter, snapshots, winner/learning เชื่อมใน execution path |
| Auto orchestration | 12 | 12 | atomic START/transition/budget, worker/checkpoint และ production service path ผ่าน DB E2E |
| Tests and engineering docs | 8 | 8 | 327 unit/contract tests ผ่าน; opt-in DB E2E ผ่านแยก พร้อม pause/resume/stop/replay; build ผ่าน |
| **Total** | **100** | **100** | |

### Production readiness rubric — historical snapshot, 2026-09-23

| Control | Weight | Earned | Evidence |
|---|---:|---:|---|
| Authentication, RLS, owner isolation | 15 | 13 | 65/65 tables RLS; leaked-password protection pending |
| Secret/config boundaries | 10 | 9 | server-only validation, redacted errors, security headers และไม่มี client import violation; production vault/rotation pending |
| External-call safety | 15 | 13 | lease, stable key, unknown-state reconciliation และ no blind retry complete; real provider evidence pending |
| Money/budget safety | 10 | 10 | atomic reserve/settle/release และ six-dimensional caps complete |
| Data integrity/recovery | 10 | 9 | atomic Auto/publish writes, bounded recovery scans และ operator tooling complete; production scheduler pending |
| Observability/incident response | 10 | 7 | structured logs, health, internal alerts และ optional webhook/cron contract; external destination/runbook drill ยังไม่ยืนยัน |
| CI/release/deployment | 10 | 5 | GitHub Actions + `release:check` + Vercel Cron config; branch protection/staging/rollback gate ยังไม่ยืนยัน |
| Backup/restore/operations | 10 | 2 | backup/restore runbook พร้อม; owner ยังไม่ทำ restore drill/ownership evidence |
| Real provider/TikTok approvals | 10 | 0 | fal benchmark failed; TikTok scopes/audit/Shop/Analytics pending |
| **Total (historical)** | **100** | **68** | ไม่ใช่คะแนน readiness ปัจจุบัน |

## Phase status

| Phase | Scope | State | Production note |
|---|---|---|---|
| 0 | Architecture | DONE | approved baseline |
| 1 | Next.js, Supabase, Auth | DONE | leaked-password protection owner action |
| 2 | Multi-account brain | DONE | live owner isolation verified previously |
| 3 | Product Radar | DONE | real source ingestion adapter remains future work |
| 4 | Category Intelligence | DONE | deterministic scoring complete |
| 5A | Account-product assignment | DONE | diversification/idempotency complete |
| 5B | Creative Brain | DONE | mock default; real model optional |
| 6 | Video Factory | DONE | local renderer/storage/quality complete |
| 6B | Provider benchmark | PARTIAL (external) | harness/adapter complete; real fal evidence failed Forbidden และยังไม่มี owner approval |
| 6C | Compliance/originality | DONE | production endpoint hardening pending |
| 7A | TikTok OAuth | DONE (code) | real app setup/approval ยังเป็น owner/external action |
| 7B | Publishing queue | DONE | transaction queue/lease/reconciliation complete; real TikTok approval remains external |
| 7C | TikTok Shop | DONE (code) | real authorization/attachment ยังเป็น owner/external action |
| 8 | Analytics/learning | DONE (code) | production ingestion adapter/learning เชื่อมแล้ว; real data access ยังต้องขอสิทธิ์ |
| 9 | Growth Engine | DONE | real evidence stream pending external access |
| 10 | Full Auto Mode | DONE (code) | planner, budget ledger และ execution worker อยู่ใน production service path เดียวกัน |
| 11A | Security Hardening | DONE | P1-02/P1-03/P1-04 closed; leaked-password protection remains owner action |
| 11B | Reliability / Idempotency | DONE | P0-02/P0-03 and P1-05/P1-06/P1-07 closed |
| 11C | Recovery / Observability | DONE | recovery service, operator UI, internal health/alerts; external schedule ยังรอ 11E |
| 11D | Performance / Database / Concurrency | DONE | bounded pages, recovery keyset scan, 12 evidence-backed indexes; large-data latency ยังไม่วัด |
| 11E | Production engineering / CI / scheduler | DONE | repo config พร้อม; owner ยังต้อง provision platform/secrets และเปิด scheduler หลัง sign-off |
| 11F | One-click operator และ release completion | DONE (code) | DB-backed START→COMPLETED และ PAUSE/RESUME/STOP/replay ผ่าน; production GO รอ owner gates |

## Verified repository and database state

- 23 local migrations and 23 live migrations; `phase_11f_auto_execution_processor` และ `phase_11f_auto_creative_worker` ปรากฏอย่างละหนึ่งครั้งใน logical history
- Phase 11F owner tables/RPC ตรวจ RLS และ service-role-only write boundary แล้ว; Creative worker RPC ให้ execute เฉพาะ service role ไม่ให้ anon/authenticated
- Phase 11C tables have owner-read/service-write boundaries; scheduler and webhook counters are service-only
- video-assets bucket private with owner-path RLS
- OAuth credentials/states service-only and FORCE RLS
- Security Advisor หลัง Phase 11F: WARN leaked-password protection disabled หนึ่งรายการ และ INFO สองรายการของ OAuth service-only no-policy ตามเดิม; ไม่มี finding ใหม่จาก migration ล่าสุด
- Performance Advisor after Phase 11D: 36 unindexed FK findings; ไม่เพิ่ม/ลบ index ตามคำเตือนเพียงอย่างเดียวโดยไม่มี query evidence
- หลัง DB E2E cleanup ตรวจ temp Auth users/accounts/products เหลือ 0; การทดสอบไม่ได้เรียก fal แบบเสียเงินหรือเผยแพร่ TikTok จริง
- No matching real secret pattern in tracked files/history scan
- Phase 11B verification: migration rollback validation/live apply ผ่าน, 18 reliability RPC, RLS และ critical indexes ตรวจจาก catalog แล้ว; typecheck/build ผ่าน, lint 0 errors กับ 8 warning เดิม และ tests 262/262 ผ่าน
- Phase 11C verification: local migration เรียงหลัง 11B, live migration ชื่อเดียวกันหนึ่งรายการ, scheduler claim และ cross-owner RPC test ผ่านในธุรกรรม rollback; typecheck/build ผ่าน, lint 0 errors กับ 8 warning เดิม และ tests 269/269 ผ่าน
- Phase 11D verification: 12 indexes อยู่ใน live catalog, RLS 65/65, query plan ของ owner/recent incident ใช้ index ใหม่; scheduler claim พร้อมกัน 8 คำขอได้สิทธิ์ 1 คำขอ แล้วลบแถวทดสอบ; live tables ยังเล็ก จึงยังไม่มี production-sized latency evidence
- Historical Phase 11E snapshot: ตอนนั้น local/live ยัง 18/18 และ tests 288/288 ผ่าน; ตัวเลขนี้ไม่ใช่ head ปัจจุบัน
- Phase 11F current verification: unit/contract tests 327 ผ่าน, opt-in DB E2E ผ่านแยก (รวม PAUSE/RESUME, STOP, analytics replay), typecheck/lint/build และ `pnpm release:check` ผ่าน; lint มี 0 error และ 8 warnings เดิม. Production service/orchestrator path ใช้จริง โดย mock เฉพาะ fal/TikTok network และ vision review; FFmpeg ดึงเฟรมจริงจากวิดีโอทดสอบ

## Master flow

~~~mermaid
flowchart TD
  Start[Owner starts or schedules run] --> Auth{Authenticated owner?}
  Auth -->|no| Login[Login]
  Auth -->|yes| Accounts[Load owner accounts and readiness]
  Accounts --> Mode{Resolve effective mode}
  Mode --> Radar[Product and Category Radar]
  Radar --> Assignment[Rank product x category x account]
  Assignment --> Creative[Creative Brain creates 8-second intent]
  Creative --> Provider{Approved video provider and budget reservation?}
  Provider -->|no| WaitProvider[WAITING_FOR_PROVIDER or BUDGET]
  Provider -->|yes| Master[Generate one provider master]
  Master --> Quality{Technical quality >= 85?}
  Quality -->|no| Reject[Reject or human-reviewed retry policy]
  Quality -->|yes| Variations[Create controlled local variations]
  Variations --> Compliance{Compliance + truth + AIGC + originality}
  Compliance -->|fail| Hold[Reject, regenerate or hold]
  Compliance -->|pass| Commerce{Affiliate commerce required?}
  Commerce -->|yes| Shop{Shop, product, cart and region ready?}
  Shop -->|no| GrowthFallback[Remain Growth; no fake commerce CTA]
  Shop -->|yes| Consent
  Commerce -->|no| Consent{Owner consent and publish capacity?}
  GrowthFallback --> Consent
  Consent -->|no| WaitApproval[WAITING_FOR_APPROVAL or SLOT]
  Consent -->|yes| Queue[Durable publishing queue]
  Queue --> External{Real mode and approvals enabled?}
  External -->|no| Mock[Mock/local result only]
  External -->|yes| TikTok[TikTok Upload Draft or Direct Post]
  TikTok --> Status[Poll/webhook/reconcile]
  Status --> Analytics[Analytics observations]
  Analytics --> Winner[Winner detection]
  Winner --> Learning[Account-local learning]
  Learning --> Assignment
~~~

## Growth flow

~~~mermaid
flowchart LR
  G1[Growth account] --> G2[Product/category content fit]
  G2 --> G3[Growth creative: follow, save, comment, share]
  G3 --> G4[Quality and originality]
  G4 --> G5[Consent, health and cap]
  G5 --> G6[Publish when production gate exists]
  G6 --> G7[Retention and follower evidence]
  G7 --> G8[Growth score and one-axis experiment]
  G8 --> G3
  G7 --> G9{Follower milestone}
  G9 -->|yes| G10[Recheck authoritative Shop/cart permissions]
  G10 -->|not ready| G1
  G10 -->|ready| A1[Affiliate eligibility]
~~~

## Affiliate flow

~~~mermaid
flowchart LR
  A1[Requested Affiliate or AUTO] --> A2{Follower + Shop creator + auth + cart + region}
  A2 -->|fail| A3[Effective Growth]
  A2 -->|pass| A4[Commerce-eligible product]
  A4 --> A5[Affiliate creative with truthful CTA]
  A5 --> A6[Compliance + product truth + originality]
  A6 --> A7[Shoppable intent metadata]
  A7 --> A8[Consent and publish cap]
  A8 --> A9[Publish boundary]
  A9 --> A10[Delayed conversion evidence]
  A10 --> A11[Affiliate winner/learning]
~~~

## Auto Mode flow

~~~mermaid
stateDiagram-v2
  [*] --> STARTING
  STARTING --> WAITING_FOR_PROVIDER: fal not approved or key absent
  STARTING --> BLOCKED: budget/account failure
  STARTING --> WAITING_FOR_DATA: analytics stale
  STARTING --> WAITING_FOR_SLOT: no capacity
  STARTING --> WAITING_FOR_APPROVAL: consent required
  STARTING --> RUNNING: all gates pass
  RUNNING --> PAUSED
  PAUSED --> RUNNING
  RUNNING --> RETRY_PENDING: bounded transient failure
  RETRY_PENDING --> RUNNING: reconciled retry
  RETRY_PENDING --> FAILED: retry limit
  RUNNING --> COMPLETED
  RUNNING --> STOPPED
~~~

ปัจจุบัน Phase 10 สร้างแผนและหลักฐาน local เท่านั้น Audit แก้ provider gate ให้ fal ต้องเป็น PRODUCTION_APPROVED; Google key ไม่เปิด Auto Mode

## Video provider flow

~~~mermaid
flowchart TD
  V1[Creative project] --> V2{fal key present and PRODUCTION_APPROVED?}
  V2 -->|no| V3[WAITING_FOR_PROVIDER]
  V2 -->|yes| V4{Atomic budget reservation?}
  V4 -->|no| V5[BLOCKED until Phase 11B]
  V4 -->|yes| V6[fal Wan 2.2 Turbo]
  V6 --> V7[Store original provider output]
  V7 --> V8[Normalize copy with FFmpeg]
  V8 --> V9{Quality >= 85 and owner approval?}
  V9 -->|no| V10[Reject/hold]
  V9 -->|yes| V11[Master + local variations]
  V2 -. fallback disabled .-> V12[Google Veo]
~~~

Provider status:

- fal Wan 2.2 Turbo: PRIMARY_CANDIDATE; real benchmark attempts failed Forbidden; not production approved
- Google Veo: integration exists; FALLBACK_DISABLED
- PixVerse/Runway: benchmark candidates only
- Meta/Vibes and Google Flow: MANUAL_BENCHMARK_ONLY where applicable
- TikTok Symphony: NOT_RUN unless legitimate API access exists

## TikTok compliance flow

~~~mermaid
flowchart TD
  C1[Approved video] --> C2{Product truth}
  C2 -->|fail| Reject
  C2 -->|pass| C3{Prohibited claims/risk}
  C3 -->|fail| Reject
  C3 -->|review| Review
  C3 -->|safe| C4{AIGC disclosure present}
  C4 -->|no| Hold
  C4 -->|yes| C5{Originality and cross-account uniqueness}
  C5 -->|fail| Regenerate
  C5 -->|pass| C6{Account health and cap}
  C6 -->|fail| QueueNextDay
  C6 -->|pass| C7{Commerce gates if Affiliate}
  C7 -->|fail| GrowthOnly
  C7 -->|pass| C8{Exact owner consent snapshot}
  C8 -->|no| Wait
  C8 -->|yes| PublishBoundary
~~~

## Historical planning snapshot — superseded by 2026-09-24 verification above

### DONE

- Core application, scoring engines, Creative Brain, local Video Factory, compliance/originality, Growth Engine
- Supabase schema/RLS/storage foundation
- Mock providers and deterministic test fixtures
- Provider state remains fail-closed after audit fix
- Phase 11A: bounded JSON webhook input, strict signature/envelope validation, shared database rate limiting, authenticated mutation throttling, upload/pull URL guards, storage ownership validation, error redaction และ baseline security headers

### PARTIAL

- Provider benchmark: infrastructure complete, real fal evidence failed
- TikTok OAuth/publishing/Shop/Analytics: contracts complete, production authorization absent
- Auto Mode: durable planner, idempotent start และ atomic budget reservation complete; production executor ยังไม่เปิด
- Production operations: Phase 11C recovery/health/operator queue, Phase 11D bounded queries/indexes และ Phase 11E Cron/CI contract complete; owner ยังต้องเปิด scheduler/on-call, พิสูจน์ production-sized load และ restore drill

### PLANNED

- Phase 11F Release Readiness
- Historical Phase 11G idea was cancelled; one-account Growth pilot remains an owner-governed release gate, not a new phase

## Historical P0/P1 blockers — superseded

### P0 open

ไม่มี P0 ด้าน code architecture หลัง Phase 11E; production ยังถูก block ด้วย Phase 11F และ external/owner approvals

### P1 open

1. Leaked-password protection disabled
2. Server-attested execution data needs tighter write boundaries
3. CI workflow มีแล้ว แต่ branch protection และ formal staging/release gates ยังไม่ตั้ง (11F/owner)
4. Production Cron config มีแล้ว แต่ owner ยังไม่ deploy/เปิด `OPS_RECOVERY_ENABLED`
5. Optional alert webhook มีแล้ว แต่ external destination/on-call ยังไม่ตั้ง
6. Backup/restore/incident evidence absent
7. fal quality/reliability approval absent
8. TikTok production approvals absent

## Historical owner-action list — check current list below

1. Resolve fal billing/access and approve only a passing real benchmark
2. Enable Supabase leaked-password protection
3. Confirm backup/PITR and restore ownership
4. Obtain TikTok Login, Content Posting, Direct Post audit, Shop/Affiliate และ Analytics approvals
5. Provision production secrets in platform vault and define rotation
6. Select Vercel domain/region and Supabase capacity
7. Select monitoring/on-call/alert destinations
8. Approve one-account pilot budget, cap, reviewer and kill switch

## Historical next-five list — superseded

1. Phase 11F: staging E2E, security/dependency scan, restore/rollback rehearsal และ release gates
2. Owner: เชื่อม Vercel/Supabase, ตั้ง vault secrets/branch protection และเปิด Cron หลัง health sign-off
3. Staging load: วัด latency/locks จริงด้วย 10 accounts และ 150–200 candidates/day ก่อนขยาย pilot
4. Owner actions: provider benchmark approval, TikTok approvals, leaked-password protection และ pilot caps
5. ก่อน pilot: ตั้ง external alert routing, backup/restore drill และตรวจ operations dashboard ด้วยข้อมูลจริง

รายละเอียด task และ prompt พร้อมใช้ทั้งหมดอยู่ใน docs/FINAL_PRODUCTION_HANDOFF.md

## Historical readiness statement — production block still applies

- Local development: **READY**
- Mock/local technical pilot: **READY**
- 1-account real Growth pilot: **BLOCKED**
- Real publishing: **BLOCKED**
- 3-account pilot: **BLOCKED**
- 10-account scale: **BLOCKED**

ห้ามประกาศ production ready จนกว่า P0 ทั้งหมด, Phase 11A–11F และ owner approvals ที่เกี่ยวข้องจะเสร็จ

## Historical Phase 11F repository audit (2026-09-23; superseded)

**CODEX ROADMAP COMPLETION: 96% (96/100 engineering acceptance points). Production readiness: 69% (69/100 controls). Phase 11F: PARTIAL.** ตัวเลขนี้แทน 95%/68% ในส่วนเก่า: เพิ่ม 1 จุด engineering จาก Operator UI และ atomic selection/budget ที่ทดสอบจริง และ 1 จุด readiness จาก server-attested write boundary; ไม่ให้คะแนน one-click execution, sandbox E2E, staging/restore/rollback evidence ที่ยังไม่มี. ไม่ประกาศ `CODEX ROADMAP 100%` หรือ `PHASE 11 COMPLETE` ก่อนหลักฐานครบ.

หลักฐานปัจจุบัน: 21 local migrations และ 21 live migrations; migration ใหม่ 3 ชื่อ (`phase_11f_operator_budget`, `phase_11f_auto_digest_fix`, `phase_11f_resume_gate_restore`) ปรากฏครั้งเดียวในแต่ละฝั่ง. RLS ยังเปิดบนตารางเจ้าของ; authenticated ถูกตัดสิทธิ์เขียน 11 ตารางหลักที่เก็บหลักฐาน execution/บัญชี และ private storage write policy ถูกปิด. Auth Admin API ลบผู้ใช้ทดสอบแล้ว โดยตรวจ `auth.users`, `auto_runs`, `tiktok_accounts` เหลือ 0 สำหรับ owner ทดสอบ. Security Advisor มี INFO สองรายการของ OAuth service-only tables และ WARN เรื่อง leaked-password protection เดิม ไม่มี finding ใหม่จาก 11F.

หน้า `/auto` เป็น Operator Center สำหรับเลือกบัญชี/โหมด/เป้าหมาย/งบและ START/PAUSE/RESUME/STOP จาก state machine เดิม. Timeline แสดงเฉพาะหลักฐานจริง; ถ้า provider ไม่พร้อม จะขึ้น `WAITING_FOR_PROVIDER` ไม่แสดงว่าขั้นตอนต่อไปสำเร็จ. `/`, `/auto`, `/accounts`, `/operations`, `/publishing`, `/video-factory` ผ่าน browser smoke บนจอมือถือ 390 px โดยไม่มี horizontal overflow และหน้า Auto ไม่มี console error/warning หลังปรับ development CSP. Advanced navigation ยังเข้าถึงเครื่องมือเดิมได้.

**P0 engineering ที่ยังเปิด:** Auto planner ยังไม่ consume `auto_actions` เพื่อรัน opportunity → creative → video → quality → compliance → queue → mock publish → analytics → learning แบบอัตโนมัติ. Repository มี service แยกส่วนและ recovery แต่ไม่มี worker ที่เชื่อม chain นี้; จึงยังไม่มี final happy-path/failure sandbox E2E ตามเกณฑ์ 11F. ห้ามบอกผู้ใช้ว่า START จะเผยแพร่หรือเรียนรู้เองจนกว่าจะ implement และทดสอบครบ. P1: ตรวจ server-controlled writes ที่เหลือใน Creative/Radar/Analytics และพิสูจน์ responsive/accessibility เชิงลึกกับ staging data. ไม่สร้าง Phase 11G/12; งานนี้คงอยู่ใน Phase 11F.

Owner/external เท่านั้น: fal benchmark/visual approval และ billing, TikTok scopes/audit/consent/Shop/Analytics access, Supabase leaked-password protection, staging/production provisioning และ secrets, branch protection/monitoring/on-call, backup restore drill และ pilot sign-off. สิ่งเหล่านี้ไม่ใช่เหตุผลเพิ่มเฟสใหม่ แต่ยัง block production readiness.

## Historical Phase 11F execution processor continuation (2026-09-23; superseded)

**สถานะยังเป็น PARTIAL; Coding 96%, Production readiness 69%.** คงคะแนนเดิมอย่างระมัดระวัง เพราะส่วนประมวลผลใหม่ยังไม่ผ่าน migration และการทดสอบกับฐานข้อมูลจริง จึงยังไม่มีหลักฐานให้เพิ่มคะแนนหรือประกาศ 100%.

โค้ดใน working tree เพิ่มตัวประมวลผลแบบลำดับขั้น: หา assignment → Creative Brain → Video Factory → Quality → Compliance/Originality → Queue → Publish → Analytics → Learning โดยใช้ service เดิม, step key คงที่, checkpoint และสัญญาเช่าระดับบัญชี. ตัวกระตุ้นมี server action หลัง START/RESUME และ endpoint ภายในสำหรับ scheduler. ชุดทดสอบจำลอง 7 กรณีผ่าน รวมการแย่งงานของ worker, crash/restart, pause/stop, provider wait, unknown publish, compliance reject และ budget block; รวมทั้ง repository ผ่าน 299/299 tests, typecheck, lint (0 errors, 8 warnings เดิม และ 1 warning ใหม่ที่แก้แล้วภายหลัง), build และ release check รอบก่อนแก้ warning ล่าสุด.

**ยังไม่ใช่ one-click production path:** migration `phase_11f_auto_execution_processor` มีเพียง local file; live history ยังมี 21 migration. การลอง apply สองครั้งถูกยกเลิกแบบ transaction เพราะ PL/pgSQL syntax error และการลองครั้งถัดไปถูกระบบอนุมัติอัตโนมัติปฏิเสธจนกว่าจะมี dry-run ที่พิสูจน์ SQL ทั้งชุด; ไม่มี schema change จากความพยายามดังกล่าว. เส้นทาง fal จริงยังไม่เชื่อมกับ Auto budget/job pipeline: เมื่อบัญชีจริงถึงขั้น Generate จะรอ `WAITING_FOR_PROVIDER` ด้วยเหตุผล `FAL_AUTO_EXECUTION_NOT_CONNECTED`. การเผยแพร่จริงยังต้องได้รับ consent ชัดเจนตามสัญญา Phase 6C/7B; analytics จริงยังรอ provider scope และข้อมูลเข้า. Test จำลองจึงยังไม่เท่ากับ E2E ผ่าน START ของระบบกับฐานข้อมูลและ mock TikTok.

การตรวจ Supabase Security Advisor ล่าสุดยังมี WARN leaked-password protection disabled และ INFO สองรายการของ OAuth service-only tables ตามเดิม ไม่มี finding ใหม่ เพราะ migration นี้ไม่ได้ถูกใช้. ห้าม deploy โค้ดตัวประมวลผล, เปิด scheduler, เปิด paid provider หรือเผยแพร่จริง ก่อนแก้ SQL, dry-run, apply ครั้งเดียว, ตรวจ RLS/RPC, และรัน E2E กับฐานข้อมูลทดสอบ. งานนี้ยังอยู่ใน Phase 11F ไม่สร้างเฟสใหม่.

### Historical production-path acceptance recheck (2026-09-23; superseded)

**Phase 11F ยัง PARTIAL; ตัวเลข Coding 96% / Production readiness 69% ยังไม่เพิ่ม.** Working tree เชื่อมขั้น `GENERATE_VIDEO` ของ executor เดียวกันกับ `FalWanVideoProvider`, `AtomicBudgetLedger`, `generation_jobs`, private storage และ master persistence; ทดสอบ network boundary ว่า reserve/replay/unknown submission ไม่สร้าง paid attempt ซ้ำ. หลังส่ง request แล้วจึงบันทึก provider request ID ก่อน polling; ถ้าคำตอบจาก submit สูญหาย จะกัก reservation เป็นสถานะไม่แน่นอน ไม่ปล่อยงบหรือ retry เอง. Production path ยังคงปิดด้วย provider approval และ account/consent gate.

**Code ยังไม่ complete:** migration `phase_11f_auto_execution_processor` ยังไม่ผ่าน isolated PostgreSQL validation และยังไม่ applied; 22 local / 21 live migration. เครื่องนี้ไม่มี PostgreSQL, Docker/Podman หรือ package สำหรับ PostgreSQL local จึงยังไม่มี DB-backed START → completion E2E หรือ RLS/RPC verification สำหรับ migration ใหม่. `TikTokAnalyticsProvider` ยังเป็น stub `isAvailable() = false`: หลังเจ้าของได้ credentials/scopes ยังต้องเขียน Display API ingestion และ mapping เข้ากับ snapshot จริง. Production fal output ยังไม่มีตัวพิสูจน์ product identity/visible overlays จากไฟล์วิดีโอ; gate ถูกตั้ง fail closed แทนการอ้างว่าแผน storyboard คือหลักฐานภาพ. ดังนั้นแม้ใส่ทุก credential แล้ว ยังต้องเขียน integration/verification code เพิ่ม; ห้ามเรียกสถานะ CODE COMPLETE, ROADMAP 100% หรือปล่อย production Auto.

Verification ในเครื่องหลังการแก้ล่าสุด: `pnpm typecheck` ผ่าน, `pnpm lint` ผ่าน (0 errors/8 warnings), `pnpm test` ผ่าน 304/304 เมื่อ FFmpeg ได้สิทธิ์รัน, `pnpm build` และ `pnpm release:check` ผ่าน. ผลนี้เป็น unit/contract/build เท่านั้น ไม่แทนการตรวจฐานข้อมูลจริง. ไม่มี paid provider call, migration apply, deploy หรือ TikTok publish ในรอบนี้.

## Current Phase 11F closure — 2026-09-24

**CODEX ROADMAP / CODE COMPLETION: 100% ใน scope Phase 0–11F.** Production GO ยัง **BLOCKED**. ไม่ประเมินเปอร์เซ็นต์ production readiness หรือ overall ใหม่ในรอบปิดงานนี้; คะแนน 95/68 และ 96/69 ข้างบนเป็น historical snapshots ก่อนแก้ blocker. ไม่มี Phase 11G หรือ Phase 12 ใน roadmap ปัจจุบัน.

หลักฐานที่ปิด engineering blocker: local/live migration history 23/23 logical names; `phase_11f_auto_execution_processor` และ `phase_11f_auto_creative_worker` apply อย่างละหนึ่งครั้ง. Creative worker RPC ใช้ service role เท่านั้นและตรวจ owner/project; anon/authenticated ไม่มี execute. Supabase Security Advisor ล่าสุดมี WARN เรื่อง leaked-password protection และ INFO สองรายการของ OAuth service-only RLS/no-policy เดิม ไม่มี finding ใหม่. Temporary Auth users/accounts/products จาก DB E2E ถูกลบจนเหลือ 0.

START ใช้ production orchestrator และ domain services ต่อเนื่องจาก assignment, Creative Brain, fal provider abstraction, atomic budget reservation/settlement, `generation_jobs`, master/quality gate, FFmpeg เฟรมต้น/กลาง/ท้าย, compliance/originality, publishing queue/consent, TikTok provider, analytics snapshot, learning ไปถึง `COMPLETED`. การทดสอบ DB E2E ใช้ execution boundary เดียวกัน โดย mock เฉพาะ fal/TikTok network และ vision model; ไม่เรียก paid provider หรือโพสต์จริง. ทดสอบ PAUSE/RESUME, STOP, analytics replay และ idempotency ด้วย. Production adapter จะถูกเลือกตาม server environment, provider approval และ TikTok scopes/flags โดยไม่ต้องกลับมาเขียน orchestration/integration path เพิ่ม.

การตรวจคุณภาพล่าสุด: `pnpm typecheck` ผ่าน, `pnpm lint` ผ่านด้วย 0 errors/8 warnings เดิม, `pnpm test` ผ่าน 327 tests และข้าม opt-in DB E2E หนึ่งชุดตามปกติ; ชุด opt-in DB E2E ผ่านแยก; `pnpm build` และ `pnpm release:check` ผ่าน. ผลนี้พิสูจน์ code path และข้อมูลทดสอบ ไม่ใช่การรับรองคุณภาพ/การอนุญาตของ external provider จริง.

**OWNER / EXTERNAL — ก่อน production GO:** เจ้าของต้องจัด fal billing/key และดูคลิป benchmark เพื่ออนุมัติคุณภาพก่อนตั้ง `PRODUCTION_APPROVED`; ขอ TikTok credentials, scopes, Direct Post audit, Shop/Analytics access และบันทึก consent; เปิด Supabase leaked-password protection; ตั้ง Vercel/Supabase staging/production, vault secrets, domain, scheduler, branch protection, monitoring/on-call และ alert destination; ยืนยัน backup/PITR, restore/rollback drill, pilot cap/allowlist และ sign-off. สิ่งเหล่านี้เป็น release/owner gates และไม่ได้ถูกนับเป็นงานเขียน integration code เพิ่ม.

**ห้าขั้นถัดไป:** (1) เจ้าของอนุมัติ fal จาก benchmark จริง; (2) ขอ TikTok production scopes/audit และยืนยัน consent; (3) ตั้ง staging/production secrets, domain, CI protection และ scheduler; (4) ทดสอบ staging smoke, alert, backup/restore และ rollback พร้อม owner; (5) อนุมัติ pilot แบบหนึ่งบัญชีด้วย cap ต่ำและเฝ้าดู health/cost/reconciliation. ห้ามเปิด paid Auto หรือ real TikTok publishing ก่อน gates เหล่านี้ครบ.
