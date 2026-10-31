"use client";

export default function AccountsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="accounts-page"><section className="accounts-empty accounts-error" role="alert"><span className="accounts-empty-icon" aria-hidden="true">!</span><h1>แสดงบัญชีไม่สำเร็จ</h1><p>โปรดลองโหลดอีกครั้ง หากยังพบปัญหา ให้ตรวจสอบการเชื่อมต่อของระบบ</p><button className="accounts-connect" type="button" onClick={reset}>ลองอีกครั้ง</button></section></div>;
}
