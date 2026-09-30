# AI LIVE Local Agent — foundation

สถานะ `READY_WITHOUT_GPU` สำหรับ control/security/bootstrap contracts; `WAITING_FOR_GPU_VALIDATION` สำหรับ Presenter/audio/encoder; `PRODUCTION_READY=false` ยังไม่มี Windows installer ที่ส่งให้ลูกค้าได้ และไม่มี live broadcast จริง

## โครงสร้าง

```text
src/features/ai-live/local-contract.ts       # release gate + customer-safe projection
src/features/ai-live/local-client.ts         # browser → fixed loopback agent
src/features/ai-live/local-license*.ts       # server entitlement / Ed25519 start grant
src/app/api/ai-live/local-grant/route.ts     # authenticated cloud control only
workers/ai-live/local_agent/
  agent.py                                 # session / worker / encoder boundary
  security.py                              # pairing / challenge / signature verification
  http_server.py                           # strict loopback HTTP surface
  hardware.py                              # Windows probe / provisional tiers
  bootstrap.py                             # signed artifact install/update/repair planner
  launcher.pyw                             # no-terminal GUI launcher foundation
  requirements.txt                         # pinned signature verifier dependency
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
| `GET /v1/challenge` | token/origin; one-use challenge อายุไม่เกิน 120 วินาที |
| `POST /v1/references` | token/origin; JPEG/PNG ≤4MB; local UUID path ไม่รับ customer filesystem path |
| `POST /v1/sessions/start` | signed grant + matched selection/reference; version/hardware/release gate |
| `POST /v1/sessions/{id}/pause,resume,stop,recover` | local token + verified session owner; bounded recovery; Stop idempotent |

Browser requests มี timeout, no redirects/cookies/cache และเก็บ credential ใน memory ไม่ใช้ localStorage/sessionStorage/cookies ไม่ส่ง secret หรือ raw media ไป cloud ขอ machine status ทุก 4 วินาทีแบบ serial และต่ออายุ token ก่อนหมดอายุ 60 วินาที หาก browser ปิด/พักจน token หมดอายุ ต้องจับคู่ใหม่ตาม lifecycle ที่ installer จัดการ; foundation GUI code ใช้ครั้งเดียวต่อ launch

State: `NOT_INSTALLED`, `INSTALLING`, `STARTING`, `READY`, `BUSY`, `PAUSED`, `STOPPING`, `OFFLINE`, `ERROR`, `UPDATE_REQUIRED`, `GPU_REQUIRED` บาง state เป็น installer/browser states ไม่มีการสร้าง progress เปอร์เซ็นต์ปลอม

## Server license และ device ownership

`POST /api/ai-live/local-grant` ใช้ same-origin POST, JSON ≤2048 bytes, authenticated `getUser()` และ owner rate limiter เดิม

Trusted `app_metadata.ai_live` provisioning interface:

```json
{
  "enabled": true,
  "expiresAt": "2027-01-01T00:00:00Z",
  "deviceLimit": 1,
  "registeredDeviceIds": ["11111111-1111-4111-8111-111111111111"]
}
```

ตัวอย่างนี้เป็น schema documentation ไม่ใช่ membership ที่สร้างให้ผู้ใช้ ไม่มีสิทธิ์ใน metadata/device ไม่ registered/เกิน limit/หมดอายุ → deny ไม่ใช้ข้อมูล editable `user_metadata` การบันทึกทะเบียน device/นโยบายแผนสมาชิกผ่าน trusted provisioning ยังต้องเชื่อมภายหลัง; ไม่มี enrollment mutation หรือ local-only license bypass

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

เป้าหมาย signed Windows installer ใช้ embedded Python runtime + pinned packages + managed FFmpeg + GPU-compatible model bundle ให้ลูกค้าติดตั้งครั้งเดียว ไม่ต้องเปิด terminal `.pyw` มี pairing window/copy/close foundation; ต้อง packaged/sign executable ก่อนส่งให้ลูกค้า ไม่มี download button ที่อ้างไฟล์ติดตั้งที่ยังไม่สร้าง

`BootstrapManager` รับ signed manifest จาก trusted installer: fixed artifact names (`agent`, `worker`, `ffmpeg`, `model`), HTTPS host allowlist, fixed release path, SHA-256/size/version checks ก่อน stage atomic copy แยก status first-run/dependencies/model/update/repair ลบเฉพาะ managed artifact names ใน uninstall ไม่มี arbitrary download/execution API

ปัจจุบัน: validate manifest/stage verified bytes/check updates/repair/uninstall foundation พร้อม tests; ยังไม่มี downloader, packaged Python distribution, driver bootstrap, signed release artifacts, large-model transfer หรือ scheduled updater ยังไม่ติดตั้งโมเดลใหญ่ ไม่อ้างว่า auto-download/update ลูกค้าพร้อมใช้แล้ว

Version tuple: web/agent/worker `0.1.0`, model `musetalk-unvalidated`; equality ที่ทุก component ก่อน Start เวอร์ชันต่าง → `UPDATE_REQUIRED` Tests ตรวจ parity ระหว่าง TypeScript/Python ก่อน release ไม่มี customer/env override สำหรับ GPU validation

## Security และ recovery limitations

- exact loopback Host/Origin + local bearer; challenge/signature ผูก trusted owner ไม่รับ ownerId เป็นความจริงจาก browser
- no shell/no fetch URLs จากลูกค้า/no absolute upload paths; byte/type/dimension limits, fixed managed directories, exclusive-create และ symlink checks
- token/code อยู่ memory; config เก็บเฉพาะ public key/device UUID; ไม่มี plaintext auth token storage
- hardware diagnostics local developer-only ไม่เปิดผ่าน HTTP; sanitized errors/customer projection, ไม่มี token/header/body logs
- bounded queues/recovery; state เป็น memory ยังไม่มี durable agent-process crash reconciliation; model worker resource release ต้องตรวจจริงบน NVIDIA
- ต้องทดสอบ browser Local Network Access prompt บน production HTTPS กับ signed agent หลัง packaging; ห้าม disable browser security ([official guidance](https://developer.chrome.com/blog/local-network-access))

## Verification

TypeScript tests: agent absent/version mismatch, customer redaction, disabled real Start, renewal/Stop, server route ownership/entitlement, cloud media route disabled, scoped headers Python tests: hardware fixtures, GPU missing, signature/challenge/replay/device/owner, local API auth/Origin/Host, pause/resume/stop/recovery, signed bootstrap integrity + real Node→Python Ed25519 verification เมื่อ isolated crypto dependency ติดตั้งแล้ว

ไม่มี GPU benchmark, paid provider call, TikTok LIVE call, RTMP หรือ deploy จากงานนี้
