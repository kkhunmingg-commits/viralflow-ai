"use client";

export function CustomerLoadError({ reset }: { reset: () => void }) {
  return <div className="customer-center"><section className="customer-empty" role="alert">
    <h2>ยังโหลดข้อมูลไม่ได้</h2><p>ข้อมูลของคุณยังอยู่ตามเดิม กรุณาลองเปิดหน้านี้อีกครั้ง</p>
    <button type="button" className="customer-primary-button" onClick={reset}>ลองอีกครั้ง</button>
  </section></div>;
}

export function CustomerLoading() {
  return <div className="customer-center" role="status" aria-live="polite"><section className="customer-overview customer-loading">
    <span className="customer-loading-dot" aria-hidden="true" /><h2>กำลังโหลดผลงานของคุณ…</h2>
    <p className="customer-data-note">กำลังอ่านสถานะล่าสุดของบัญชี</p>
  </section></div>;
}
