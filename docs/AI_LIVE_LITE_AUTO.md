# ViralFlow AI LIVE — LIVE Lite Auto

พิธีกร AI อัตโนมัติสำหรับเครื่องสเปกต่ำ (เช่น ROG Ally X ที่ไม่มี NVIDIA) โดยไม่มีคนจริงพูดหรือควบคุมไลฟ์
LIVE Pro ยังอยู่ครบทุกส่วน Lite เป็นส่วนเสริมที่เสียบเข้ากับโครงสร้างเดิม ไม่ได้สร้างระบบใหม่ซ้ำ

> สถานะ: ผ่านการทดสอบทางเทคนิคกับ RTMP Test Server เท่านั้น
> **ยังไม่รองรับ TikTok LIVE เชิงพาณิชย์** จนกว่าจะยืนยันสิทธิ์และนโยบาย TikTok Shop Thailand เป็นลายลักษณ์อักษร

## 1. ทำงานอย่างไร

```
Product Radar / สินค้าที่ sync แล้ว ─┐
                                     ▼
LiteShowDirector ──queue_speech──▶ LocalAISession (ของ Pro: คิวคอมเมนต์, Safety Voice, Recovery)
ผู้ชมคอมเมนต์ ──submit_comment──▶      │  brain: LiteRoutedBrain(LocalBrainProvider ของ Pro)
                                       │  voice: SpeechProvider(Cloud TTS / local)
                                       ▼ PCM16 16 kHz
                         LiveStore (worker_core ของ Pro)
                                       │
               LitePresenterEngine ◀───┘  (ภาพเตรียมล่วงหน้า + Lightweight Lip-Sync)
                                       ▼ JPEG + เสียง
                     InternalAVEncoder (libx264 / h264_amf) ──▶ LiteDestinationProvider ──▶ RTMP
```

| ส่วน | ไฟล์ | หน้าที่ |
|---|---|---|
| AI Presenter | `lite_presenter_pack.py`, `lite_pack_builder.py`, `lite_presenter_engine.py` | Pack ภาพปาก/ใบหน้าที่เรนเดอร์ไว้ล่วงหน้า เลือกเฟรมตามเสียงจริง + การหายใจ/โยกตัวเบา ๆ + ป้าย "AI presenter" ฝังในวิดีโอ |
| Lip-Sync | `lite_audio_features.py` | วัดพลังงานและสเปกตรัมเสียงต่อเฟรม แปลงเป็นความกว้างปาก |
| AI Voice | `cloud_tts.py` | Azure AI Speech F0 (คีย์ของเจ้าของ, เพดานฟรี) / เสียงไทยของ Windows (ฟรี ออฟไลน์) + มิเตอร์นับตัวอักษร; espeak-ng สำหรับทดสอบเทคนิค |
| AI Brain | `lite_brain.py` | ใช้คำตอบของ Pro ก่อนเสมอ ถ้า Pro ตอบ "ไม่มีข้อมูล" จะจับคู่คำถามที่ถามต่างคำกับ FAQ/คุณสมบัติที่ร้านอนุมัติ (และให้ Qwen เลือกหัวข้อได้ถ้ามี) คำตอบที่พูดออกไปคือข้อมูลร้านเท่านั้น |
| พิธีกรอัตโนมัติ | `lite_director.py` | พูดแนะนำสินค้าจากข้อมูลจริงต่อเนื่อง หมุนสินค้า หยุดให้คอมเมนต์แทรกได้ |
| ปลายทาง | `lite_destination.py` | อนุญาต RTMP Test Server (loopback/เครือข่ายภายใน); TikTok ถูกปิดด้วย `TIKTOK_AI_PRESENTER_POLICY_UNVERIFIED`; แพลตฟอร์มอื่นต้องมีบันทึกยืนยันนโยบายจากเจ้าของ |
| รวมโหมด | `lite_mode.py` | `LiteWorkerBoundary` = Worker ของ Pro + factory ฝั่ง Lite + Director |
| ทดสอบจริง | `lite_live_proof.py` | ไลฟ์จริงเข้า RTMP Test Server พร้อมบอทถามคำถามใหม่ และรายงาน fps/ความหน่วง/CPU/RAM/ต้นทุน |

ส่วนของ Pro ที่แก้ (เพิ่มอย่างเดียว ไม่เปลี่ยนพฤติกรรม Pro):
- `worker_core.py` ถ้า engine มี `render_idle` จะส่งเฟรม idle ระหว่างประโยค (engine ของ Pro ไม่มี จึงทำงานเหมือนเดิม)
- `local_agent/live_worker.py` `_PreparedEngine` ส่งต่อ hook เสริมของ Lite และตรวจ encoder ตามชื่อ codec จริง
- `av_encoder.py` รองรับ `h264_amf` (AMD iGPU บน ROG Ally X)
- `managed_worker_entry.py` รับ `"liveMode": "lite"` (ค่าเริ่มต้นยังเป็น pro)

## 2. ทำไมถึงทันบน CPU

งานหนัก (สร้างภาพปากด้วย MuseTalk ซึ่งบน CPU ได้ ~0.4 fps) ทำ **ครั้งเดียวตอนเตรียม Pack** ระหว่างไลฟ์เหลือแค่เลือกเฟรมและซ้อนภาพ ~4 ms ต่อเฟรม เสียงพูดใช้ Cloud TTS แทน VoxCPM2 ที่ช้ากว่าเวลาจริง ~7 เท่าบน CPU

## 3. เตรียม Presenter Pack

ต้องมีหนังสือยินยอมใช้ภาพ/ใบหน้าของบุคคลจริงก่อนใช้กับลูกค้า (Pack ที่ไม่ใช่ทดสอบจะโหลดไม่ได้ถ้าไม่มี `consent`)

```bash
# ทดสอบเทคนิคเท่านั้น (หน้าการ์ตูน)
python lite_pack_builder.py synthetic --out packs/synthetic

# จากรูปผู้นำเสนอ + เสียงตัวอย่าง ใช้ MuseTalk CPU ของ Pro เรนเดอร์ล่วงหน้า (ช้า แต่ทำครั้งเดียว)
python lite_pack_builder.py frame-engine --out packs/host-a --reference host.png --calibration-wav calibration.wav \
    --customer --consent consent.json

# จากวิดีโอที่ถ่ายผู้นำเสนอพูด (หัวนิ่ง)
python lite_pack_builder.py video --out packs/host-b --video host.mp4 --consent consent.json
```

`consent.json`: `{"likeness_use": true, "person": "ชื่อผู้ยินยอม", "signed_at": "2026-10-18"}`

## 4. ตั้งค่าเสียง

ไม่มีคีย์ = ไม่มีเสียง Azure (ระบบไม่สลับไปใช้บริการเสียเงินเอง)

| `AI_LIVE_LITE_TTS` | เสียง | ค่าใช้จ่าย |
|---|---|---|
| `azure` | Azure AI Speech Neural ไทย (Premwadee / Achara / Niwat) ตั้ง `AZURE_SPEECH_VOICE` | F0 ฟรี 500,000 ตัวอักษร/เดือน ระบบหยุดเองที่ 450,000 และจำกัด 18 ครั้ง/นาที ไม่มีการเปลี่ยนเป็น Paid |
| `windows` | เสียงไทยที่มากับ Windows (Microsoft Pattara) ทำงานออฟไลน์ ไม่ต้องใช้คีย์ ไม่ต้องติดตั้ง | ฟรี |
| `espeak` | espeak-ng (ทดสอบเทคนิคเท่านั้น) | ฟรี |

คีย์ Azure เก็บแบบเข้ารหัส DPAPI ด้วย `python lite_speech_key.py set --region southeastasia` (หน้าต่างกรอกแบบซ่อนตัวอักษร) ระบบไม่อ่านคีย์จากตัวแปร environment และไม่บันทึกคีย์ลง log

## 5. ทดสอบบน ROG Ally X

```powershell
$env:AI_LIVE_ENCODER = "h264_amf"     # ถ้า ffmpeg ใช้ AMF ไม่ได้ ให้ใช้ libx264
$env:AI_LIVE_LITE_TTS = "azure"       # หรือ windows (เสียงไทยฟรีของ Windows)
python lite_live_proof.py --output proof-ally --pack packs/host-a --seconds 600
```

รายงานอยู่ที่ `proof-ally/lite-proof.json` และวิดีโอที่รับได้ `proof-ally/received.flv`

## 6. นโยบาย: แยกการทดสอบทางเทคนิคออกจากไลฟ์ขายจริง

สิ่งที่ตรวจพบจากเอกสารทางการ (ตรวจเมื่อ 2026-10-18):
- TikTok Shop Thailand Content Policy (ปรับปรุง 16/03/2026): ไลฟ์ที่ไม่ใช่ real-time ถือเป็น Low Quality, ไลฟ์ที่ไม่มีการโต้ตอบด้วยเสียงแบบ real-time ต่อเนื่องถือเป็น Non-Interactive, เนื้อหา AIGC ต้องติดป้าย, ห้าม simulcast
- TikTok Shop US ห้ามเสียงที่สร้างด้วย AI และเสียงอัดล่วงหน้าในไลฟ์ และจำกัดภาพเคลื่อนไหว/ภาพนิ่งไม่เกิน 50% ของจอ ยังไม่พบประกาศฉบับไทยที่อนุญาตหรือห้าม AI presenter โดยตรง
- ไม่มี API ทางการสำหรับอ่านคอมเมนต์ไลฟ์แบบ real-time ระบบนี้ไม่ใช้ตัวอ่านคอมเมนต์ที่ไม่เป็นทางการ
- การได้ RTMP stream key ขึ้นกับสิทธิ์ของบัญชี (LIVE Studio/อายุ/ผู้ติดตาม)

กติกาที่ระบบบังคับ:
1. การทดสอบทางเทคนิคส่งได้เฉพาะ RTMP Test Server ภายในเครื่อง/เครือข่ายภายใน
2. TikTok ถูกปิดไว้จนกว่าจะมีคำยืนยันจาก TikTok Shop Thailand (ผู้จัดการบัญชีหรือ Seller Support) และบันทึกเป็นไฟล์ยืนยัน (`AI_LIVE_LITE_PLATFORM_ATTESTATION`)
3. ไม่มีโหมดหลบการตรวจจับ ป้าย "AI presenter" ฝังในวิดีโอเสมอ
4. ถ้า TikTok ไม่อนุญาต ให้ใช้แพลตฟอร์มที่อนุญาตแทน โดยบันทึกหลักฐานนโยบายในไฟล์ยืนยันเดียวกัน
5. ห้ามใช้กับบัญชีขายจริงระหว่างทดสอบ

ตัวอย่างไฟล์ยืนยัน (ใช้เมื่อได้รับคำยืนยันจริงแล้วเท่านั้น):

```json
{"platforms": [{"platform": "example", "hosts": ["rtmp.example.com"], "ai_presenter_allowed": true,
  "ai_voice_allowed": true, "evidence": "อีเมลยืนยันจาก ... เลขอ้างอิง ...", "verified_at": "2026-10-20"}]}
```
