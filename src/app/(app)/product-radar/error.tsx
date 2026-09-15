"use client";
export default function ProductRadarError({reset}:{reset:()=>void}) {
  return <section className="panel"><h1>โหลด Product Radar ไม่สำเร็จ</h1><p>กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง</p><button className="primary-action" onClick={reset}>ลองใหม่</button></section>;
}
