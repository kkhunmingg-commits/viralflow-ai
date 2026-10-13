"use client";
import { useEffect,useState,useTransition } from "react";
import Link from "next/link";
import type { GrowthPilotView } from "@/features/growth-manager/contracts";
import { LocalPreparation } from "../../post/local-preparation";
import { enableGrowthPilotAction,prepareGrowthPilotAction,refreshGrowthPilotAction,reportGrowthPostAction } from "./actions";
const value=(n:number|null|undefined,digits=0)=>n===null||n===undefined?"UNKNOWN":n.toLocaleString("th-TH",{maximumFractionDigits:digits});
const actions:Record<string,string>={COLD_START:"เริ่มเรียนรู้",OBSERVE:"เก็บข้อมูล",INCREASE:"เพิ่มทีละน้อย",MAINTAIN:"รักษาจังหวะ",REDUCE:"ลดความถี่",PAUSE:"พักโพสต์",OWNER_REVIEW:"ต้องตรวจบัญชี"};
export function GrowthPilotDashboard({initial}:{initial:GrowthPilotView}){
 const [view,setView]=useState(initial),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState(""),[pending,start]=useTransition();
 useEffect(()=>{let alive=true;const timer=setInterval(()=>{if(document.visibilityState!=="visible")return;start(async()=>{try{const next=await refreshGrowthPilotAction();if(alive)setView(next);}catch{if(alive)setMessage("อัปเดตไม่ได้ กำลังรอข้อมูล");}});},20000);return()=>{alive=false;clearInterval(timer);};},[]);
 function run(task:()=>Promise<GrowthPilotView>){setMessage("");start(async()=>{try{setView(await task());}catch{setMessage("ทำรายการไม่ได้ ตรวจสิทธิ์บัญชีและข้อมูลที่กรอก");}});}
 const d=view.decision,m=d?.metrics;
 return <div className="ma-dashboard gp-dashboard"><header className="ma-heading"><div><p>VIRAL FLOW AI</p><h1>ค่อย ๆ ปั้นช่อง ในจังหวะของคุณ</h1><span>เรียนรู้จากผลลัพธ์จริง • ทุกแผนมีเหตุผล</span></div><Link href="/auto">กลับหน้าหลัก</Link></header>
 {!view.available?<section className="ma-capacity"><h2>เลือกบัญชีทดลองก่อน</h2><p>{view.message}</p><p>เจ้าของระบบต้องเลือกบัญชีใหม่หนึ่งบัญชี ระบบจะไม่ใช้บัญชีขายของเดิมในการทดลอง</p></section>:<>
 <section className="ma-status"><div><strong>{view.name}</strong><p>{view.username?`@${view.username}`:"บัญชีทดลอง"} · {view.active?"กำลังวางแผนทดลอง":"ยังไม่เปิดทดลอง"}</p></div><div className="gp-actions"><button className="ma-primary" disabled={pending||(!view.active&&!confirmed)} onClick={()=>run(()=>enableGrowthPilotAction(!view.active,confirmed))}>{view.active?"พักการทดลอง":"เปิด Pilot"}</button>{view.active&&<button className="ma-primary" disabled={pending} onClick={()=>run(prepareGrowthPilotAction)}>ปรับแผนจากข้อมูลล่าสุด</button>}</div></section>
 {!view.active&&<label className="gp-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> ฉันตรวจบัญชีนี้ใน TikTok แล้วและอนุญาตให้ทดลองเล็กน้อย การเปิด Pilot ยังไม่ส่งโพสต์</label>}
 <section className="ma-capacity" aria-live="polite"><strong>{d?actions[d.action]:"รอข้อมูล"}</strong><p>{view.message}</p><p>ความเชื่อมั่น {d?value(d.confidence*100):"UNKNOWN"}% · {d?.transport==="API_REVIEW"?"รอตรวจและให้ความยินยอมก่อนส่ง":"เตรียมสำหรับโพสต์สาธารณะด้วยตัวเอง"}</p><p>จำนวนทดลองเป็นนโยบายเริ่มเรียนรู้ ไม่ใช่จำนวนที่รับรองว่าปลอดภัยสำหรับทุกบัญชี</p></section>
 <div className="ma-summary">{[["ผู้ติดตามเมื่อเริ่มวัด",m?.startingFollowers],["ผู้ติดตามปัจจุบัน",m?.currentFollowers],["เพิ่มสุทธิ",m?.netFollowers],["Views ต่อคลิป",m?.viewsPerClip],["ผู้ติดตามเพิ่ม / 1,000 Views",m?.followersPer1000Views],["อัตราเปลี่ยนเป็นผู้ติดตาม (%)",m?.followerConversionRate==null?null:m.followerConversionRate*100],["แนะนำวันนี้",d?.recommended],["โพสต์ผ่านระบบแล้ว",m?.publishedToday],["โพสต์เองที่คุณยืนยัน",view.manualReportedToday],["Watch Time เฉลี่ย (วินาที)",m?.averageWatchTime],["Retention (%)",m?.retention==null?null:m.retention*100],["Completion Rate (%)",m?.completionRate==null?null:m.completionRate*100],["Likes",m?.likes],["Comments",m?.comments],["Shares",m?.shares]].map(([label,n])=><div key={String(label)}><span>{label}</span><strong>{value(n as number|null|undefined,1)}</strong></div>)}</div>
 <p>UNKNOWN หมายถึงยังไม่มีข้อมูลหรือสิทธิ์เข้าถึง ผู้ติดตามที่เพิ่มสุทธิจะไม่ถูกอ้างว่าเกิดจากคลิปใดคลิปหนึ่ง</p>
 <section className="gp-plan"><h2>แผนคลิปและเวลาที่ทดลอง</h2><p>การสร้างคลิปยังเป็นแบบ Assisted: เปิด Google Vids สร้างตามแนวทาง แล้วนำ MP4 กลับมาตรวจ ไม่เรียกบริการสำรองแบบเสียเงิน</p>
 {(view.slots??[]).map(slot=><article className="ma-account" key={slot.ordinal}><h3>{slot.topic}</h3><p>{new Intl.DateTimeFormat("th-TH",{dateStyle:"medium",timeStyle:"short"}).format(new Date(slot.at))} · {slot.state==="MANUAL_REPORTED"?"คุณบันทึกว่าโพสต์เองแล้ว":"รอสร้างและตรวจคลิป"}</p><details><summary>แนวทางสร้างคลิป</summary><p>{slot.brief}</p><a href="https://vids.new/" target="_blank" rel="noreferrer">เปิด Google Vids →</a></details>{slot.state!=="MANUAL_REPORTED"&&view.active&&<form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);run(()=>reportGrowthPostAction(slot.ordinal,String(data.get("postUrl"))));}}><label>หลังโพสต์เองแล้ว วางลิงก์คลิป<input name="postUrl" type="url" required placeholder="https://www.tiktok.com/@ชื่อบัญชี/video/..."/></label><button disabled={pending}>บันทึกว่าโพสต์เองแล้ว</button><small>เป็นการยืนยันของคุณ ยังไม่ใช่ผลที่ API ตรวจสอบแล้ว</small></form>}</article>)}
 {!view.slots?.length&&<p>ยังไม่มีช่วงเตรียมคลิปที่ทำได้ รอข้อมูลหรือช่วงเวลาถัดไป</p>}
 </section>
 <section className="gp-topics"><h2>แนวคลิปที่เรียนรู้ได้</h2>{d?.topics.length?d.topics.map(topic=><div key={topic.name}><strong>{topic.name}</strong><span>{topic.posts} คลิป · Views เฉลี่ย {value(topic.viewsPerClip)} · ผู้ติดตาม / 1,000 Views {value(topic.followersPer1000Views,1)}</span></div>):<p>ยังไม่มีผลลัพธ์ที่ผูกกับหัวข้อจริง ห้ามสรุปแนวที่เพิ่มผู้ติดตามแทนข้อมูลที่ยังไม่มี</p>}</section>
 <LocalPreparation accounts={[{name:view.name??"บัญชีทดลอง"}]}/>
 </>}
 {message&&<p role="status">{message}</p>}
 </div>;
}
