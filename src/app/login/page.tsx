import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { loginErrorMessage } from "./auth-flow";
import "./login.css";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-story" aria-label="ViralFlow AI">
          <div className="auth-brand"><span className="auth-brand-mark" aria-hidden="true">V<span>✦</span></span><span>ViralFlow <b>AI</b></span></div>
          <div className="auth-story-main">
            <p className="auth-kicker"><span /> YOUR CONTENT COMMAND CENTER</p>
            <h1>Automate.<br />Publish.<br /><em>Learn. Grow.</em></h1>
            <p className="auth-story-description">ศูนย์ควบคุม AI สำหรับสร้างคอนเทนต์ TikTok ติดตามผล และพัฒนากลยุทธ์ของแต่ละบัญชีในที่เดียว</p>
            <div className="auth-flow-preview" aria-label="กระบวนการทำงาน"><span>IDEA</span><i aria-hidden="true" /><span>CREATE</span><i aria-hidden="true" /><span>PUBLISH</span><i aria-hidden="true" /><span>LEARN</span></div>
          </div>
          <p className="auth-story-foot">CREATE WITH INTENT <span>·</span> GROW WITH EVIDENCE</p>
        </section>
        <section className="auth-panel" aria-labelledby="auth-heading">
          <div className="auth-mobile-brand"><span className="auth-brand-mark" aria-hidden="true">V<span>✦</span></span><span>ViralFlow <b>AI</b></span></div>
          <div className="auth-card">
            <div className="auth-card-accent" aria-hidden="true" />
            <p className="auth-card-kicker">WELCOME BACK</p>
            <h2 id="auth-heading">ยินดีต้อนรับกลับ</h2>
            <p className="auth-card-subtitle">เข้าสู่ระบบเพื่อเปิด Control Center ของคุณ</p>
            <LoginForm initialError={loginErrorMessage(error)} />
            <p className="auth-privacy">เซสชันของคุณจัดการโดย Supabase Auth อย่างปลอดภัย</p>
          </div>
          <p className="auth-panel-foot">ViralFlow AI <span>·</span> Create. Publish. Learn. Grow.</p>
        </section>
      </div>
    </main>
  );
}

