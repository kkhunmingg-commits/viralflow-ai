# AI LIVE Local Agent — foundation

สถานะ `READY_WITHOUT_GPU` สำหรับ delivery/control/security: สร้าง Windows GUI installer พร้อม runtime แล้ว มีทะเบียนเครื่องบน Supabase จริง และ signed update distribution/rollback foundation `WAITING_FOR_GPU` / `GPU_VALIDATION_REQUIRED` สำหรับ Presenter/audio/encoder; `PRODUCTION_READY=false` ยังไม่ตั้ง signer/membership/release hosting บน Production ไม่มี live broadcast จริง

## โครงสร้าง

```text
src/features/ai-live/local-contract.ts       # release gate + customer-safe projection
src/features/ai-live/local-client.ts         # browser → fixed loopback agent
src/features/ai-live/local-license*.ts       # server entitlement / Ed25519 start grant
src/features/ai-live/device-*.ts            # signed proof / durable owner device registry
src/app/api/ai-live/local-grant/route.ts     # authenticated cloud control only
src/app/api/ai-live/devices/**              # challenge/register/status/list/revoke
supabase/migrations/20261001091106_ai_live_device_registration.sql # applied once; server-only
workers/ai-live/local_agent/
  agent.py                                 # session / worker / encoder boundary
  security.py                              # pairing / challenge / signature verification
  http_server.py                           # strict loopback HTTP surface
  hardware.py                              # Windows probe / provisional tiers
  bootstrap.py                             # signed artifact install/update/repair planner
  device_identity.py                       # DPAPI-protected per-install Ed25519 identity
  updater.py                               # signed update / trusted download / confirm / rollback
  launcher.pyw                             # no-terminal GUI launcher foundation
  requirements.txt                         # pinned signature verifier dependency
workers/ai-live/installer/                  # self-contained windowed setup/build/delivery
```

## Handshake และ protocol

Agent bind เฉพาะ `127.0.0.1:8766`; ตรวจ Host ตรงตัวและ Origin จาก trusted allowlist ไม่มี LAN bind, wildcard CORS, URL proxy หรือ shell endpoint Development origins เป็น trusted installer config ไม่ใช่ customer parameter

| Endpoint | สิทธิ์ / ผล |
| --- | --- |
| `GET /v1/discovery` | exact Host/Origin; เวอร์ชันและพบ agent หรือไม่ ไม่มี hardware details |
| `POST /v1/pair` | one-time GUI code; ส่ง token อายุ 900 วินาที + device UUID; code หายจาก agent memory เมื่อใช้แล้ว |
| `POST /v1/renew` | token/origin เดิมที่ยังไม่หมดอายุ; หมุน token และรักษา owner binding |
| `GET /v1/status` | token/origin; customer-safe state และ owned session status |
| `GET /v1/hardware` | token/origin; เหตุผลภาษาไทย ไม่คืน GPU model/driver/path |
| `POST /v1/device/proof` | token/origin; ตรวจ server-signed registration challenge แล้วลงลายเซ็นด้วย device private key |
| `POST /v1/device/certificate` | token/origin; รับ certificate ที่ server ลงลายเซ็น ตรวจ owner/device/key/version/expiry เก็บด้วย DPAPI |
| `POST /v1/device/revoke` | token/origin; ตรวจ signed receipt, บันทึก revocation และหยุด session ที่เป็นเจ้าของ |
| `POST /v1/updates/check` | token/origin; ตรวจ signed manifest จาก authenticated web bridge ไม่รับ URL หรือ trust key จากลูกค้า |
| `POST /v1/updates/apply,repair` | token/origin; ยืนยันก่อนติดตั้ง ห้ามมี session ค้าง ใช้ package ที่ตรวจลายเซ็น/hash แล้วเท่านั้น |
| `GET /v1/challenge` | token/origin + certificate; one-use challenge ≤120 วินาที และ device-signed proof |
| `POST /v1/references` | token/origin; JPEG/PNG ≤4MB; local UUID path ไม่รับ customer filesystem path |
| `POST /v1/sessions/start` | signed grant + matched selection/reference; version/hardware/release gate |
| `POST /v1/sessions/{id}/pause,resume,stop,recover` | local token + verified session owner; bounded recovery; Stop idempotent |

Browser requests มี timeout, no redirects/cookies/cache และเก็บ credential ใน memory ไม่ใช้ localStorage/sessionStorage/cookies ไม่ส่ง secret หรือ raw media ไป cloud ขอ machine status ทุก 4 วินาทีแบบ serial และต่ออายุ token ก่อนหมดอายุ 60 วินาที หาก browser ปิด/พักจน token หมดอายุ ต้องจับคู่ใหม่ตาม lifecycle ที่ installer จัดการ; foundation GUI code ใช้ครั้งเดียวต่อ launch

State: `NOT_INSTALLED`, `INSTALLING`, `STARTING`, `READY`, `BUSY`, `PAUSED`, `STOPPING`, `OFFLINE`, `ERROR`, `UPDATE_REQUIRED`, `GPU_REQUIRED` บาง state เป็น installer/browser states ไม่มีการสร้าง progress เปอร์เซ็นต์ปลอม

## Server license และ device ownership

`POST /api/ai-live/local-grant` ใช้ same-origin POST, bounded JSON, authenticated `getUser()` และ owner rate limiter เดิม ต้องมี device-signed proof และทะเบียนเครื่อง active ในฐานข้อมูล Certificate ในเครื่องอย่างเดียวไม่ใช่สิทธิ์สมาชิก

Trusted `app_metadata.ai_live` provisioning interface:

```json
{
  "enabled": true,
  "status": "active",
  "revokedAt": null,
  "expiresAt": "2027-01-01T00:00:00Z",
  "deviceLimit": 1
}
```

ตัวอย่างนี้เป็น schema documentation ไม่ใช่ membership ที่สร้างให้ผู้ใช้ ไม่มีสิทธิ์ใน metadata/device ไม่ registered/เกิน limit/หมดอายุ → deny ไม่ใช้ editable `user_metadata` หรือ legacy `registeredDeviceIds` เป็น authority สมาชิกและ deviceLimit มาจาก fresh server metadata; device registration บันทึกจริงผ่าน supported service-role client/RPC ไม่เก็บ local-only membership

Registration: cloud signed challenge → local Ed25519 proof → server membership/owner check → atomic nonce consumption/device limit → signed certificate → DPAPI storage → browser rechecks cloud authorization. `GET /api/ai-live/devices` และ `GET/DELETE /api/ai-live/devices/[id]` scoped ด้วย authenticated owner ไม่รับ ownerId ที่ browser อ้าง; revoke ใช้ได้แม้สมาชิกหมดอายุแล้ว

Migration เพิ่ม `ai_live_devices`, `ai_live_device_challenges`, `ai_live_device_lease_nonces` เปิด RLS ทุกตาราง ไม่มี table/function grants ให้ anon/authenticated; server-only SECURITY INVOKER RPCs ใช้ owner/device transaction advisory locks กัน takeover และ limit overbooking **apply สำเร็จครั้งเดียว** บน project `viralflow-ai` เมื่อ 2026-10-02 ประวัติ remote ใช้ version `20261001172630` / name `ai_live_device_registration` ส่วนไฟล์ local เดิมคงอยู่ ไม่สร้าง migration ซ้ำ และไม่แก้ผู้ใช้เดิม

Grant ใช้ Ed25519 ลงลายเซ็นด้วย server-only `AI_LIVE_LEASE_SIGNING_PRIVATE_KEY` ที่ **ยังไม่ได้ตั้งค่าหรือสร้างในงานนี้** Installer pin public key ที่ตรงกัน private key ไม่ไป browser/agent ไม่มีการแตะ .env.local หรือ Production env

Canonical JSON: recursively sorted keys, compact JSON, UTF-8; Unix seconds ทั้ง issuedAt/expiresAt TTL ≤120 กำหนด `ownerId`, `deviceId`, `challenge`, `accountId`, `productIds`, `grantId`, versions และ `entitled:true` ตรวจ real ownership/account authorized/nonmock/visible/product available ก่อนลงลายเซ็น Agent ตรวจ signature/device/challenge/replay/scope/version

Grant ให้สิทธิ์สร้าง session; ไม่อ้างว่า membership revocation หยุด stream ระหว่าง session อัตโนมัติ Pause/Resume/Stop ตรวจ owner ของ session เดิม Recovery ต้อง grant สดและมีเพียงหนึ่ง attempt; session ใหม่ต้อง signed grant ใหม่เสมอ

## Hardware tiers

Probe: Windows/OS version/CPU/RAM/NVIDIA GPU/VRAM/driver/compute capability, fixed trusted NVIDIA tool, bundled FFmpeg encoder listing, free disk, Windows audio devices ห้ามเรียก command จากข้อมูล browser

`HardwareTiers` config แบบ constructor ใน trusted agent/installer:

| Tier | เกณฑ์ VRAM ชั่วคราวสำหรับ fixtures |
| --- | --- |
| `UNSUPPORTED` | prerequisite ใดไม่ผ่าน/ยังตรวจไม่ได้ |
| `MINIMUM` | ≥6GB |
| `RECOMMENDED` | ≥12GB |
| `HIGH_PERFORMANCE` | ≥16GB |

RAM 16GB / disk 20GB / compute capability 6.0 เป็น provisional config ทั้งหมด **ไม่ใช่สเปกรับประกันหรือ minimum specification ที่ประกาศกับลูกค้า** `validation_required=true` เสมอจนมี evidence รายการ `h264_nvenc` ใน FFmpeg ไม่ใช่ encoder runtime test และ compute capability ไม่ใช่ proof ว่า model โหลดด้วย CUDA ได้

## Installer/bootstrap/update

`workers/ai-live/installer/.dist/ViralFlow-AI-Setup-0.4.0.exe` เป็นตัวติดตั้ง ViralFlow AI แบบ windowed ต่อ Windows user รวม Python/Tk/cryptography, audio และ FFmpeg พร้อม notices First run สร้าง DPAPI identity และ pairing code จากนั้นเตรียม private presenter runtime/models ผ่าน trusted signed release channel ไม่ใช้ system Python/pip/manual CUDA ลูกค้าดับเบิลคลิก Install/Update, Repair หรือ Uninstall ได้ รายละเอียดและสิ่งที่ยังไม่เปิดใช้จริงอยู่ใน [One App Installation](AI_LIVE_INSTALLATION.md)

ตัวติดตั้งตรวจรุ่นเดิมและ package/file hashes, extract เฉพาะ managed release directory, self-test executable, ตั้ง shortcut/Windows installed-app entry แล้ว activate pointer แบบ atomic เมื่อ upgrade ล้มยังเก็บรุ่นเดิมและ restore integration; repair ลง release ใหม่แทนการ overwrite runtime เดิม Uninstall ลบเฉพาะ managed files/registry/shortcut ไม่แตะบัญชี TikTok/analytics/subscription บน cloud unknown files ไม่ถูกลบ

ไฟล์นี้ยัง **unsigned / engineering distribution** ต้องจัดการ Authenticode/release hosting และ pinned public key ก่อนเผยแพร่ลูกค้าจริง UI ไม่สร้าง download link ไปยังไฟล์ที่ไม่มีบน public hosting รายละเอียด build และ lifecycle อยู่ใน [installer README](../workers/ai-live/installer/README.md)

`local_agent/components.py::BootstrapManager` เป็น managed delivery path ที่ launcher ใช้จริง: signed `runtime` + `models` archives ของ `cpu-dev` หรือ `nvidia` profile จาก fixed trusted origin ดาวน์โหลดต่อด้วย verified chunks/ETag/Range, ตรวจ archive และ expanded file hashes ก่อน atomic activation ทั้งคู่ Browser ส่ง fresh server grant ผ่าน `/v1/components/prepare` ไม่ส่ง URL/command/config มี `/v1/components/status` ที่คืนเฉพาะสถานะ/ไบต์/สิทธิ์เตรียม Legacy `bootstrap.py` เป็น low-level fixture เดิม ไม่ใช่ launcher production delivery path

`SafeUpdater` ตรวจ pinned Ed25519 signature/keyId, expiry, web/agent/worker lockstep versions, minimum compatibility, mandatory/optional update, rollback metadata, trusted HTTPS download, byte size/hash และ embedded package version ต้องยืนยันและหยุด session ก่อนติดตั้ง มี callback สำหรับ runtime self-test/OS integration; ถ้าไม่มี callback จะไม่ activate มี `AVAILABLE`, `UPDATE_REQUIRED`, `UPDATING`, `RESTART_REQUIRED`, rollback states จริง ไม่มี production release hosting ที่เปิดใช้หรือ scheduled update และไม่ทำ silent overwrite ดู [distribution protocol](AI_LIVE_SERVER_ACTIVATION.md)

Version tuple: web/agent/worker `0.4.0`, model `musetalk-unvalidated`; equality ทุก component ก่อน Start เวอร์ชันต่าง → `UPDATE_REQUIRED` Tests ตรวจ parity TypeScript/Python ก่อน release ไม่มี customer/env override สำหรับ GPU validation ตัวติดตั้งรองรับอัปเกรดจาก `0.3.0` โดยเก็บ device identity; รุ่นเก่า `0.2.0` ต้อง bootstrap ด้วย installer ใหม่เพราะยังไม่มี distribution endpoints/keyring

## Security และ recovery limitations

- exact loopback Host/Origin + local bearer; challenge/signature ผูก trusted owner ไม่รับ ownerId เป็นความจริงจาก browser
- no shell/no fetch URLs จากลูกค้า/no absolute upload paths; byte/type/dimension limits, fixed managed directories, exclusive-create และ symlink checks
- token/code อยู่ memory; package config เก็บเฉพาะ pinned public verification key; per-install UUID/private key/certificate/revocation state เก็บ Windows current-user DPAPI ไม่เก็บ plaintext secret ไม่อ้าง hardware attestation
- hardware diagnostics local developer-only ไม่เปิดผ่าน HTTP; sanitized errors/customer projection, ไม่มี token/header/body logs
- bounded queues/recovery; state เป็น memory ยังไม่มี durable agent-process crash reconciliation; model worker resource release ต้องตรวจจริงบน NVIDIA
- ต้องทดสอบ browser Local Network Access prompt บน production HTTPS กับ signed agent หลัง packaging; ห้าม disable browser security ([official guidance](https://developer.chrome.com/blog/local-network-access))

## Verification

TypeScript tests: agent absent/version mismatch, customer redaction, disabled real Start, enrollment bridge/server registry confirmation, renewal/Stop, signed device registration/revoke/nonce proof, fresh owner/entitlement, cloud media route disabled, scoped headers Python tests: native Windows DPAPI identity/tamper/reload, signed challenge/certificate/revoke/fresh pairing, expired membership/lease, update required, local API auth/Origin/Host, pause/resume/stop/recovery และ Node→Python Ed25519 verification

Delivery tests ตรวจ fresh install/upgrade/repair/uninstall, failed upgrade rollback, signature/hash/path/reparse protection, mixed component mismatch, confirmed signed offline update และ bundled executable self-test/hidden launcher startup ส่วน SQL validator ใช้ isolated PGlite/PostgreSQL engine ตรวจ 26 ข้อ รวม independent-device limit/revoked slot reuse, ownership, consumed nonce, RLS, foreign-key cleanup index และทุก anon/authenticated grants ไม่ใช่ cloud staging หรือ remote migration apply:

```powershell
node scripts/validate-ai-live-devices.mjs <absolute-path-to-isolated-pglite/dist/index.js>
```

หลัง uninstall identity บนเครื่องถูกลบ แต่ไม่มีการใช้ secret เพื่อแก้ subscription หรือบัญชี cloud อัตโนมัติ ทะเบียนเก่าต้อง revoke ผ่าน owner-authenticated device endpoint เพื่อคืน slot ก่อน enroll installation ใหม่

Operational activation ที่ยังไม่ทำ: configure server-only signer/trusted membership, build package พร้อม matching public keys, Authenticode และ release/update hosting ไม่มีการสร้าง production secret หรือ deploy เว็บ Production ในรอบนี้ ส่วน registry migration apply แล้ว ดูรายละเอียดและผลตรวจรอบล่าสุดใน [Server Activation](AI_LIVE_SERVER_ACTIVATION.md)

## ผลตรวจ delivery 0.2.0 — 2026-10-01

- TypeScript AI LIVE/routes: **62/62 ผ่าน** (11 test files); ไม่อ้างว่ารันทั้ง repository ในรอบนี้
- Python ทั้ง worker/local agent/delivery: **72/72 ผ่าน** รวม native Windows DPAPI และสอง tests ของ artifact จริง
- Isolated PostgreSQL migration: **26/26 ผ่าน**; สถานะ UNAPPLIED เป็นผลของรอบ 0.2.0 เท่านั้น รอบ Server Activation ได้ apply แล้ว
- `pnpm typecheck`: ผ่าน
- `pnpm lint`: exit 0 / ไม่มี error; 8 warning เดิมใน video benchmark/tests นอกขอบเขต ไม่แก้ส่วนเหล่านั้น
- `pnpm build`: ผ่าน ใช้ public Supabase placeholders เฉพาะ build process; ไม่ใช่ acceptance กับ live database และไม่แก้ `.env.local`/Production env
- Installer artifact, hash และข้อจำกัด release อยู่ใน [installer README](../workers/ai-live/installer/README.md); ไม่ commit executable, runtime หรือ temporary build data
- NVIDIA/MuseTalk/NVENC benchmark: **NOT_RUN**; real Start ยังถูกปิด; **LIVE-1 ไม่ complete**

ไม่มี GPU benchmark, paid provider call, TikTok LIVE call, RTMP หรือ deploy จากงานนี้
