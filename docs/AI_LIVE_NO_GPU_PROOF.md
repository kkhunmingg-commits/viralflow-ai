# AI LIVE — หลักฐาน DEV proof บน CPU

วันที่ตรวจ: 2 ตุลาคม 2026 บน `feature/ai-live` ต่อจาก `7ff961cae00aa2833a30d1e9602afc1877755dc6` เป็นการพิสูจน์ media flow ของ ViralFlow เดิม ไม่มีการเผยแพร่ TikTok, เรียก paid API, เปลี่ยน credentials, เปลี่ยน schema หรือ deploy Production **LIVE-1 production validated ยังเป็น false**

## Backend ที่ใช้จริง

`MuseTalkCPUFloat32` ใช้ MuseTalk 1.5 UNet, Whisper-tiny audio embeddings และ VAE บน CPU float32 สร้างภาพหน้าพูดจาก reference + PCM16 แล้ว blend ส่วนล่างของใบหน้าในภาพ 256×256 ไม่มี enhancer, CUDA emulation, mock frame หรือ prerecorded loop ใช้ core model interface ที่รองรับ CPU แทน stock realtime script ที่มี half/CUDA assumptions ดู [หลักฐานจาก upstream, licenses และ setup](../workers/ai-live/DEV_CPU_BACKEND.md)

ดาวน์โหลด weights จาก official repositories และตรวจ SHA256/เก็บ source revision ใน `.ai-live-dev/model-manifest.json` ขนาดรวมประมาณ 3.9 GB ไม่ commit weights, runtime, reference, เสียง หรือผลทดลอง ใช้ NASA astronaut fixture เฉพาะทดสอบ local; ไม่อ้างว่าเป็นผู้ขายหรือมี endorsement

สภาพเครื่อง: Windows, Python 3.10.11, CPU 16 logical processors, Torch 2.6.0 CPU, inference ใช้ 4 threads, ไม่มี NVIDIA/CUDA/NVENC ที่ตรวจผ่าน รายละเอียด dependencies pin อยู่ใน `workers/ai-live/requirements-dev-fallback.txt`

## ผลทดสอบต่อเนื่องด้วยเสียงจริง

ใช้เสียงภาษาไทย Windows SAPI `Microsoft Pattara` ออฟไลน์ ความยาว 5.585 วินาที mono 16 kHz PCM16 ส่ง chunks ตามความเร็ว inference ใน session จริงต่อเนื่อง 600.438 วินาที การวนเสียงใช้ทดสอบเสถียรภาพโดยตั้งใจ ไม่ใช่ duplicated speech action และภาพทุกเฟรมผ่าน neural inference ใหม่

| รายการ | ผลที่วัดจริง |
| --- | --- |
| เวลา session แบบ wall-clock | 600.438 วินาที |
| เฟรมที่สร้าง / รับผ่าน MJPEG / encode | 243 / 243 / 243 |
| JPEG hashes ที่แตกต่าง | 113; เสียง/reference เดิมจึงมีภาพซ้ำได้ ไม่มี video loop |
| average FPS | 0.404; target config 2 FPS ยังไม่ถึงเป้าหมาย 2–5 FPS |
| p50 / p95 frame latency | 7,157 / 9,922 ms |
| CPU inference process เฉลี่ย | 398.59% ตาม psutil ซึ่งนับหลาย cores รวมกัน; ประมาณ 24.91% ของเครื่อง 16 logical CPUs |
| RAM ช่วงติดตาม process จริง | เริ่ม 4,366.0 MiB, จบ 4,367.6 MiB, peak 4,370.2 MiB |
| จำนวน CPU/RAM samples | 512 samples ในช่วง 520.75 วินาทีหลังช่วงโหลดเริ่มต้น |
| frame drops / preview error / process crash | 0 / ไม่มี / ไม่มี |
| audio queue สูงสุด / หลัง Stop | 1 / 0 |
| Stop / resource release | STOPPED / true; RAM หลังคืน models 774.3 MiB |
| Encoder | software libx264, local MP4, 957,736 bytes; NVENC=false, audio_encoded=false |

`proof.json` รอบแรกจับ parent PID ของ Windows venv launcher ผิดสำหรับ CPU/RAM: **ห้ามใช้ samples และ cpu/ram summary ของ parent นั้น** ค่าตารางนี้ใช้ `runtime-measurements.json` ซึ่งอ่าน psutil metrics จาก inference process ผ่าน API จริงระหว่างรอบเดียวกัน 512 samples ไม่ใช่การประมาณจาก parent การวัดใน `proof_flow.py` รุ่นที่ commit แก้ให้ใช้ worker metrics แล้ว ค่าจำนวนเฟรม/เวลา/p50/p95/encoder มาจาก worker ของรอบ 600 วินาที

Browser engineering preview แสดง JPEG จาก inference จริงและอ่าน metrics ที่เพิ่มขึ้นจริง ตรวจไม่พบ console errors/warnings หน้า proof นี้เป็นเครื่องมืออ่านผลที่ loopback ไม่ใช่หน้า customer หรือการข้าม authentication

## ขอบเขตที่ต้องรายงานตามจริง

- CPU ต่ำกว่าเป้าหมาย FPS และ audio/image ยังไม่ synchronized แบบ realtime; local MP4 เก็บเฉพาะ video track ตาม nominal 2 FPS จึงไม่ใช่วิดีโอ 10 นาทีพร้อมเสียง
- Local `/ai-live` DEV console มี file-audio และ AudioWorklet microphone path แต่ browser test ผ่าน customer-authenticated Next route ยังไม่ทำ: process ปัจจุบันไม่มี Supabase public configuration และไม่อ่าน/แก้ `.env.local` เพื่อข้ามข้อจำกัด ผล browser ที่ยืนยันคือ worker engineering preview; route/auth/audio/frame transport มี automated tests แยก
- ตรวจ products ของ owner บัญชีเดิมแล้วไม่มี records จึงใช้ **existing test fixture** จาก `live-pipeline.test.ts` แบบ memory-only เพื่อพิสูจน์ Comment→Brain→Product→Voice contract ไม่สร้างหรือ seed สินค้าใหม่ ไม่อ้างว่า verified กับสินค้าจริงใน Supabase
- Production ยังต้อง LOCAL_GPU + NVIDIA/CUDA, MuseTalk hardware benchmark, AV sync, NVENC/encoder integration และ real-session stability ตาม [GPU validation checklist](AI_LIVE_GPU_VALIDATION.md)

## วิธีทำซ้ำโดยไม่เปิด Production

ติดตั้ง dependencies/official models ตาม CPU backend guide และตั้ง flags เฉพาะ process สำหรับ local DEV Worker token ให้สร้างสุ่มใหม่และเก็บฝั่ง server เท่านั้น ไม่ใช้ credentials Production และไม่ส่ง token ให้ browser

```powershell
$env:AI_LIVE_DEV_FALLBACK='true'
$env:PRESENTER_PROVIDER='dev_fallback'
$env:APP_ENV='development'
$env:NODE_ENV='development'
$env:AI_LIVE_DEV_CPU_THREADS='4'
.\.venv-dev\Scripts\python.exe workers/ai-live/proof_flow.py --reference '.ai-live-dev/reference-astronaut.png' --audio '.ai-live-dev/proof/thai-speech.wav' --owner '<existing-owner-uuid>' --output '.ai-live-dev/proof/stability' --seconds 600
```

สคริปต์สร้าง bearer ชั่วคราวใน memory, รัน loopback worker ของตัวเอง, reference/session/audio/MJPEG จริง, software encode, Stop และ cleanup; browser read-only proof server ปิดตาม process ไม่ทิ้ง listener ถาวร `--microphone` ใช้ physical microphone live callbacks; `--comment-context` อ่าน existing account/product context จาก local JSON สำหรับ domain proof และสังเคราะห์เสียงออฟไลน์ ไม่มีการใช้ account mock แทน API TikTok เพราะรอบนี้ไม่เรียก TikTok เลย

Native microphone/SAPI และ FFmpeg ต้องได้รับสิทธิ์จากระบบปฏิบัติการ; sandbox ที่ปฏิเสธ hardware/subprocess จะตอบข้อผิดพลาด ไม่ fallback เป็นเสียงหรือภาพปลอม

## Artifacts บนเครื่องที่ไม่ commit

- `.ai-live-dev/proof/stability/proof.json`
- `.ai-live-dev/proof/stability/runtime-measurements.json`
- `.ai-live-dev/proof/stability/first-frame.jpg` และ `last-frame.jpg`
- `.ai-live-dev/proof/stability/encoded/776fbbfe-32eb-4771-957f-d0595b58a667.mp4`
- `.ai-live-dev/proof/microphone-capture.json` และ `microphone.wav`: physical capture 5 วินาที ไม่ใช่เสียงจำลอง

## Microphone และ Comment integration ที่ทดสอบจริง

Physical `Microphone Array (Realtek(R) Audio)` ผ่าน PortAudio MME ส่ง PCM callbacks สด 30.641 วินาที รับ 30 chunks / 960,000 bytes ไม่ใช่การเล่น `microphone.wav` ซ้ำ ส่งเข้า CPU 7 chunks ได้ 11 generated JPEG ที่ hash ต่างกัน 11 ภาพ และ encode 11 เฟรมจริง ไม่มี hardware input overflow หรือ process crash Stop คืน mic/session/encoder และล้างคิวสำเร็จ

CPU ประมวลผลช้ากว่า capture จึงทิ้ง audio เก่า 21 chunks และล้างอีก 2 chunks ที่ค้างเมื่อหยุด buffer สูงสุด 2; การทดลองนี้ **ไม่ผ่าน realtime audio continuity** แม้พิสูจน์ microphone→inference→preview ได้ ไม่มีการปิดบัง audio loss ด้วยตัวเลข frame drops=0

หลัง Stop ใช้ worker เดิมเริ่ม session ใหม่ผ่าน `LiveSessionController` และ `LivePipeline` จริง คอมเมนต์จำลอง “สินค้านี้ใช้ยังไง” → `CommentEngine` → `RuleBasedLiveBrain`/`ProductBrain` → `ActionQueue` → Windows `VoiceProvider` → CPU presenter ให้เสียง 172,000 bytes จากการสังเคราะห์ 1 ครั้ง ได้ 10 JPEG จริง รอ audio/inference จบแล้วจึง Stop ข้อความซ้ำถูกปฏิเสธ คิว comments/actions จบที่ 0 และ resource release=true

Events จากระบบเดิมเป็นภาษาไทย: เตรียมการแสดงสด, มีความคิดเห็นใหม่, เตรียมคำตอบแล้ว, กำลังแนะนำสินค้า, กำลังพูด ใช้ `EXISTING_TEST_FIXTURE` ที่มีอยู่แล้ว ไม่ใช้ LLM หรือ paid TTS และยังไม่ตรวจคำตอบเชิงสินค้าใน production Local MP4 ของ comment ตรวจ decode ได้ h264 256×256 จำนวน 10 เฟรม / 5.000 วินาที เป็น video-only เช่นเดียวกับ stability sink

Artifacts เพิ่มเติม:

- `.ai-live-dev/proof/microphone-comment/proof.json`
- `.ai-live-dev/proof/microphone-comment/comment-proof.json`
- `.ai-live-dev/proof/microphone-comment/encoded/fecd0052-4ffb-4b00-be60-641eb9f84759.mp4`
- `.ai-live-dev/proof/microphone-comment/encoded/52140603-745b-43fa-9f84-d86d2acb1103.mp4`

## Final verification

- Python tests: 118 passed รวม opt-in real CPU frame generation และ real Thai offline speech; รันชุดเต็มโดยปิด fallback ใน process เริ่มต้น เพื่อไม่ให้ DEV setting เปลี่ยน assumptions ของ production tests
- TypeScript AI LIVE tests: 113 passed / 21 files หลัง source freeze ตรวจ authentication, production denial, bounded audio/resampling, preview, Stop/release และ domain contract
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed หลัง source freeze; lint 0 errors; build ใช้ public build-placeholder configuration เฉพาะ process เพื่อ compile ไม่ได้ยืนยัน Supabase login หรือแก้ `.env.local`
- lint ของ unrelated video files มี warnings เดิม 8 รายการ; ไม่แก้ scoring/AUTO/video/TikTok เพราะอยู่นอกขอบเขต
- ชุด TypeScript ทั้ง repository: 511 passed, 1 skipped, 1 failed เดิมใน `src/features/operations/scheduler.test.ts` ซึ่งคาดว่ามี cron ใน `vercel.json` แต่ไฟล์ปัจจุบันเป็น `{}` จากการปิด cron สำหรับ Vercel Hobby ไม่แก้ scheduler/config ในงาน AI LIVE และไม่รายงานว่า full suite ผ่านทั้งหมด การทดสอบ FFmpeg เดิมผ่านเมื่อรันด้วยสิทธิ์ native subprocess
- Python libraries มี Starlette httpx deprecation warning และ NASA PNG มี iCCP profile warning; actual JPEG preview ไม่มี browser errors/warnings ไม่อ้างว่าคำเตือนจาก dependencies เป็น runtime UI failure

ห้ามตีความว่า main/Production ได้รับการอัปเดตในงานนี้ ไม่มี merge/deploy หรือการอนุมัติ LIVE-1
