import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";
import { listCreativeProjects } from "@/features/creative/services";
export default async function CreativeStudioPage(){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  const projects=await listCreativeProjects(client,data.user.id);
  return <><PageHeading eyebrow="CREATIVE BRAIN" title="Creative Studio" description="แนวคิดวิดีโอ 8 วินาทีที่สร้างจากบัญชี สินค้า หมวดหมู่ และแผนรายวัน"/>
    {projects.length?<section className="creative-grid">{projects.map(p=><Link className="panel creative-project-card" href={`/creative-studio/${p.id}`} key={p.id}>
      <span className={`mode-badge ${String(p.mode).toLowerCase()}`}>{p.mode}</span><span className="phase-chip">{p.status}</span>
      <h2>{p.product?.title??"สินค้า"}</h2><p>{p.account_name} · {p.product?.category_key}</p><small>อัปเดต {new Date(p.updated_at).toLocaleString("th-TH")}</small>
    </Link>)}</section>:<section className="empty-state"><span>CB</span><h2>ยังไม่มี Creative Project</h2><p>เปิด Recommendations แล้วเลือก CREATE CREATIVE จากสินค้าที่ได้รับมอบหมาย</p><Link className="primary-action" href="/recommendations">ไปที่ Recommendations</Link></section>}
  </>;
}
