import Link from "next/link";
import type { ReactNode } from "react";
import "./legal.css";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link className="legal-brand" href="/" aria-label="Viral Flow AI — Homepage">
            <span className="legal-brand-mark" aria-hidden="true">V<span>✦</span></span>
            <span>Viral Flow <b>AI</b></span>
          </Link>
          <nav className="legal-nav" aria-label="นโยบายและการเข้าสู่ระบบ">
            <Link href="/product-guide">Product guide</Link>
            <Link href="/support">Contact</Link>
            <Link href="/terms">ข้อกำหนดการใช้บริการ</Link>
            <Link href="/privacy">นโยบายความเป็นส่วนตัว</Link>
            <Link className="legal-login" href="/login">เข้าสู่ระบบ <span aria-hidden="true">↗</span></Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="legal-footer">
        <span>© 2026 Viral Flow AI</span>
        <div><Link href="/">Home</Link><Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Policy</Link><Link href="/review-guide">Reviewer guide</Link></div>
      </footer>
    </div>
  );
}
