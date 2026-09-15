"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="panel"><h2>โหลดคำแนะนำไม่สำเร็จ</h2><button onClick={reset}>ลองใหม่</button></div>;}
