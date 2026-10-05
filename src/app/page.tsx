import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ViralFlow AI — Content Automation for Creators",
  description: "รู้จัก ViralFlow AI: เลือกสินค้า เตรียมคอนเทนต์ สร้างวิดีโอ จัดการบัญชี TikTok และเรียนรู้จากผลลัพธ์ในพื้นที่เดียว",
};

const features = [
  { number: "01", title: "Product discovery & selection", name: "เริ่มจากสินค้าที่เหมาะกับคุณ", description: "สำรวจสินค้าและหมวดหมู่ เปรียบเทียบโอกาส และเลือกสินค้าที่สอดคล้องกับแนวทางของแต่ละบัญชี" },
  { number: "02", title: "AI content automation", name: "เปลี่ยนไอเดียเป็นเนื้อหา", description: "เตรียมแนวคิด บทพูด และข้อความสำหรับคลิป เลือก ปรับแก้ และตรวจเนื้อหาก่อนนำไปใช้งาน" },
  { number: "03", title: "AI video creation", name: "สร้างวิดีโอจากสินค้า", description: "ใช้รูปสินค้าและเนื้อหาที่เลือกเพื่อเตรียมวิดีโอ ดูตัวอย่าง ตรวจคุณภาพ และอนุมัติคลิปก่อนเผยแพร่" },
  { number: "04", title: "TikTok account workflow", name: "หลายบัญชี ในพื้นที่เดียว", description: "เชื่อมบัญชี TikTok ผ่านหน้าการอนุญาตของ TikTok เลือกบัญชีสำหรับแต่ละงาน และยกเลิกการเชื่อมต่อได้" },
  { number: "05", title: "Publishing workflow", name: "ควบคุมก่อนเผยแพร่", description: "ตรวจวิดีโอและรายละเอียดการโพสต์ก่อนส่งงาน ติดตามสถานะการเผยแพร่ตามสิทธิ์ที่บัญชีและแอปได้รับ" },
  { number: "06", title: "Analytics & learning", name: "เรียนรู้จากผลลัพธ์จริง", description: "ติดตามผลของคอนเทนต์เมื่อมีข้อมูล ดูสิ่งที่ทำงานได้ดี และใช้ผลลัพธ์ประกอบการวางแผนคอนเทนต์ถัดไป" },
];
const steps = ["เลือกบัญชีและสินค้า", "เตรียมเนื้อหา", "สร้างวิดีโอ", "ตรวจและอนุมัติ", "ติดตามการเผยแพร่", "เรียนรู้จากผลลัพธ์"];
const modes = [
  { title: "AUTO", text: "จัดการลำดับงานตามบัญชี เป้าหมาย และงบที่ตั้งไว้ หยุดงานได้เมื่อคุณต้องการ" },
  { title: "GROWTH", text: "วางแนวทางคอนเทนต์เพื่อพัฒนาบัญชี และเรียนรู้จากผลของงานก่อนหน้า" },
  { title: "AFFILIATE", text: "เตรียมคอนเทนต์แนะนำสินค้าที่เหมาะกับบัญชีของคุณ โดยตรวจข้อความและคลิปก่อนใช้งาน" },
];
const questions = [
  { question: "ต้องเชื่อม TikTok อย่างไร?", answer: "หลังเข้าสู่ระบบ เปิด Accounts แล้วเลือกเชื่อม TikTok ระบบจะพาไปยังหน้าการอนุญาตของ TikTok ก่อนกลับมาที่ ViralFlow" },
  { question: "ระบบโพสต์ทันทีที่เชื่อมบัญชีหรือไม่?", answer: "การเชื่อมบัญชีไม่ใช่การสั่งโพสต์ คุณต้องเตรียมงาน ตรวจรายละเอียด และอนุญาตการเผยแพร่ตามสิทธิ์ที่ใช้งานได้" },
  { question: "ดูแลข้อมูลและสิทธิ์ของฉันอย่างไร?", answer: "คุณยกเลิกการเชื่อมบัญชีได้ อ่านรายละเอียดการใช้ข้อมูลและเงื่อนไขบริการได้จาก Privacy Policy และ Terms of Service ด้านล่าง" },
];
const action = "inline-flex min-h-12 items-center justify-center rounded-xl px-6 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0b0d14] text-[#eef0fa] selection:bg-violet-500/40" style={{ backgroundImage: "radial-gradient(ellipse at 80% 0%,rgba(111,76,214,.15),transparent 40%)" }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-lg focus:bg-[#242036] focus:p-4">ข้ามไปยังเนื้อหา</a>
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link href="/" aria-label="ViralFlow AI Homepage" className="flex items-center gap-3 text-lg font-bold tracking-tight"><span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-xl text-white">V</span><span>ViralFlow <span className="text-violet-300">AI</span></span></Link>
          <nav aria-label="เมนูเว็บไซต์" className="flex flex-wrap items-center gap-5 text-sm text-slate-300">
            <a className="hidden hover:text-white sm:block" href="#features">ฟังก์ชัน</a><a className="hidden hover:text-white sm:block" href="#workflow">การใช้งาน</a><a className="hidden hover:text-white sm:block" href="#ai-live">AI LIVE</a>
            <Link href="/login" className={`${action} border border-white/15 bg-white/5 hover:bg-white/10`}>Login</Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-6">
        <section className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.2fr_1fr]" aria-labelledby="home-title">
          <div>
            <p className="mb-5 text-xs font-bold tracking-[.16em] text-violet-300">CONTENT AUTOMATION FOR CREATORS</p>
            <h1 id="home-title" className="m-0 text-4xl leading-[1.3] font-bold tracking-tight sm:text-5xl">จากไอเดียสินค้า<br /><span className="bg-gradient-to-r from-violet-300 to-blue-300 bg-clip-text text-transparent">สู่คอนเทนต์ที่พร้อมเผยแพร่</span></h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300">ViralFlow AI รวมการเลือกสินค้า เตรียมเนื้อหา สร้างวิดีโอ และจัดการงานของบัญชี TikTok ไว้ในพื้นที่เดียว สำหรับครีเอเตอร์และผู้ทำคอนเทนต์ Affiliate ที่ต้องการทำงานอย่างเป็นระบบ</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link href="/login" className={`${action} bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500`}>Get Started <span aria-hidden="true" className="ml-3">→</span></Link><a href="#workflow" className={`${action} border border-white/15 hover:bg-white/5`}>ดูวิธีการทำงาน</a></div>
            <p className="mt-5 text-sm leading-6 text-slate-400">คุณเลือกบัญชี ควบคุมงบ และตรวจคอนเทนต์ก่อนเผยแพร่</p>
          </div>
          <aside className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#232333] to-[#131620] p-7 sm:p-9" aria-label="พื้นที่ทำงานของ ViralFlow">
            <p className="m-0 text-xs font-semibold tracking-[.15em] text-teal-300">ONE CONNECTED WORKSPACE</p><h2 className="mt-4 text-2xl font-semibold">ทุกขั้นตอน เชื่อมถึงกัน</h2><p className="mt-3 text-sm leading-7 text-slate-400">จากสินค้าและไอเดีย ไปจนถึงคลิปและผลลัพธ์ โดยคุณยังเป็นผู้ควบคุม</p>
            <ol className="mt-7 grid gap-3">{["สินค้าและบัญชีของคุณ", "เนื้อหาและวิดีโอที่ตรวจได้", "การเผยแพร่และผลลัพธ์"].map((label, index) => <li key={label} className="flex items-center gap-4 rounded-xl border border-white/7 bg-white/3 p-4"><span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-sm text-violet-200">{index + 1}</span><span className="text-sm">{label}</span></li>)}</ol>
          </aside>
        </section>
        <section id="features" className="scroll-mt-6 border-t border-white/8 py-16" aria-labelledby="features-title">
          <p className="text-xs font-bold tracking-[.15em] text-violet-300">WHAT YOU CAN DO</p><h2 id="features-title" className="mt-3 text-3xl font-semibold tracking-tight">เครื่องมือสำหรับวงจรคอนเทนต์ของคุณ</h2>
          <div className="mt-9 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">{features.map(feature => <article key={feature.number} className="border-t border-white/10 pt-6"><span className="text-xs text-violet-300">{feature.number} / {feature.title}</span><h3 className="mt-3 text-xl font-semibold">{feature.name}</h3><p className="mt-3 text-sm leading-7 text-slate-400">{feature.description}</p></article>)}</div>
        </section>
        <section id="workflow" className="scroll-mt-6 border-t border-white/8 py-16" aria-labelledby="workflow-title">
          <p className="text-xs font-bold tracking-[.15em] text-teal-300">YOUR WORKFLOW</p><h2 id="workflow-title" className="mt-3 text-3xl font-semibold tracking-tight">เริ่มต้นอย่างไร</h2><p className="mt-4 max-w-2xl leading-8 text-slate-400">เข้าสู่ระบบ เชื่อมบัญชีที่คุณเป็นเจ้าของ แล้วเลือกสินค้าและแนวทางคอนเทนต์ ติดตามงานและสิ่งที่ต้องดำเนินการจากหน้าหลัก</p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{steps.map((step, index) => <li key={step} className="flex items-center gap-4 rounded-xl bg-white/4 p-5"><span className="text-lg font-semibold text-teal-300">{String(index + 1).padStart(2, "0")}</span><span className="text-sm font-medium">{step}</span></li>)}</ol>
          <div className="mt-9 grid gap-6 rounded-2xl border border-white/10 p-6 sm:p-8 md:grid-cols-3">{modes.map(mode => <article key={mode.title}><h3 className="text-sm font-bold text-violet-300">{mode.title}</h3><p className="mt-3 text-sm leading-7 text-slate-400">{mode.text}</p></article>)}</div>
        </section>
        <section className="grid gap-8 border-t border-white/8 py-16 md:grid-cols-2" aria-labelledby="control-title">
          <div><p className="text-xs font-bold tracking-[.15em] text-violet-300">YOU STAY IN CONTROL</p><h2 id="control-title" className="mt-3 text-3xl font-semibold">บัญชีและเนื้อหา<br />อยู่ภายใต้การอนุญาตของคุณ</h2></div>
          <div className="space-y-4 text-sm leading-7 text-slate-300"><p>การเชื่อม TikTok เริ่มผ่านหน้าการอนุญาตของ TikTok คุณเลือกบัญชีที่จะใช้งาน และยกเลิกการเชื่อมต่อจาก ViralFlow ได้</p><p>การเผยแพร่ขึ้นอยู่กับสิทธิ์ของบัญชี การอนุมัติแอป และข้อกำหนดของ TikTok ไม่ใช่ทุกบัญชีจะเผยแพร่สาธารณะได้ทันที ระบบแสดงเมื่อมีสิ่งที่คุณต้องดำเนินการก่อนทำงานต่อ</p><p>ข้อมูลผลลัพธ์จะแสดงเมื่อมีข้อมูลจริง ViralFlow ไม่รับประกันยอดเข้าชม รายได้ หรือยอดขาย</p></div>
        </section>
        <section id="ai-live" className="scroll-mt-6 rounded-3xl border border-violet-400/15 bg-violet-500/5 p-7 sm:p-10" aria-labelledby="live-title">
          <p className="text-xs font-bold tracking-[.15em] text-violet-300">AI LIVE · IN DEVELOPMENT</p><h2 id="live-title" className="mt-4 text-3xl font-semibold">อีกพื้นที่สำหรับการนำเสนอสินค้า</h2><p className="mt-4 max-w-3xl leading-8 text-slate-300">AI LIVE เป็นโมดูลที่กำลังพัฒนาภายใน ViralFlow สำหรับการนำเสนอสินค้าโดยผู้นำเสนอเสมือน ใช้บัญชีและสินค้าร่วมกับพื้นที่คอนเทนต์เดิม</p><p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">ยังไม่เปิดให้ไลฟ์บน TikTok ใน production การเปิดใช้งานจะขึ้นอยู่กับความพร้อมของเครื่องและช่องทางเชื่อมต่อที่ได้รับอนุญาตอย่างเป็นทางการ</p>
        </section>
        <section className="py-16" aria-labelledby="faq-title">
          <h2 id="faq-title" className="text-2xl font-semibold">คำถามก่อนเริ่มใช้งาน</h2><div className="mt-6 divide-y divide-white/10">{questions.map(item => <details key={item.question} className="py-5"><summary className="cursor-pointer text-base font-medium focus-visible:outline-2 focus-visible:outline-violet-300">{item.question}</summary><p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">{item.answer}</p></details>)}</div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-white/4 p-7"><div><h2 className="text-xl font-semibold">เริ่มจัดการคอนเทนต์ในพื้นที่เดียว</h2><p className="mt-2 text-sm text-slate-400">เข้าสู่ระบบเพื่อเปิดพื้นที่ทำงานของคุณ</p></div><Link href="/login" className={`${action} bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500`}>Get Started →</Link></div>
        </section>
      </main>
      <footer className="border-t border-white/8"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-5 px-6 py-8 text-sm text-slate-400 sm:flex-row"><span>ViralFlow AI · Content, connected.</span><nav aria-label="นโยบายและเงื่อนไข" className="flex flex-wrap gap-6"><Link className="hover:text-white" href="/privacy">Privacy Policy</Link><Link className="hover:text-white" href="/terms">Terms of Service</Link><Link className="hover:text-white" href="/login">Login</Link></nav></div></footer>
    </div>
  );
}

