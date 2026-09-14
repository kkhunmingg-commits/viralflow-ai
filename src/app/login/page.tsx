import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>ViralFlow AI</span>
        </div>
        <div className="story-copy">
          <p className="eyebrow">THAILAND COMMERCE INTELLIGENCE</p>
          <h1>
            ตัดสินใจจากโมเมนตัม
            <br />
            สร้างอย่างมีระบบ
          </h1>
          <p>
            ศูนย์ควบคุมเดียวสำหรับบัญชี สินค้า ครีเอทีฟ ต้นทุน และผลลัพธ์จริง
          </p>
        </div>
        <div className="signal-card">
          <span className="signal-dot" />
          <div>
            <strong>Foundation online</strong>
            <small>Supabase secured · RLS enabled</small>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>เข้าสู่ระบบควบคุม</h2>
          <p className="muted">
            ใช้บัญชีที่ได้รับอนุญาตให้เข้าถึง ViralFlow AI
          </p>
          <LoginForm />
          <p className="login-note">
            การเข้าถึงทั้งหมดถูกแยกตามเจ้าของด้วย Supabase RLS
          </p>
        </div>
      </section>
    </main>
  );
}

