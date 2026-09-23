# ViralFlow AI — Project Master Status

อัปเดตจาก repository และ live Supabase audit วันที่ 2026-09-23

Baseline branch: **feature/fal-wan-primary-provider**

Phase 11C starting HEAD: **f0f54d421c76e4c6782301a48ee49efff97b81cb**

## Executive status

| Metric | Result | Calculation |
|---|---:|---|
| Coding completion | **94%** | 94/100 engineering acceptance points |
| Production readiness | **63%** | 63/100 release-readiness controls |
| Overall completion | **82%** | `(94 × 60%) + (63 × 40%) = 81.6` ปัดเป็นจำนวนเต็ม |

เปอร์เซ็นต์นี้คำนวณใหม่จาก repository, migration history, live RLS/advisors, provider gates, tests และ production operations ไม่ได้ยกค่าจากบทสนทนาเดิม

### Coding completion rubric

| Area | Weight | Earned | Evidence |
|---|---:|---:|---|
| Foundation, auth, protected UI | 8 | 8 | Next.js/Supabase flow และ owner-authenticated routes |
| Product, category, assignment brains | 12 | 12 | deterministic scoring, persistence และ UI |
| Creative Brain | 8 | 8 | generate/select/edit/reject/regenerate และ risk/cost metadata |
| Video Factory | 10 | 9 | FFmpeg/master/variation/quality/storage complete; real provider approval pending |
| Compliance and originality | 10 | 10 | gates และ Phase 11A external-boundary hardening complete |
| TikTok OAuth and publishing foundation | 12 | 11 | transaction queue, lease และ fail-closed reconciliation complete; real approval pending |
| Shop and Affiliate foundation | 8 | 7 | fail-closed readiness complete; real approval/attachment pending |
| Analytics and Growth learning | 12 | 11 | scoring/learning complete; real data adapters pending |
| Auto orchestration | 12 | 11 | atomic START/transition และ budget ledger complete; production worker pending |
| Tests and engineering docs | 8 | 7 | deterministic reliability suite/docs; CI/E2E/load/release gates pending |
| **Total** | **100** | **94** | |

### Production readiness rubric

| Control | Weight | Earned | Evidence |
|---|---:|---:|---|
| Authentication, RLS, owner isolation | 15 | 13 | 65/65 tables RLS; leaked-password protection pending |
| Secret/config boundaries | 10 | 9 | server-only validation, redacted errors, security headers และไม่มี client import violation; production vault/rotation pending |
| External-call safety | 15 | 13 | lease, stable key, unknown-state reconciliation และ no blind retry complete; real provider evidence pending |
| Money/budget safety | 10 | 10 | atomic reserve/settle/release และ six-dimensional caps complete |
| Data integrity/recovery | 10 | 9 | atomic Auto/publish writes และ stale recovery complete; production scheduler/operator tooling pending |
| Observability/incident response | 10 | 6 | structured operational logs, recovery health, internal alerts, operator queue; external routing/production schedule/runbook drill ยังขาด |
| CI/release/deployment | 10 | 2 | local quality commands exist; no CI/staging/rollback gate |
| Backup/restore/operations | 10 | 1 | managed database exists; no restore drill/ownership evidence |
| Real provider/TikTok approvals | 10 | 0 | fal benchmark failed; TikTok scopes/audit/Shop/Analytics pending |
| **Total** | **100** | **63** | |

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
| 6B | Provider benchmark | PARTIAL | harness complete; fal real run failed Forbidden; no approval |
| 6C | Compliance/originality | DONE | production endpoint hardening pending |
| 7A | TikTok OAuth | PARTIAL | foundation complete; real app setup/approval missing |
| 7B | Publishing queue | DONE | transaction queue/lease/reconciliation complete; real TikTok approval remains external |
| 7C | TikTok Shop | PARTIAL | foundation complete; real authorization/attachment missing |
| 8 | Analytics/learning | PARTIAL | engine complete; real TikTok data access missing |
| 9 | Growth Engine | DONE | real evidence stream pending external access |
| 10 | Full Auto Mode | PARTIAL | atomic planner and budget ledger complete; production worker remains |
| 11A | Security Hardening | DONE | P1-02/P1-03/P1-04 closed; leaked-password protection remains owner action |
| 11B | Reliability / Idempotency | DONE | P0-02/P0-03 and P1-05/P1-06/P1-07 closed |
| 11C | Recovery / Observability | DONE | recovery service, operator UI, internal health/alerts; external schedule ยังรอ 11E |
| 11D–11F | Performance through release readiness | PLANNED | ordered plan in FINAL_PRODUCTION_HANDOFF.md |

## Verified repository and database state

- 17 local migrations and 17 live migrations; `phase_11c_recovery_observability` appears once in each history
- 65 public tables; RLS enabled on all 65
- Phase 11C tables have owner-read/service-write boundaries; scheduler and webhook counters are service-only
- video-assets bucket private with owner-path RLS
- OAuth credentials/states service-only and FORCE RLS
- Security Advisor after Phase 11C: no new issue; leaked-password warning plus two intentional service-only no-policy info findings
- Performance Advisor: 34 unindexed FK findings and 27 unused-index findings requiring workload evidence
- No active live Auto, publishing, generation, OAuth credential or analytics rows at audit
- No matching real secret pattern in tracked files/history scan
- Phase 11B verification: migration rollback validation/live apply ผ่าน, 18 reliability RPC, RLS และ critical indexes ตรวจจาก catalog แล้ว; typecheck/build ผ่าน, lint 0 errors กับ 8 warning เดิม และ tests 262/262 ผ่าน
- Phase 11C verification: local migration เรียงหลัง 11B, live migration ชื่อเดียวกันหนึ่งรายการ, scheduler claim และ cross-owner RPC test ผ่านในธุรกรรม rollback; typecheck/build ผ่าน, lint 0 errors กับ 8 warning เดิม และ tests 269/269 ผ่าน

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

## DONE / PARTIAL / PLANNED

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
- Production operations: Phase 11C recovery/health/operator queue complete; external scheduler, on-call routing และ restore drill ยังขาด

### PLANNED

- Phase 11D Performance/Database
- Phase 11E Production Environment
- Phase 11F Release Readiness
- Phase 11G one-account Growth pilot after external approvals

## P0/P1 blockers

### P0 open

ไม่มี P0 ด้าน code architecture หลัง Phase 11C; production ยังถูก block ด้วย Phase 11D–11F และ external/owner approvals

### P1 open

1. Leaked-password protection disabled
2. Server-attested execution data needs tighter write boundaries
3. CI/type enforcement absent
4. Production worker/external schedule ยังไม่ตั้ง; 11C มี recovery endpoint, dead-letter และ operator UI แล้ว
5. External monitoring/on-call routing ยังไม่ตั้ง; 11C มี internal alerts/health แล้ว
6. Backup/restore/incident evidence absent
7. fal quality/reliability approval absent
8. TikTok production approvals absent

## Owner actions

1. Resolve fal billing/access and approve only a passing real benchmark
2. Enable Supabase leaked-password protection
3. Confirm backup/PITR and restore ownership
4. Obtain TikTok Login, Content Posting, Direct Post audit, Shop/Affiliate และ Analytics approvals
5. Provision production secrets in platform vault and define rotation
6. Select Vercel domain/region and Supabase capacity
7. Select monitoring/on-call/alert destinations
8. Approve one-account pilot budget, cap, reviewer and kill switch

## Next five actions

1. Phase 11D: query-plan/index/load/retention validation
2. Phase 11E: production environment boundaries, recovery schedule and secret ownership
3. Phase 11F: CI, staging, backup/rollback and release gates
4. Owner actions: provider benchmark approval, TikTok approvals, leaked-password protection และ pilot caps
5. ก่อน pilot: ตั้ง external alert routing, backup/restore drill และตรวจ operations dashboard ด้วยข้อมูลจริง

รายละเอียด task และ prompt พร้อมใช้ทั้งหมดอยู่ใน docs/FINAL_PRODUCTION_HANDOFF.md

## Final readiness statement

- Local development: **READY**
- Mock/local technical pilot: **READY**
- 1-account real Growth pilot: **BLOCKED**
- Real publishing: **BLOCKED**
- 3-account pilot: **BLOCKED**
- 10-account scale: **BLOCKED**

ห้ามประกาศ production ready จนกว่า P0 ทั้งหมด, Phase 11A–11F และ owner approvals ที่เกี่ยวข้องจะเสร็จ
