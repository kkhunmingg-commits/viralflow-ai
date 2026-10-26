# Viral Flow AI — ย้ายเครื่องทำงาน

ตรวจเมื่อ 26 ตุลาคม 2026 (Asia/Bangkok). Repository:
https://github.com/kkhunmingg-commits/viralflow-ai

**โค้ดที่ตรวจพบสำรองบน GitHub แล้ว แต่ไฟล์ประกอบและคีย์ยังต้องย้ายแบบส่วนตัวก่อนล้างเครื่องเก่า**
เอกสารชุดนี้อยู่ branch `codex/machine-migration-20261026` ซึ่งเป็นเอกสารสำรองต่อจาก
`codex/claude-handoff-20261014` ไม่ใช่ branch ที่รวมฟีเจอร์ทุกระบบเข้าด้วยกัน

## เลือกงานให้ถูก branch

| งาน | Branch | Checkpoint |
| --- | --- | --- |
| AI LIVE Lite ล่าสุด | `feature/ai-live-lite` | `a40dd953f38b1736e70a5faf59654c4b9075b404` |
| AI LIVE / Local Agent / installer / CPU Presenter เดิม | `feature/ai-live` | `a7d55301c8080a621a3330804173cf5d56be58eb` |
| Viral Intelligence / Growth / Google Vids / fal router | `codex/google-vids-fal-router` | `9545a003d9f2d5ef7b572b08896724b32ce9ca02` |
| POST multi-account | `feature/post-multi-account` | `2614eadcc4afca7dbd579adc3a5baa5748e24eef` |
| Compliance integration | `codex/production-readiness-integration` | `d684eb4680178fcec9985f315595ec673148f994` |
| Branding Fix ที่ใช้ส่ง TikTok review | `codex/tiktok-icon-review-fix` | `c52b67bd4b352e93a47416190806b6e7d7978697` |
| Manual POST / export | `codex/manual-post-export` | `d5185edcebdf485d5d2ca87301ebdb49db3876b3` |

รายการ remote ทั้ง 178 refs และความสัมพันธ์ของ local branches ทั้ง 34 ตัว ณ เวลาสำรวจอยู่ใน
[`migration/BRANCHES_20261026.json`](migration/BRANCHES_20261026.json).
ทุก local tip เดิมพบอยู่ในประวัติของ remote แล้ว รวม historical tips ที่เคยสำรองแยกไว้
ห้าม push local main/develop ทับ remote ซึ่งมีงานใหม่กว่า และห้าม merge ทุก branch เพื่อย้ายเครื่อง
remote มีงาน Claude และผลทดลองเพิ่มเติมอยู่แล้ว ให้รักษาไว้ทั้งหมดและ fetch ก่อนทำงาน

## เริ่มบนเครื่องใหม่

ใช้ Git, Node 24 ขึ้นไป และ pnpm ตาม `packageManager` ของ branch ที่เลือก แนะนำ clone ลง
path สั้น เช่น `C:\dev` เพื่อหลีกเลี่ยงปัญหาความยาว path บน Windows

```powershell
git clone --branch codex/machine-migration-20261026 https://github.com/kkhunmingg-commits/viralflow-ai.git C:\dev\viralflow
cd C:\dev\viralflow
git fetch origin --tags
git branch -r
git worktree add ..\viralflow-live-lite origin/feature/ai-live-lite
git worktree add ..\viralflow-router origin/codex/google-vids-fal-router
```

worktree ที่อ้าง `origin/...` จะเป็น detached checkpoint ก่อนแก้โค้ดให้สร้าง branch ใหม่ด้วย
`git switch -c <ชื่อใหม่>` หรือ checkout local branch ที่ติดตาม remote อย่างถูกต้อง
ไม่ต้องสร้าง worktree ทุกระบบหากยังไม่ได้ใช้

ใน worktree ที่จะพัฒนา:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

ก่อนทดสอบให้ตั้งค่าฝั่ง local ตาม `.env.example` และเอกสาร branch นั้น ใช้ mock/isolated
configuration และปิด paid generation, posting และ LIVE จริง ไม่ใช้ Production DB เป็นค่าเริ่มต้น
คำสั่งข้างต้นเป็นแนวทาง setup ไม่ใช่ผลรับรองว่าทุกระบบพร้อม Production
สำหรับ build-only placeholders และผลทดสอบเก่าอ่าน `CLAUDE_HANDOFF.md`
ก่อนแก้ Next.js อ่าน `AGENTS.md` และคู่มือ Next ที่ติดตั้งตามข้อกำหนดเดิม

AI LIVE Lite ใช้ Python 3.10 ตาม proof เดิม สร้าง virtual environment ใหม่ และติดตั้ง
`workers/ai-live/requirements-lite.txt` ภายใน environment นั้น ห้ามคัดลอก `.venv-lite`
จากเครื่องเก่าแล้วคาดว่าจะใช้ได้ทันที ต้องตรวจ Windows/CPU/GPU/driver ใหม่
การทำงาน Pro/GPU อ่าน requirements และเอกสารของ branch นั้นแยกกัน

## สิ่งที่ GitHub เก็บให้แล้ว

- source, tests, migrations, dependency manifests/lockfile และเอกสารตาม branch เดิม
- helper source ที่เคยถูก ignore จำนวน 30 รายการใน `handoff/local-source/INDEX.json`
  รวมของเดิม 27 รายการที่ checksum ไม่เปลี่ยน และ helper เพิ่มเติม 3 รายการ
  เก็บเป็น WIP archive พร้อม verifier ไม่ได้นำไปรวม runtime หรือรับรองผลทดสอบใหม่
- รายงานทดลองราคาวิดีโอและ creative review เดิมเพิ่มใน `handoff/migration-20261026/reports/`
  เป็นหลักฐานย้อนหลัง ไม่อนุญาตให้ยิง paid request ใหม่ และไม่ใช่หลักฐานคุณภาพผ่าน
- manifests ของ branch และรายการไฟล์ใหญ่ ไม่ใช่สำเนาไฟล์ใหญ่

## สิ่งที่ต้องย้ายแบบส่วนตัว

สำรวจ primary workspace พบ nontracked files 8,270 ไฟล์ รวม 24,525,754,577 bytes (~24.53 GB)
หลังตัด cache/environment ที่ระบุออก ยังรวม vendor/runtime ที่ติดตั้งใหม่ได้ จึงไม่ใช่ขนาด
ไฟล์เฉพาะตัวที่จำเป็นทั้งหมด และไม่รวม media ภายนอก workspace
รายละเอียดกลุ่มและไฟล์ใหญ่ที่คัดไว้ใน
[`migration/LOCAL_ASSETS_20261026.json`](migration/LOCAL_ASSETS_20261026.json).

ก่อนล้างเครื่อง ให้คัดลอกผ่านไดรฟ์ที่เข้ารหัสหรือพื้นที่ส่วนตัวที่เจ้าของอนุญาต:

1. `.ai-live-dev/`: presenter packs/reference, speech banks, calibration, models,
   Brain/TTS runtime และผล proof โดยเก็บโครงสร้างเดิม
2. `.video-benchmark/`, `.video-cache/`, `benchmark-assets/`: MP4 ต้นฉบับ ผลทดลอง
   และหลักฐานประกอบที่ยังไม่ได้อยู่ Git อย่าถือภาพ fixture เป็นหลักฐานสินค้าจริง
3. `workers/ai-live/installer/.dist/`: installer/runtime ที่ build ไว้ หากต้องการเก็บ
   build เดิม สามารถ rebuild จาก source ได้แต่ไม่ได้ทดสอบ rebuild ในรอบสำรองนี้
4. โฟลเดอร์ visualization ของงาน review:
   `C:/Users/luckz/.codex/visualizations/2026/09/14/01a09f8e-9dfc-7751-a4c3-675012890b7a/`
   โดยเฉพาะ `review-demo-20261025/` และไฟล์หลักฐาน Inbox เดิม
5. MP4 เจ้าของใน Downloads และ raw recording ของ OBS ใน Videos ที่ต้องการเก็บ
   media เหล่านี้อาจมีข้อมูลส่วนตัว จึงไม่อัปโหลด GitHub อัตโนมัติ
6. `.handoff-backup/migration-inventory-20261026.json`: manifest ส่วนตัวพร้อม
   SHA-256 ทุกไฟล์ที่สำรวจ ใช้ตรวจสำเนาหลังย้าย root path ได้

ไฟล์แพ็กหน้าบุคคล เสียง หลักฐาน และโมเดลอาจมีข้อจำกัดสิทธิ์ ห้ามนำขึ้น public/Git LFS
โดยยังไม่ตรวจ license/consent แหล่งดาวน์โหลดและ revision ที่ทราบอยู่ใน manifests เดิม
รายการที่ไม่ทราบยังเป็น UNKNOWN ไม่รับรองว่าดาวน์โหลดทดแทนได้ครบ
raw recording ที่มีข้อมูลบัญชีไม่ใช่สิ่งที่ควรเผยแพร่พร้อม source

## คีย์และการเข้าสู่ระบบ

`.env.local`, API keys, service-role keys, cookies, signing/device secrets และรหัสผ่าน
ไม่อัปโหลด GitHub และไม่ใส่ในเอกสารนี้ ตั้งใหม่บนเครื่องปลายทางผ่านช่องทางส่วนตัว
ใช้ `.env.example` เฉพาะเป็นรายชื่อค่าที่ต้องตั้ง ห้ามส่ง key ในแชต
คีย์ Azure ที่เข้ารหัส Windows DPAPI หรือ identity ของ Local Agent อาจผูกเครื่องเดิม
ต้องตั้งคีย์/ลงทะเบียนเครื่องใหม่ผ่าน flow เดิม ไม่คัดลอก plaintext หรือเปิด bypass
GitHub/Google/TikTok/CLI ต้อง Login ใหม่ตามสิทธิ์เดิม ไม่ย้าย browser cookies

## ขอบเขตผลตรวจรอบนี้

สำรวจ primary repository, registered worktrees อีก 2 แห่ง และ remote refs ที่ fetch มา
worktrees เดิมทั้งสอง clean ไม่มี tracked modifications ค้าง โค้ด primary ไม่มี tracked diff
สิ่ง untracked เดิมเป็น `.handoff-backup/`, Python cache และ `.venv-lite/`
ไม่มีการลบ ย้าย ทับ source เดิม merge deploy เปลี่ยน DB หรือเรียก paid API
ไม่ได้สำรวจทุกโฟลเดอร์ส่วนบุคคลในทุก drive และไม่ได้ยืนยันว่าทุก media มีสิทธิ์เผยแพร่

**พร้อมเริ่มพัฒนาจาก GitHub บนเครื่องใหม่: YES หลังติดตั้ง dependencies และตั้งค่าที่จำเป็น**
**พร้อมล้างเครื่องเก่าโดยไม่มีไฟล์สูญหาย: NO จนกว่าจะย้ายไฟล์ส่วนตัวและตรวจ hash สำเร็จ**

เอกสาร architecture/ข้อจำกัดเดิม: [`CLAUDE_HANDOFF.md`](CLAUDE_HANDOFF.md).
ผลทดสอบในเอกสารเก่าเป็นผลวันที่ระบุ ไม่ใช่ผลรันทดสอบใหม่ในรอบสำรองนี้
