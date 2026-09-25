# TikTok production configuration

ViralFlow ใช้ OAuth และ provider ที่มีอยู่แล้ว การตั้งค่าในเครื่องเตรียม `TIKTOK_PROVIDER=official` ไว้ แต่ยัง **ไม่เริ่ม OAuth** จนกว่าจะมีค่าครบ และยัง **ไม่เปิดการเผยแพร่จริง**

## ค่าที่เจ้าของต้องใส่

เติมใน `.env.local` สำหรับเครื่องพัฒนา และตั้งค่าแยกใน server environment ของ staging/production โดยไม่ใส่ค่าใน source code หรือ `.env.example`:

- `TIKTOK_CLIENT_KEY` และ `TIKTOK_CLIENT_SECRET` จาก TikTok Developer Portal
- `TIKTOK_REDIRECT_URI` เป็น `https://<production-or-staging-domain>/auth/tiktok/callback` ของ environment นั้น และต้องลงทะเบียน URI เดียวกันใน Developer Portal

`SUPABASE_SECRET_KEY` ต้องอยู่ฝั่ง server เท่านั้น ส่วน `TIKTOK_TOKEN_ENCRYPTION_KEY` เป็นค่าสุ่มอย่างน้อย 32 ไบต์ที่สร้างและเก็บไว้ใน `.env.local` แล้วสำหรับเครื่องนี้ ต้องตั้งค่าแยกอย่างปลอดภัยใน environment ที่ deploy ห้ามนำค่า local ไป commit หรือแสดงใน browser

หลังเติมค่า ให้ restart server แล้วเปิด `/accounts` เพื่อดูสถานะ และใช้ `/accounts/connect/tiktok` เริ่ม OAuth ผ่านเส้นทางเดิม หากค่ายังไม่ครบ หน้า Accounts และ Control Center จะระบุชื่อค่าที่ขาดโดยไม่แสดงค่า secret; OAuth start/callback จะไม่สร้าง provider หรือส่งคำขอไป TikTok

## Scopes ที่ code ขออยู่ในปัจจุบัน

OAuth official โหมด `basic` ขอเพียง `user.info.basic`; โหมด `publishing` สำหรับ Direct Post ขอเพียง `user.info.basic` และ `video.publish` เท่านั้น ไม่ขอ `video.upload` หรือ `video.list` ใน flow นี้ การขอ scope **ไม่ถือว่า TikTok อนุมัติ app หรือผู้ใช้ยินยอมแล้ว** ต้องเปิด Login Kit และ Content Posting API → Direct Post, เพิ่ม `video.publish` ใน Sandbox แล้ว Apply changes ใน Developer Portal ก่อนเชื่อมบัญชีใหม่ บัญชีที่เคยเชื่อมด้วยสิทธิ์พื้นฐานต้องอนุญาต scope ใหม่อีกครั้ง

## Gates ที่ยังปิดไว้

คง `TIKTOK_VIDEO_PUBLISH_APPROVED=false`, `TIKTOK_VIDEO_UPLOAD_APPROVED=false`, `TIKTOK_DIRECT_POST_AUDIT_STATUS=UNAUDITED`, `TIKTOK_PUBLISHING_PROVIDER=mock`, `TIKTOK_PUBLISHING_REAL_MODE=false`, `TIKTOK_ANALYTICS_PROVIDER=mock`, `TIKTOK_ANALYTICS_REAL_MODE=false`, `TIKTOK_SHOP_PROVIDER=mock` และ `TIKTOK_SHOP_REAL_MODE=false` จนกว่า approval, scopes และ owner consent จะครบตามเส้นทางที่ใช้งานจริง Direct Post ของ client ที่ยังไม่ผ่าน audit จำกัด `SELF_ONLY` เท่านั้น Growth mode ไม่ต้องพึ่ง Shop approval เพื่อแสดงและวางแผนงาน

ลำดับ demo สั้นที่สุดหลัง Sandbox พร้อม: เปิด ViralFlow → Accounts → Connect TikTok → อนุญาต `user.info.basic` และ `video.publish` ใน TikTok → กลับหน้า Connected → เลือกวิดีโอที่ผ่าน Quality/Compliance ใน Video Factory → Queue Direct Post → ตรวจและยินยอม `SELF_ONLY` ใน Publishing Queue → Direct Post → Refresh Status จนเห็นผลจริงจาก TikTok ห้ามใช้ mock provider หรือวิดีโอที่ไม่ผ่าน gate แทนการทำงานจริง

Staging/production จะไม่ boot ใน official OAuth mode ถ้า server key, TikTok credentials, redirect URI หรือ encryption key ขาด; development boot ได้เพื่อแสดง setup status แต่ route และ provider จะปฏิเสธการเชื่อมต่อที่ตั้งค่าไม่ครบ
