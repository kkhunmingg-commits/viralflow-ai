# AI LIVE — GPU validation gate

สถานะปัจจุบัน `WAITING_FOR_GPU_VALIDATION`; `PRODUCTION_READY=false`; **LIVE-1 ไม่ complete**

`AI_LIVE_EXECUTION_MODE=LOCAL_GPU`, `AI_LIVE_REALTIME_VALIDATED=false` (TypeScript) และ `REALTIME_VALIDATED=False` (local agent release entry point) ไม่ใช่ browser/environment flag ที่ลูกค้าเปิดเองได้ MockPresenter ใช้ test เท่านั้น ไม่มี silent fallback

## สิ่งที่ทำได้โดยไม่ใช้ NVIDIA

`READY_WITHOUT_GPU`: localhost API, authenticated pairing, persistent signed device registration/revoke/limit, signed server start authorization/key rotation, fresh entitlement, hardware fixtures/provisional tiers, component compatibility, owner session control, Windows installer พร้อม runtime, safe update distribution/rollback, customer page, bounded domain/mock simulation ทะเบียนเครื่อง apply แล้ว ผลตรวจรอบล่าสุดอยู่ใน [Server Activation](AI_LIVE_SERVER_ACTIVATION.md)

`WAITING_FOR_GPU` / `GPU_VALIDATION_REQUIRED`: incremental real model backend, audio capture/frame sync, actual local GPU encoder, inference/model dependencies, runtime GPU metrics และ end-to-end Presenter preview ส่วน non-GPU runtime ถูก bundle แล้ว

## Acceptance checklist บน NVIDIA จริง

| รายการ | Evidence ที่ต้องเก็บ | ปัจจุบัน |
| --- | --- | --- |
| MuseTalk loads | source/model/runtime versions และ successful real model initialization | NOT_RUN |
| Reference loads | owned reference preprocessing/real presenter initialization | NOT_RUN |
| Continuous audio | real microphone/chunk stream/cancel/backpressure | NOT_RUN |
| Continuous frames | incremental audio-to-frame outputs ไม่ใช่เล่นไฟล์ที่สร้างเสร็จแล้ว | NOT_RUN |
| Lip sync | human review กับเสียงจริงและ timing alignment | NOT_RUN |
| Measured FPS | timestamps/frame counts และ percentile over sustained session | NOT_RUN |
| Inference latency | chunk input→inference completion p50/p95/p99 | NOT_RUN |
| End-to-end latency | microphone→display/encoder measurement | NOT_RUN |
| VRAM usage | warmup/steady/peak/memory release และ repeated start/stop | NOT_RUN |
| Encoder | real FFmpeg/NVENC encode/decode integrity และ audio sync | NOT_RUN |
| Long-session stability | sustained real session, queue bounds, watchdog, crash/recovery, resource leak | NOT_RUN |

ผลทดสอบต้องบันทึก hardware/driver/runtime/model versions/config และ baseline ที่ใช้ ตรวจ supported configuration ทีละรายการ ไม่อ้างว่า GPU รุ่นใดรับประกันจาก VRAM อย่างเดียว เกณฑ์ minimum/recommended สุดท้ายต้องมาจาก measured performance/quality และ user experience

## Gate ก่อนเปิดให้ลูกค้า

1. ทุก checklist ผ่านและมีหลักฐาน; บันทึก limitations ของ hardware configuration
2. ต่อ `MuseTalkLocalPresenter`/`WorkerBoundary` และ `LocalEncoder` จริงโดยไม่มี mock หรือ prerecorded frame fallback
3. Windows installer/dependency/bootstrap/device enrollment ผ่าน tests แล้ว; ยังต้องเซ็นและเผยแพร่ release พร้อม trust configuration และ activate registry migration ก่อนส่งให้ลูกค้าจริง
4. HTTPS browser → loopback permission, entitlement owner/device, Stop/recovery และ customer redaction ผ่านบน browser ที่รองรับ
5. Release gate จึงเปลี่ยนผ่าน reviewed code/release evidence พร้อม version bump ไม่ใช่ผ่าน browser parameter/Production env

การผ่าน GPU checklist เป็น **Presenter readiness** ไม่ใช่ TikTok LIVE approval ยังห้ามเรียก LIVE transport/RTMP/product pinning จนได้รับสิทธิ์และคำสั่งแยกต่างหาก

30-minute mock/virtual-clock tests และ signed-grant integration tests ไม่แทน NVIDIA benchmark ห้ามแสดง FPS/latency/VRAM ที่ยังไม่เคยวัดบน customer UI

## ผลตรวจรอบ Local GPU foundation (ก่อน delivery 0.2.0)

- Python worker/agent suite: **40/40 ผ่าน** ใน isolated runtime ที่ติดตั้ง signature verifier ตาม requirements รวม real Node Ed25519 → Python verification และ tampering rejection
- TypeScript AI LIVE/route suite: **45/45 ผ่าน**
- `pnpm typecheck`: ผ่าน
- `pnpm lint`: exit 0, ไม่มี error; มี 8 warning เดิมใน video benchmark/test ที่ไม่ได้แก้ใน scope นี้
- `pnpm test`: 443 ผ่าน / 1 failed / 1 skipped; failure เดิมคือ `src/features/operations/scheduler.test.ts` ที่ยังคาดว่า `vercel.json` มี recovery Cron ทั้งที่ owner ถอด Cron เพื่อ Vercel Hobby แล้ว ไม่มีการเปลี่ยน scheduler/config ในงานนี้
- `pnpm build`: ผ่านด้วย public Supabase placeholders **เฉพาะ build process** เพราะเครื่องนี้ไม่มี public config; ไม่ใช่ live Supabase/Production acceptance และไม่ได้เขียน .env.local หรือเปลี่ยน Production env
- Real hardware probe: Windows, ไม่พบ NVIDIA, managed FFmpeg/encoder ยังไม่ได้ packaged → `UNSUPPORTED / GPU_VALIDATION_REQUIRED` ไม่ได้ทดสอบ CUDA/NVENC จริง

ผลนี้ยืนยัน non-GPU foundation เท่านั้น ไม่ให้สถานะ `PRODUCTION_READY` หรือ `LIVE-1 COMPLETE`

ผลรอบ Local Agent Delivery 0.2.0 (2026-10-01): TS 62/62, Python 72/72,
isolated DB 26/26, typecheck/lint/build ผ่าน รายละเอียดอยู่ใน
[Local Agent delivery evidence](AI_LIVE_LOCAL_AGENT.md#ผลตรวจ-delivery-020--2026-10-01)
ไม่มี GPU checklist รายการใดถูกเปลี่ยนเป็นผ่านจากการทดสอบ delivery นี้
