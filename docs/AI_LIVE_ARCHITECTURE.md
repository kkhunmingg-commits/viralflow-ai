# AI LIVE — Local GPU architecture

AI LIVE อยู่ใน ViralFlow AI เดิม ใช้ผู้ใช้ บัญชี TikTok และสินค้าเดิม ค่าเริ่มต้นคือ `LOCAL_GPU`: งาน Presenter/เสียง/เข้ารหัสอยู่บน Windows ของลูกค้า ไม่มีการเลือก Cloud GPU หรือ MockPresenter แทนโดยเงียบ ๆ ระบบ Affiliate AUTO และ Content Posting เดิมไม่เปลี่ยนแปลง **LIVE-1 ยังไม่ complete และยังเริ่มไลฟ์จริงไม่ได้**

## สถานะจาก implementation

| สถานะ | ส่วนที่มีอยู่จริง | ขอบเขต |
| --- | --- | --- |
| `READY_WITHOUT_GPU` | Local API/handshake, compatibility gate, Windows installer พร้อม runtime, signed update distribution/rollback, persistent device registration/revoke/limit, key rotation/entitlement, customer UI และ bounded domain tests | registry apply แล้วบน project เดิม; installer ยังไม่เซ็น Authenticode และยังไม่เปิด production enrollment/update channel |
| `WAITING_FOR_GPU` / `GPU_VALIDATION_REQUIRED` | MuseTalk incremental backend, audio/frame synchronization, local encoder และ hardware performance | ยังไม่เชื่อม/วัดบน NVIDIA จริง |
| `PRODUCTION_READY` | **false** | `AI_LIVE_REALTIME_VALIDATED=false`; ยังไม่มี real LIVE transport, signed installer distribution หรือ production device enrollment ที่เปิดใช้งานแล้ว |
| `DEV_PROOF_OF_FLOW` | MuseTalk CPU float32, เสียงภาษาไทยออฟไลน์, microphone PCM, generated JPEG preview และ software local encoder | เปิดแยกเฉพาะ local development; ไม่ใช่ GPU validation หรือสิทธิ์เริ่มไลฟ์จริง ดู [ผลการพิสูจน์บน CPU](AI_LIVE_NO_GPU_PROOF.md) |

## Cloud control / local media

```mermaid
flowchart TD
  User[ผู้ใช้ ViralFlow] --> Web[หน้า AI LIVE]
  Web --> Cloud[Cloud: Login / Membership / Config]
  Cloud --> Existing[บัญชี TikTok และสินค้าเดิม]
  Web -->|รหัสจับคู่ + bearer ชั่วคราว| Agent[Local Live Agent บน Windows]
  Web -->|signed challenge / device proof| Registry[Server: สมาชิก / ทะเบียนเครื่อง / จำกัดเครื่อง]
  Registry -->|signed certificate| Agent
  Web -->|fresh membership / proof| Grant[Server signed start grant]
  Grant -->|Ed25519 authorization| Agent
  Agent --> Hardware[ตรวจเครื่องและเวอร์ชัน]
  Hardware --> Gate{ผ่าน GPU validation แล้ว?}
  Gate -->|ยังไม่ผ่าน| Block[หยุดอย่างชัดเจน / AUTO เดิมยังใช้ได้]
  Gate -->|อนาคตหลัง validation| Presenter[MuseTalkLocalPresenter]
  Mic[ไมโครโฟนบนเครื่อง] --> Presenter
  Presenter --> Encoder[LocalEncoder / StreamProvider]
  Encoder --> Future[TikTok LIVE: ขั้นต่อไป ยังไม่เชื่อม]
```

Browser ติดต่อ `http://127.0.0.1:8766` โดยตรง เว็บไม่ส่งภาพ Presenter, PCM audio หรือ realtime frames ผ่าน cloud media proxy เดิมอีกแล้ว `/api/ai-live/health` ตอบว่าต้องใช้ local agent; legacy media endpoints ตอบ `410` และไม่ fetch worker แม้มี legacy config การขอ grant เท่านั้นที่ผ่าน cloud โดยไม่มี media

หน้า `/ai-live` อนุญาต CSP connect ไป loopback address เดียว และ microphone เฉพาะหน้านี้ สิทธิ์ของหน้าอื่นคงเดิม เบราว์เซอร์อาจขอ Local Network Access permission; ห้ามใช้ browser flags เพื่อข้าม security การเชื่อมจาก HTTPS ต้องทดสอบกับ browser ที่รองรับก่อนเผยแพร่จริง ([Chrome official Local Network Access](https://developer.chrome.com/blog/local-network-access))

## ขอบเขตของระบบ

- Cloud ใช้ `auth.getUser()` ตรวจผู้ใช้สด อ่าน `app_metadata.ai_live` ที่ server เป็นผู้กำหนด และตรวจ ownership ของ account/product ก่อนลงลายเซ็น ไม่อ่าน `user_metadata` เป็นสิทธิ์
- Agent จับคู่ด้วยรหัสใช้ครั้งเดียว bearer origin-bound อายุ 15 นาที อยู่ใน memory ต่ออายุ/หมุน token ก่อนหมดอายุ UUID และ Ed25519 identity ต่อ installation เก็บแบบ Windows current-user DPAPI; ไม่มี plaintext private key/cloud token การลงทะเบียนใช้ proof-of-possession ไม่ใช่ hardware attestation
- ทะเบียนเครื่องจริงอยู่ใน server-only RLS tables; registration ตรวจสมาชิกสด/เจ้าของ/nonce/จำนวนเครื่องแบบ atomic; revoke บล็อก grant ใหม่ทันที และ signed revoke receipt หยุด session ของเครื่องนั้นเมื่อ local agent ได้รับ ไม่อ้างว่า remote revoke หยุดเครื่อง offline ได้ทันที
- Start grant อายุไม่เกิน 120 วินาที ผูก owner/device/challenge/account/products/component versions และ grant ID ใช้ครั้งเดียว เป็น authorization สำหรับ **เริ่ม session** ไม่ใช่ heartbeat membership ระหว่าง stream สิทธิ์เปลี่ยนต้องตรวจใหม่เมื่อ Start ครั้งถัดไป ยังไม่มี active membership revocation service
- หนึ่งเครื่องมี active session ได้หนึ่งรายการ Start initialize worker ครั้งเดียว; Pause/Resume/Stop ตรวจ session owner Stop ไม่ติด gate เรื่องสิทธิ์หมดอายุหรือ hardware เมื่อ worker ขัดข้องมี recovery จำกัดหนึ่งครั้ง ถ้า Start grant ไม่สดแล้วต้อง Stop/release และขอ grant ใหม่ ไม่มี auto restart loop
- ไม่มี snapshot durable ข้ามการ restart ของ process ในรุ่นนี้ session/token เป็น memory shutdown พยายาม Stop และล้าง reference; การ recovery ผ่าน HTTP มีเฉพาะ session ที่ agent ยังถืออยู่ การจัดการ orphan worker หลัง process kill รอ real worker integration
- `PresenterProvider` เดิมมี chunk audio / receive frames / Stop / health / metrics; `MuseTalkLocalPresenter` ผูก boundary นี้สำหรับ incremental local backend ส่วน `MockPresenter` ใช้ automated tests เท่านั้น
- `WorkerBoundary`, `StreamProvider` และ `LocalEncoder` กำหนด lifecycle ที่ต้องต่อ real adapters รุ่นนี้ default เป็น unvalidated worker/encoder จึง fail closed ไม่เรียก cloud provider หรือสร้าง fake preview

## Domain foundation ที่ reuse

`LiveSessionController`, `CommentEngine`, `LiveBrainProvider`, `ProductBrain`, `ActionQueue`, `LivePipeline`, `LiveEventLog`, `Watchdog` และ Python `VoiceProvider` จาก non-GPU foundation คงอยู่ ใช้สินค้า/บัญชีเดิม ไม่สร้างฐานสินค้าใหม่

Internal test path:

```text
normalized comment → CommentEngine → LiveBrain → ProductBrain
  → ActionQueue → VoiceProvider → PresenterProvider
  → Event / Watchdog / session state
```

30-minute virtual-clock tests ตรวจ queue/event bounds, cancellation และ duplicate actions เป็น mock simulation เท่านั้น ไม่ใช่ 30-minute GPU benchmark หรือ TikTok LIVE broadcast

## Customer UI

แสดงบัญชี TikTok, ภาพ Presenter, สินค้า, ตรวจไมโครโฟนเริ่มต้น, ส่วนเสริม/เครื่อง/สมาชิกพร้อมหรือไม่, ลงทะเบียนหรือยกเลิกเครื่อง, ตรวจอัปเดต/อัปเดต/ซ่อมแซม และ Start/Stop ดึงสถานะ local กับสิทธิ์สมาชิกจาก server ทุก 4 วินาทีแบบไม่ซ้อนคำขอ การติดตั้งต้องยืนยัน หยุด session และผ่าน signature/hash/trusted-download checks ไม่ใช้สถานะ browser เป็นสิทธิ์สมาชิก

ภาพที่อัปโหลดเป็น **ภาพอ้างอิง ไม่ใช่ภาพสด** การตรวจไมโครโฟนขอ permission เมื่อผู้ใช้กดเท่านั้นและปิด audio tracks ทันที ไม่บันทึกหรือส่งเสียงออกจาก browser การรับเสียงจริงเข้าตัว Presenter ยังรอ NVIDIA integration Start ถูกปิดด้วย validation gate ทั้ง UI/client/agent แม้ hardware fixture ผ่าน

Customer projection เลือกเฉพาะสถานะ/เหตุผลภาษาไทยที่อนุญาต ไม่แสดง provider/model/ports/IDs/diagnostic payload ระบบ hardware raw diagnostics มีเฉพาะ local trusted developer call และไม่มี HTTP endpoint

## DEV proof ที่ไม่มี NVIDIA

เมื่อ `AI_LIVE_DEV_FALLBACK=true` และ `PRESENTER_PROVIDER=dev_fallback` บน local development เท่านั้น หน้า `/ai-live` เพิ่มเครื่องมือทดลองแยกจาก customer console เดิม มี reference, local audio, microphone, Start/Stop, generated frames และค่าที่วัดจริง `/api/ai-live/dev/*` ตรวจ flag ก่อนตอบ, ตรวจ `auth.getUser()` และกำหนด owner จาก session ฝั่ง server แล้วจึงส่งไป worker ที่ loopback; ไม่มี worker bearer ใน browser หรือ URL ของ client

`NODE_ENV`, `APP_ENV`, `AI_LIVE_ENV` หรือ `VERCEL_ENV` เป็น production หรือมี `VERCEL` จะปิดโหมดนี้ แม้เปิด flag ไว้ การปิด flag คง `GPU_REQUIRED` เดิม ไม่สลับเป็น mock เมื่อ dependency/model/hardware ไม่พร้อม Worker ทุก media request ยังตรวจ bearer และ session owner โหมดนี้ไม่ได้เปิด membership enrollment, start grant หรือ production LIVE gate

```mermaid
flowchart LR
  Reference[ภาพอ้างอิงที่มีสิทธิ์ใช้] --> CPU[MuseTalk CPU float32]
  File[ไฟล์เสียง PCM จริง] --> CPU
  Mic[ไมโครโฟน: PCM chunks] --> Queue[คิวจำกัดขนาด / backpressure]
  Queue --> CPU
  Comment[คอมเมนต์จำลอง] --> Domain[CommentEngine / LiveBrain / ProductBrain เดิม]
  Domain --> Action[ActionQueue เดิม]
  Action --> Voice[VoiceProvider: Windows offline speech]
  Voice --> Queue
  CPU --> JPEG[เฟรมที่ inference ได้จริง]
  JPEG --> Preview[DEV preview / counters จริง]
  JPEG --> Encoder[StreamProvider / software libx264]
  Encoder --> Local[ไฟล์ MP4 บนเครื่อง: วิดีโออย่างเดียว]
  Stop[Stop / interrupt] --> Release[ล้างคิว / ปิดเสียง / คืน models และ encoder]
```

ภาพไม่ได้มาจาก prerecorded loop; inference ส่งแต่ละ JPEG ก่อนมีไฟล์วิดีโอสำเร็จ เสียงออฟไลน์สร้าง WAV ชั่วคราวแล้วส่ง PCM chunks ผ่าน contract เดิม จึงไม่ได้อ้างว่า TTS เป็น streaming synthesis หรือเสียง preview ตรงภาพแบบ realtime CPU ช้ากว่าเสียงจริง: input buffer และคิว bounded พร้อมนับ audio drops แยกจาก frame drops

การสลับกลับ `PRESENTER_PROVIDER=musetalk` ใช้ audio/frame/health/metrics/interrupt/release contract เดิม แต่ยังต้องติดตั้ง backend และผ่าน NVIDIA validation; ค่า config อย่างเดียวไม่รับรอง CUDA, FPS หรือ AV sync ไม่มี TikTok LIVE/RTMP ใน proof นี้

## งานที่เหลือในขอบเขตถัดไป

1. NVIDIA จริง + incremental MuseTalk implementation ตาม [GPU validation checklist](AI_LIVE_GPU_VALIDATION.md)
2. Audio capture/encoder implementation และวัด synchronization, FPS/latency/VRAM/long-session stability
3. เซ็น Authenticode และเผยแพร่ installer/update artifacts ผ่านช่องทางที่เชื่อถือได้; เพิ่ม trusted public verification key ใน release build ตาม [Local Agent](AI_LIVE_LOCAL_AGENT.md)
4. Registry migration `20261001091106_ai_live_device_registration.sql` apply แล้วครั้งเดียว แต่ยังต้อง configure server-only signer และ provision `app_metadata.ai_live` ด้วย trusted membership system ไม่มีการสร้างสิทธิ์สมาชิกปลอมหรือ billing flow ใหม่ ดู [Server Activation](AI_LIVE_SERVER_ACTIVATION.md)
5. LIVE transport/comments/RTMP/product pinning ต้องเป็นงานที่ได้รับอนุมัติแยกต่างหาก Content Posting scopes ไม่ได้ให้สิทธิ์ TikTok LIVE

ไม่มีการแตะ TikTok Production ที่ In Review, OAuth/scopes, Production env, AUTO, Product Radar, Creative Brain, Posting, Analytics หรือ Learning และไม่มี merge/deploy Production
