import Link from "next/link";
import {redirect} from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import {createClient} from "@/lib/supabase/server";
import {listVideoFactory} from "@/features/video/services";
const money=(n:number|string)=>new Intl.NumberFormat("th-TH",{style:"currency",currency:"USD",minimumFractionDigits:4}).format(Number(n));
export default async function VideoFactoryPage(){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  const masters=await listVideoFactory(client,data.user.id);
  return <><PageHeading eyebrow="MASTER → VARIATIONS" title="Video Factory" description="วิดีโอ commerce แนวตั้ง 8 วินาทีจาก Creative Brain ด้วยเส้นทางต้นทุนต่ำสุด"/>
    {masters.length?<section className="video-factory-grid">{masters.map(master=><Link className="panel video-master-card" href={`/video-factory/${master.id}`} key={master.id}>
      <div className="panel-heading"><div><span className="phase-chip">{master.render_strategy}</span><h2>{master.product_title}</h2></div><span className={`quality-badge ${String(master.quality_status).toLowerCase()}`}>{master.quality_status??"PENDING"}</span></div>
      <p>{master.account_name} · {master.width}×{master.height} · {Number(master.duration_seconds).toFixed(2)}s · {Number(master.fps).toFixed(0)}fps</p>
      <dl className="video-card-stats"><div><dt>Quality</dt><dd>{master.quality_score??"—"}</dd></div><div><dt>Cost</dt><dd>{money(master.estimated_cost_usd)}</dd></div><div><dt>Variations</dt><dd>{master.variations.length}</dd></div><div><dt>Status</dt><dd>{master.status}</dd></div></dl>
    </Link>)}</section>:<section className="empty-state"><span>VF</span><h2>ยังไม่มี Master Video</h2><p>เลือกแนวคิดใน Creative Studio แล้วกด CREATE VIDEO เพื่อสร้าง MP4 ด้วย FFmpeg</p><Link className="primary-action" href="/creative-studio">ไปที่ Creative Studio</Link></section>}
  </>;
}

