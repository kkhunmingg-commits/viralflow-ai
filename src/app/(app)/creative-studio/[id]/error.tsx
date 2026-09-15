"use client";
export default function ErrorView({reset}:{reset:()=>void}){return <section className="panel"><h2>เปิด Creative Project ไม่สำเร็จ</h2><button className="secondary-action" onClick={reset}>ลองใหม่</button></section>;}
