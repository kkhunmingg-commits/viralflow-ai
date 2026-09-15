"use client";
export default function Error({reset}:{error:Error&{digest?:string};reset:()=>void}){return <section className="panel large-empty"><span className="empty-orbit">!</span><h2>โหลด Category Intelligence ไม่สำเร็จ</h2><button onClick={reset}>ลองใหม่</button></section>}
