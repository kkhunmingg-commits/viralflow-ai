"use client";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
declare global { interface Window { __vfInstallPrompt?: InstallPromptEvent | null } }

type Platform = "standalone" | "ios-safari" | "ios-other" | "android" | "desktop";

/** Where we are decides the install path: Chrome/Edge/Android give a real prompt, iPhone needs Share → Add to Home Screen. */
export function detectPlatform(ua: string, standalone: boolean): Platform {
  if (standalone) return "standalone";
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
  if (ios) return /CriOS|FxiOS|EdgiOS|Line\/|FBAN|FBAV|Instagram|TikTok|musical_ly/i.test(ua) ? "ios-other" : "ios-safari";
  return /Android/i.test(ua) ? "android" : "desktop";
}

function subscribe(onChange: () => void) {
  window.addEventListener("vf-installable", onChange);
  window.addEventListener("vf-installed", onChange);
  return () => { window.removeEventListener("vf-installable", onChange); window.removeEventListener("vf-installed", onChange); };
}
const getPrompt = () => window.__vfInstallPrompt ?? null;
const noPrompt = () => null;
const currentPlatform = () => detectPlatform(navigator.userAgent,
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** "Install app" button: the browser's own prompt when there is one, otherwise step-by-step help for the phone in hand. */
export function InstallAppButton({ className = "install-app-button", label = "ติดตั้งแอปลงมือถือ" }: { className?: string; label?: string }) {
  const prompt = useSyncExternalStore(subscribe, getPrompt, noPrompt);
  const platform = useSyncExternalStore(subscribe, currentPlatform, noPrompt);
  const [help, setHelp] = useState(false);

  if (!platform || platform === "standalone" || (platform === "desktop" && !prompt)) return null;

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") window.__vfInstallPrompt = null;
      window.dispatchEvent(new Event("vf-installable"));
      return;
    }
    setHelp(true);
  }

  return <>
    <button type="button" className={className} onClick={install}><span aria-hidden="true">⤓</span> {label}</button>
    {help && createPortal(<div className="install-sheet-backdrop" role="presentation" onClick={() => setHelp(false)}>
      <div className="install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-sheet-title" onClick={e => e.stopPropagation()}>
        <h2 id="install-sheet-title">ติดตั้ง ViralFlow เป็นแอปบนมือถือ</h2>
        {platform === "ios-safari" && <ol>
          <li>แตะปุ่ม <b>แชร์</b> <span className="install-glyph" aria-hidden="true">⬆︎</span> ที่แถบล่างของ Safari (หรือ ⋯ แล้วเลือกแชร์)</li>
          <li>เลื่อนลงแล้วแตะ <b>เพิ่มไปยังหน้าจอโฮม</b> (Add to Home Screen)</li>
          <li>แตะ <b>เพิ่ม</b> ไอคอน ViralFlow จะอยู่บนหน้าจอเหมือนแอป</li>
        </ol>}
        {platform === "ios-other" && <ol>
          <li>หน้านี้เปิดอยู่ในแอปอื่น (LINE, Facebook, Chrome ฯลฯ) ให้แตะ ⋯ แล้วเลือก <b>เปิดใน Safari</b> หรือคัดลอกลิงก์ไปเปิดใน Safari</li>
          <li>ใน Safari แตะ <b>แชร์</b> <span className="install-glyph" aria-hidden="true">⬆︎</span> แล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b></li>
          <li>แตะ <b>เพิ่ม</b></li>
        </ol>}
        {(platform === "android" || platform === "desktop") && <ol>
          <li>แตะเมนู <b>⋮</b> มุมขวาบนของ Chrome</li>
          <li>เลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b></li>
          <li>ถ้าเปิดอยู่ใน LINE หรือ Facebook ให้เลือก “เปิดในเบราว์เซอร์” (Chrome) ก่อน</li>
        </ol>}
        <p>ไม่ต้องโหลด APK ไม่ต้องผ่าน App Store เปิดจากไอคอนแล้วล็อกอินครั้งเดียว</p>
        <button type="button" className="manual-primary" onClick={() => setHelp(false)}>เข้าใจแล้ว</button>
      </div>
    </div>, document.body)}
  </>;
}
