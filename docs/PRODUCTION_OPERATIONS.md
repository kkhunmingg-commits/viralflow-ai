# Phase 11E — production operations contract

เอกสารนี้เตรียมโครงสร้างสำหรับ Vercel + Supabase โดยยังไม่อนุมัติ production launch, paid provider หรือ TikTok publishing. `APP_ENV` แยก development/staging/production โดยใช้ codebase เดียวกัน. Preview บน Vercel ถูกมองเป็น staging, production deployment เป็น production; environment ที่ระบุขัดกับ Vercel จะหยุดทันที.

## Environment ownership

| Group | Variables | Level | Owner / boundary |
|---|---|---|---|
| Application | `APP_ENV`, `APP_URL` | REQUIRED_FOR_BOOT นอก development | เจ้าของกำหนด HTTPS origin แยก staging/production |
| Supabase public | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | REQUIRED_FOR_BOOT | เป็นสองค่าที่เปิดเผยต่อ client ได้; ใช้คนละ Supabase project ต่อ environment |
| Supabase admin | `SUPABASE_SECRET_KEY` | REQUIRED_FOR_FEATURE | server-only, ต้องใช้เมื่อเปิด OAuth/rate-limit/recovery; เก็บใน platform vault |
| TikTok OAuth/publishing | `TIKTOK_PROVIDER`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_TOKEN_ENCRYPTION_KEY`, `TIKTOK_PUBLISHING_PROVIDER`, `TIKTOK_PUBLISHING_REAL_MODE`, approval flags | REQUIRED_FOR_FEATURE | mock เป็นค่าเริ่มต้น; real publishing ต้องเป็น production + official + approvals; callback ต้องตรง `APP_URL` |
| TikTok Shop | `TIKTOK_SHOP_PROVIDER`, `TIKTOK_SHOP_REAL_MODE`, app key/secret | REQUIRED_FOR_FEATURE | mock เป็นค่าเริ่มต้น; real mode ใช้เฉพาะ production |
| Video/Creative | `FAL_KEY`, `FAL_WAN_PROVIDER_STATE`, `GOOGLE_GENAI_API_KEY`, `OPENAI_API_KEY`, model settings | REQUIRED_FOR_FEATURE | server-only; fal Auto ใช้ได้ต่อเมื่อมี key และ `PRODUCTION_APPROVED`; Google ไม่เป็น paid fallback อัตโนมัติ |
| FFmpeg | `FFMPEG_BINARY`, `FFPROBE_BINARY` | OPTIONAL | ใช้ bundled binary เป็นค่าเริ่มต้น; CI ระบุ system FFmpeg ที่มี `drawtext` เพื่อทดสอบ render จริง |
| Benchmark | `VIDEO_BENCHMARK_ALLOW_PAID`, `VIDEO_BENCHMARK_MAX_USD` | OPTIONAL | CLI เท่านั้น; staging/production ห้ามตั้ง paid=true |
| Recovery Cron | `OPS_RECOVERY_ENABLED`, `CRON_SECRET`, `OPS_RECOVERY_TOKEN` | REQUIRED_FOR_FEATURE | ปิดเป็นค่าเริ่มต้น; `CRON_SECRET` ใช้กับ Vercel GET, token แยกสำหรับ POST; ทั้งสอง server-only |
| Alerts | `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_WEBHOOK_HOST`, `OPS_ALERT_WEBHOOK_TOKEN` | OPTIONAL | HTTPS exact host, no redirect, timeout 5s; delivery เป็น best effort; internal alerts อยู่ใน Supabase เสมอ |

ห้ามตั้ง `SUPABASE_SECRET_KEY`, `CRON_SECRET`, TikTok/provider keys หรือ webhook token เป็น `NEXT_PUBLIC_`. เจ้าของกำหนดผู้ถือกุญแจ วันหมุนเวียน และขั้นตอนเพิกถอนใน vault ก่อน deploy. `.env.local` ไม่ถูก commit.

## GitHub → Vercel → Supabase

1. **Codex ทำแล้ว:** GitHub Actions ใช้ Node 24, pnpm 11.19.0, frozen lockfile, package cache และ `pnpm release:check`; PR CI ใช้ placeholder public Supabase values เท่านั้น ไม่มี production secrets. Script ตรวจ env contract, ชื่อ/ลำดับ migration local และรัน typecheck/lint/test/build; ไม่ deploy และไม่ apply migration.
2. **OWNER_ACTION_REQUIRED:** เชื่อม repository กับ Vercel project, ตั้ง production branch/domain/region/plan และ environment values แยก Preview/Production. ตั้ง Supabase project สำหรับ staging และ production คนละชุด; ยืนยัน `NEXT_PUBLIC_SUPABASE_URL`/publishable key ตรงกับ admin key ของ project เดียวกัน. อย่าใช้ production key ใน Preview.
3. **OWNER_ACTION_REQUIRED:** ตรวจ `supabase/migrations` กับ live migration history ก่อน deploy; local มี 18 migration และ live `viralflow-ai` มี 18 รายการถึง `phase_11d_performance_indexes` ณ 2026-09-23. Migration filename version กับ live connector version อาจต่างกัน แต่ logical name ต้องมีครั้งเดียว. ถ้ามี migration ใหม่ในอนาคต ให้ทดสอบ rollback/staging ก่อน apply production และห้าม apply ซ้ำ.
4. **OWNER_ACTION_REQUIRED:** ให้ GitHub branch protection บังคับ workflow `Quality gates` ก่อน merge; Vercel deployment protection และ secret vault เป็นการตั้งค่าภายนอก. การมีไฟล์ CI ไม่ได้เปิด branch protection เอง.
5. **OWNER_ACTION_REQUIRED:** ตั้ง `APP_ENV=production`, `APP_URL` เป็น HTTPS origin จริง, Supabase public/admin keys และ `CRON_SECRET` อย่างน้อย 32 ตัวอักษร. เปิด `OPS_RECOVERY_ENABLED=true` หลังตรวจ health, backup และ on-call; ก่อนหน้านั้น Cron ตอบ 503 โดยไม่เข้าถึงฐานข้อมูล.

## Recovery schedule and health

`vercel.json` ขอ GET `/api/operations/recovery` ทุก 5 นาทีตามเวลา UTC. [Vercel Cron](https://vercel.com/docs/cron-jobs) ส่ง `Authorization: Bearer CRON_SECRET`; route เปรียบเทียบแบบ constant time, ปฏิเสธคำขอที่ไม่มี secret และเรียก Phase 11C recovery เดิม. POST แบบ token `OPS_RECOVERY_TOKEN` ยังคงไว้สำหรับการกระตุ้นโดย operator/runner ภายในเท่านั้น. Database window claim ทำให้ request ซ้ำในช่วงเดียวได้งานเพียงหนึ่งครั้ง; recovery ใช้ keyset scan bounded และไม่ blind retry external side effects. โปรดตรวจ [ข้อจำกัดแผน Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing): ตารางทุก 5 นาทีต้องใช้แผนที่รองรับความถี่นี้.

`/api/operations/health` ยังต้องใช้ owner login. ตรวจ `scheduler.last_success_at`, `last_failure_at`, `age_minutes`, `healthy`, `recovery_count`, `alert_count`, `reconciliation`, `dead_letter`, pending leases/budget และ stale jobs. `healthy=false` เมื่อ last success เก่ากว่า 15 นาทีหรือมี failure ใหม่กว่า success. Alert webhook ส่งเฉพาะ summary ที่ไม่มี secret หรือข้อมูลผู้ใช้ เมื่อมี alert ใน cycle นั้น; ถ้าส่งล้มเหลว recovery ที่ commit แล้วไม่ rollback และ log เฉพาะ error code. Internal alert rows ยังคงเป็น source of truth. การส่ง webhook เป็น best effort ไม่รับประกัน exactly-once; receiver ควร dedupe ด้วย `windowKey`.

## Backup and restore readiness

- **OWNER_ACTION_REQUIRED:** ยืนยันแผน backup/PITR ของ Supabase, retention, เวลา restore ที่ยอมรับได้, ผู้มีสิทธิ์และผู้อนุมัติ. ตรวจว่า database, Auth, private `video-assets` storage และ encryption key ถูกครอบคลุมอย่างไร; database backup อย่างเดียวไม่ยืนยันว่า storage objects กู้คืนได้.
- **OWNER_ACTION_REQUIRED:** สำรอง/ทดสอบกู้คืนลง project แยก ไม่ overwrite production. บันทึก backup timestamp, migration head, row counts, RLS 65/65, private bucket/policies, sample video object integrity, Auth login และ token-decryption test โดยไม่พิมพ์ secret. เชื่อม callback URLs ของ staging เท่านั้น.
- **Codex ตรวจได้:** local migration ordering/duplicate logical names ผ่าน `pnpm release:check`; ตรวจ live migration list/read-only advisor ได้. Phase 11E ไม่สร้าง backup หรือ restore production จริง.
- **ระหว่าง incident:** ปิด `OPS_RECOVERY_ENABLED`, real publishing/Shop และ paid provider flags ก่อน; เก็บ window key, operation IDs, last health, incident rows และ logs ที่ redact แล้ว. อย่าลบ unknown provider submission หรือ release budget hold โดยไม่มี reconciliation evidence. ให้ owner เลือก PITR point, ทดสอบ restore แยก แล้วค่อยสลับ traffic หลังอนุมัติ.

## Release and rollback checklist

1. `pnpm release:check` ผ่านและ branch protection แสดง CI ผ่าน; ตรวจ `git status`, commit, local/live migration logical names, Security Advisor และ dependency advisories.
2. ยืนยัน staging smoke/E2E, Auth, RLS, webhook/OAuth callbacks, recovery GET unauthorized/authorized, health, alert destination และ restore drill. Phase 11F ยังต้องจัด formal release gates/rollback rehearsal; ห้ามอ้างว่าเสร็จใน 11E.
3. ตรวจ domain, Supabase project separation, `APP_ENV`, public/admin key pairing, secret rotation owner, Cron plan, alert/on-call owner. เปิด real provider/TikTok เฉพาะหลัง owner approval และ audit ตามแผน pilot.
4. หลัง deploy โดยเจ้าของ: ตรวจ `/api/operations/health` ด้วย owner session, last successful scheduler window, reconciliation backlog และ Vercel runtime logs. ถ้าไม่ healthy ให้ปิด scheduler และ triage ก่อนเปิด external modes.
5. Rollback application ด้วย Vercel previous deployment หลัง owner อนุมัติ; database migration ต้องใช้ forward fix/restore plan แยก ไม่สั่งย้อนแบบทำลายข้อมูลอัตโนมัติ. ยืนยัน schema compatibility กับ previous app ก่อนสลับ traffic.

## Remaining after 11E

Phase 11F: browser smoke E2E, staging release rehearsal, dependency/security scan, CI branch protection evidence, restore drill evidence, incident runbook exercise และ rollback gate. External owner actions: Vercel/Supabase provisioning, leaked-password protection, fal benchmark/quality approval, TikTok approvals, production secrets/domain/monitoring และ pilot sign-off. งานเหล่านี้ยังไม่ใช่เหตุให้เปิด production publishing ใน Phase 11E.
