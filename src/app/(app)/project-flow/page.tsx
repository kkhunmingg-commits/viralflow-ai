import type {Metadata} from "next";
import {PageHeading} from "@/components/page-heading";

export const metadata:Metadata={title:"แผนผังการทำงาน"};

type Status="DONE"|"PARTIAL"|"PLANNED";
type Step={id:string;title:string;owner:string;status:Status;purpose:string;effect:string;next:string};

const steps:Step[]=[
  {id:"01",title:"START / เจ้าของเริ่ม Auto run",owner:"Auto Mode",status:"DONE",purpose:"รับคำสั่ง START สร้าง durable run และ idempotency key",effect:"ป้องกันการเริ่มงานซ้ำและกำหนดขอบเขตบัญชี งบ และวันที่",next:"ตรวจตัวตนและโหลดสถานะบัญชี"},
  {id:"02",title:"ยืนยันตัวตนและแยกข้อมูลเจ้าของ",owner:"Supabase Auth + RLS",status:"DONE",purpose:"ยืนยัน session และบังคับ owner isolation ทุกตาราง",effect:"ข้อมูล บัญชี สื่อ ต้นทุน และผลวิเคราะห์ของคนอื่นเข้าถึงไม่ได้",next:"โหลด Account Brain"},
  {id:"03",title:"ตัดสินโหมดบัญชี",owner:"Multi-Account Brain",status:"DONE",purpose:"แปลงโหมดที่ขอเป็น GROWTH หรือ AFFILIATE ตามสิทธิ์จริง",effect:"บัญชีที่ยังไม่มี Shop/cart permission จะ fallback เป็น GROWTH",next:"ดึงข้อมูลสินค้า หมวดหมู่ และ performance"},
  {id:"04",title:"รวบรวมสัญญาณตลาด",owner:"Product Radar + Category Intelligence",status:"PARTIAL",purpose:"รวม snapshot สินค้า momentum หมวดหมู่ ความสด และ confidence",effect:"สร้าง candidate pool ที่จัดอันดับได้โดยไม่แต่งข้อมูลที่ไม่มี",next:"คำนวณความเหมาะสมต่อบัญชี"},
  {id:"05",title:"ให้คะแนนและกระจายสินค้า",owner:"Assignment Brain",status:"DONE",purpose:"คำนวณ Growth/Affiliate fit และ Final Viral Opportunity",effect:"เลือกสินค้าที่เหมาะกับแต่ละบัญชีและลดการใช้ top product ซ้ำข้ามบัญชี",next:"สร้าง creative brief"},
  {id:"06",title:"สร้างแนวคิดและสคริปต์ 8 วินาที",owner:"Creative Brain",status:"DONE",purpose:"สร้าง hook, angle, CTA, scene plan และ timing ตามโหมดบัญชี",effect:"ได้แนวคิดที่เลือก แก้ ปฏิเสธ และ regenerate ได้ พร้อม risk/cost metadata",next:"ส่ง timeline ไป Video Factory"},
  {id:"07",title:"เลือก video provider และตรวจงบ",owner:"CostRouter",status:"PARTIAL",purpose:"เลือก provider จากหลักฐานคุณภาพ ความเสถียร และ accepted-output cost",effect:"ถ้าไม่มี key หรือหลักฐานจะ WAITING_FOR_PROVIDER; ถ้างบไม่พอจะ WAIT_FOR_BUDGET",next:"สร้าง master video หรือหยุดอย่างปลอดภัย"},
  {id:"08",title:"สร้าง master และ variations",owner:"Video Factory",status:"DONE",purpose:"สร้าง master หนึ่งชุดและ variation ผ่าน FFmpeg โดยเก็บสื่อแบบ private",effect:"ลดต้นทุนต่อ final clip และบันทึก provider/model/cost/idempotency",next:"ตรวจคุณภาพทางเทคนิค"},
  {id:"09",title:"Quality Gate",owner:"Video Quality",status:"DONE",purpose:"ตรวจ 8 วินาที 9:16 codec resolution fps และไฟล์เสีย",effect:"PASS เดินหน้าต่อ; RETRY/REJECT กลับไปสร้างใหม่ตามขอบเขตที่กำหนด",next:"ตรวจ compliance และ originality"},
  {id:"10",title:"Compliance + Product Truth + Originality",owner:"Safety Gate",status:"PARTIAL",purpose:"ตรวจ claim, AIGC disclosure, ความตรงกับสินค้า และความซ้ำข้ามบัญชี",effect:"ป้องกันข้อมูลเท็จ งานซ้ำ และการข้าม disclosure ก่อนเผยแพร่",next:"ตรวจ commerce readiness หรือ Growth eligibility"},
  {id:"11",title:"ตรวจสิทธิ์ Affiliate",owner:"TikTok Shop Commerce",status:"PARTIAL",purpose:"ยืนยัน Shop creator, ecommerce, cart, region, product และ attachment readiness",effect:"ผ่านจึงใช้ Affiliate CTA ได้; ไม่ผ่านกลับ GROWTH และห้ามอ้างตะกร้า/ร้านค้า",next:"ตรวจ consent สุขภาพบัญชี และโควตา"},
  {id:"12",title:"Pre-publish Gate",owner:"Publishing Safety",status:"DONE",purpose:"ตรวจ owner consent, account health, daily cap และ publish capacity",effect:"พร้อมจึงเข้า queue; เต็มโควตาไปวันถัดไป; ไม่มี consent หยุดรออนุมัติ",next:"สร้าง queue item แบบ idempotent"},
  {id:"13",title:"จัดคิวและส่งงาน",owner:"Publishing Queue",status:"PARTIAL",purpose:"แยก Draft upload กับ Direct Post พร้อม retry/status/webhook ledger",effect:"สถานะย้อนหลังตรวจสอบได้และไม่ส่งซ้ำเมื่อ resume",next:"เรียก TikTok official API เมื่อเปิด real mode"},
  {id:"14",title:"เผยแพร่บน TikTok",owner:"TikTok Content Posting",status:"PLANNED",purpose:"ส่งไฟล์หรือ pull URL และติดตาม publish status จริง",effect:"สร้างโพสต์จริงหลัง app approval, audit, scopes และ explicit enablement เท่านั้น",next:"รอข้อมูล performance"},
  {id:"15",title:"รับ Analytics และ Conversion",owner:"Analytics Engine",status:"PARTIAL",purpose:"เก็บ views, retention, engagement, follows, orders, GMV และ commission แบบ append-only",effect:"แยก UNKNOWN ออกจากศูนย์และรองรับ delayed affiliate attribution",next:"ตัดสิน STOP / WATCH / SCALE"},
  {id:"16",title:"ตรวจหา Winner",owner:"Winner Detection",status:"DONE",purpose:"เทียบกับ baseline ของบัญชีเดียวกันด้วย confidence และ freshness",effect:"ผลิตคำตัดสินที่อธิบายได้และไม่ใช้ shortcut ข้ามบัญชี",next:"ป้อน Learning Loop"},
  {id:"17",title:"เรียนรู้และวางการทดลอง",owner:"Growth Learning Engine",status:"DONE",purpose:"เรียนรู้ category, hook, angle, scene, CTA, template และเวลาที่ชนะ",effect:"สร้าง one-axis experiment และ explore/exploit plan โดยยังผ่าน originality gate",next:"ส่ง recommendation กลับ Creative/Assignment"},
  {id:"18",title:"Checkpoint และสิ้นสุดรอบ",owner:"Auto Orchestration",status:"DONE",purpose:"บันทึก action, failure, cost และ checkpoint ก่อน COMPLETED/PAUSED/BLOCKED",effect:"resume ได้จากจุดปลอดภัย ไม่สร้างหรือเผยแพร่ซ้ำ และเริ่มรอบใหม่จากหลักฐานล่าสุด",next:"END หรือวนรอบใหม่ตาม schedule"},
];

const phaseRows=[
  ["0-6","Foundation → Video Factory","DONE","Auth, brains, creative, FFmpeg, storage, RLS และ cost ledger"],
  ["6B","Real video benchmark","PARTIAL","assets 3 หมวดพร้อม; ยังขาด Google key, paid evidence และ Flow reference"],
  ["6C","Compliance/originality","PARTIAL","engine พร้อม; authenticated browser signoff ยังเปิด"],
  ["7A","TikTok OAuth","PARTIAL","official adapter พร้อม; production app/scopes/audit ยังขาด"],
  ["7B","Publishing","PARTIAL","queue และ official contract พร้อม; real mode ยังปิด"],
  ["7C","TikTok Shop","PARTIAL","readiness gates พร้อม; real Shop/attachment ยังขาด"],
  ["8","Analytics","PARTIAL","scoring และ UI พร้อม; real provider scopes ยังขาด"],
  ["9","Growth Engine","DONE","learning, experiments, milestones และ simulation พร้อม"],
  ["10","Auto Mode","PARTIAL","orchestration พร้อม; external execution ยัง mock/local"],
  ["11","Production review","PLANNED","security, load, observability, backup และ release gate"],
] as const;

const statusThai:Record<Status,string>={DONE:"เสร็จแล้ว",PARTIAL:"ทำแล้วบางส่วน",PLANNED:"ยังไม่เริ่ม"};

export default function ProjectFlowPage(){
  return <>
    <PageHeading eyebrow="SYSTEM MAP · UPDATED 18 SEP 2026" title="แผนผังการทำงาน ViralFlow AI" description="ตั้งแต่เจ้าของกดเริ่ม ผ่านทุก brain, safety gate, publishing และ learning loop จนจบรอบ พร้อมสถานะจาก repository ปัจจุบัน" action={<a className="primary-action flow-download" href="/downloads/viralflow-project-flow-th.pdf" download>ดาวน์โหลด PDF ↓</a>}/>
    <section className="flow-summary" aria-label="ความคืบหน้าโครงการ">
      <article><span>Overall</span><strong>80%</strong><meter min="0" max="100" value="80">80%</meter><small>coding 60% + production 40%</small></article>
      <article><span>Coding completion</span><strong>96%</strong><meter min="0" max="100" value="96">96%</meter><small>143 จาก 149 engineering points</small></article>
      <article><span>Production readiness</span><strong>56%</strong><meter min="0" max="100" value="56">56%</meter><small>external APIs และ operations ยังไม่พร้อม</small></article>
      <article><span>Automated verification</span><strong>226/226</strong><meter min="0" max="226" value="226">226/226</meter><small>typecheck, lint และ build ผ่าน</small></article>
    </section>

    <section className="panel flow-overview">
      <div className="panel-heading"><div><p className="eyebrow">MASTER FLOW</p><h2>เส้นทางหลักและวงจรเรียนรู้</h2></div><div className="flow-legend"><span className="done">DONE</span><span className="partial">PARTIAL</span><span className="planned">PLANNED</span></div></div>
      <div className="flow-lanes" aria-label="ภาพรวมขั้นตอน">
        {["START","AUTH + MODE","RADAR + SCORE","CREATIVE","VIDEO","SAFETY","QUEUE","TIKTOK","ANALYTICS","LEARN","END / LOOP"].map((label,index)=><div key={label}><span>{String(index+1).padStart(2,"0")}</span><strong>{label}</strong>{index<10?<b aria-hidden="true">→</b>:null}</div>)}
      </div>
      <div className="flow-branch-grid">
        <article><p className="eyebrow">GROWTH</p><h3>สร้าง follower และ engagement</h3><p>ใช้สินค้าและหมวดหมู่เป็นวัตถุดิบ แต่ CTA มุ่ง follow/save/comment เมื่อ Shop ยังไม่พร้อม</p></article>
        <article><p className="eyebrow">AFFILIATE</p><h3>เน้น conversion ภายใต้ product truth</h3><p>ทำงานเมื่อสิทธิ์ Shop, cart, product, region และ attachment ผ่านครบเท่านั้น</p></article>
        <article><p className="eyebrow">AUTO</p><h3>ควบคุมวงจรด้วย checkpoint</h3><p>จัดงบ โควตา retry consent และ resume โดยไม่มีทางข้าม safety gate</p></article>
      </div>
    </section>

    <section className="flow-step-list" aria-label="รายละเอียดทุกขั้นตอน">
      {steps.map((step,index)=><article className="flow-step" key={step.id}>
        <div className="flow-step-index"><span>{step.id}</span>{index<steps.length-1?<i/>:null}</div>
        <div className="flow-step-card">
          <header><div><p>{step.owner}</p><h2>{step.title}</h2></div><span className={"flow-status "+step.status.toLowerCase()}>{statusThai[step.status]}</span></header>
          <div className="flow-step-copy"><div><strong>หน้าที่</strong><p>{step.purpose}</p></div><div><strong>ผลที่เกิดขึ้น</strong><p>{step.effect}</p></div><div><strong>เชื่อมไปขั้นถัดไป</strong><p>{step.next}</p></div></div>
        </div>
      </article>)}
    </section>

    <section className="panel flow-phase-panel">
      <div className="panel-heading"><div><p className="eyebrow">DELIVERY STATUS</p><h2>ส่วนที่เสร็จและส่วนที่ยังเหลือ</h2></div><span className="phase-chip">SOURCE: CURRENT REPOSITORY</span></div>
      <div className="flow-phase-table">{phaseRows.map(row=><div key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><b className={"flow-status "+row[2].toLowerCase()}>{row[2]}</b><p>{row[3]}</p></div>)}</div>
    </section>

    <section className="flow-final-grid">
      <article className="panel"><p className="eyebrow">DONE NOW</p><h2>สิ่งที่พร้อมแล้ว</h2><ul><li>14 migrations บน Supabase และ public tables 59 ตารางเปิด RLS</li><li>Product, Category, Assignment, Creative, Video และ Growth engines</li><li>FFmpeg master/variation, quality, compliance, cost และ idempotency</li><li>Auto Mode durable runs, budgets, retries, consent และ checkpoints</li><li>Google Veo adapter และ Stage B assets/dry-run 3 หมวด</li></ul></article>
      <article className="panel"><p className="eyebrow">REMAINING</p><h2>สิ่งที่ต้องทำต่อ</h2><ol><li>ใส่ Google API key และรัน capped Veo Stage B benchmark</li><li>เพิ่ม owner Flow reference เพื่อทำ human comparison</li><li>รับ TikTok app, publishing, Shop และ Analytics approvals</li><li>เปิด real integrations ทีละส่วนพร้อม sandbox evidence</li><li>ทำ Phase 11 security, performance, monitoring และ release review</li></ol></article>
    </section>
  </>;
}
