import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PageHeading } from "@/components/page-heading";
import { ProductImage,TrendBadge,money,number } from "@/components/product-presentation";
import { ProductSeedForm } from "@/components/product-seed-form";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { getProductRadar } from "@/features/products/services";
const paramsSchema=z.object({
 category:z.string().max(64).optional(),
 minCommission:z.coerce.number().nonnegative().catch(0),
 minConfidence:z.coerce.number().min(0).max(1).catch(0),
 minScore:z.coerce.number().min(0).max(100).catch(0),
 minPrice:z.coerce.number().nonnegative().catch(0),
 maxPrice:z.preprocess(v=>v===""?undefined:v,z.coerce.number().nonnegative().optional()).catch(undefined),
 trend:z.enum(["ACCELERATING","RISING","STABLE","FALLING","LOW_DATA"]).optional().catch(undefined),
 sort:z.enum(["opportunity","momentum","commission","acceleration","units"]).catch("opportunity"),
});
export default async function ProductRadarPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const params=await searchParams;
 const filter=paramsSchema.parse(params);
 const client=await createClient();
 const {data}=await client.auth.getUser();
 if(!data.user) redirect("/login");
 const {items,categories,total}=await getProductRadar(client,data.user.id,filter);
 return <>
  <PageHeading eyebrow="CURRENT OPPORTUNITY" title="Product Radar" description="ค้นหาสินค้าที่กำลังเร่งตัว พร้อมเหตุผลและความมั่นใจของทุกคะแนน" action={process.env.NODE_ENV==="development"&&serverEnv.allowDevMockSeed?<ProductSeedForm/>:undefined}/>
  <section className="panel radar-section"><form className="radar-filters">
   <label>หมวดหมู่<select name="category" defaultValue={filter.category??""}><option value="">ทุกหมวดหมู่</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
   <label>คอมมิชชันขั้นต่ำ (บาท)<input name="minCommission" type="number" min="0" step=".01" defaultValue={filter.minCommission}/></label>
   <label>Confidence ขั้นต่ำ (0–1)<input name="minConfidence" type="number" min="0" max="1" step=".05" defaultValue={filter.minConfidence}/></label>
   <label>Opportunity ขั้นต่ำ<input name="minScore" type="number" min="0" max="100" defaultValue={filter.minScore}/></label>
   <label>ราคาเริ่มต้น<input name="minPrice" type="number" min="0" defaultValue={filter.minPrice}/></label>
   <label>ราคาไม่เกิน<input name="maxPrice" type="number" min="0" defaultValue={filter.maxPrice}/></label>
   <label>แนวโน้ม<select name="trend" defaultValue={filter.trend??""}><option value="">ทั้งหมด</option>{["ACCELERATING","RISING","STABLE","FALLING","LOW_DATA"].map(t=><option key={t}>{t}</option>)}</select></label>
   <label>เรียงจากมากไปน้อย<select name="sort" defaultValue={filter.sort}><option value="opportunity">Viral Opportunity</option><option value="momentum">Product Momentum</option><option value="commission">Commission amount</option><option value="acceleration">Acceleration</option><option value="units">Units sold</option></select></label>
   <div className="form-actions"><button className="primary-action">ใช้ตัวกรอง</button><Link className="secondary-action" href="/product-radar">ล้างค่า</Link></div>
  </form></section>
  <section className="panel"><div className="panel-heading"><div><p className="eyebrow">OPPORTUNITY RADAR</p><h2>{items.length} / {total} สินค้า</h2></div><span className="phase-chip">product-momentum-v1</span></div>
   <p className="muted radar-note">คะแนนประเมินความสดใหม่ขณะเปิดหน้า · คอมมิชชันคิดทั้งเปอร์เซ็นต์และจำนวนเงินจริง · ข้อมูลจำลองระบุแหล่งที่มาในรายละเอียด</p>
   {items.length?<div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>สินค้า</th><th>ราคา / ลด</th><th>คอมมิชชัน</th><th>ยอดสะสม</th><th>Velocity / h</th><th>Acceleration</th><th>Confidence</th><th>Momentum</th><th>Opportunity</th><th>แนวโน้ม</th></tr></thead><tbody>
   {items.map(({product:p,score:s})=><tr key={p.id}>
    <td><Link className="radar-product" href={`/product-radar/${p.id}`}><ProductImage url={p.image_url} title={p.title}/><span><strong>{p.title}</strong><small>{p.category_key} · {p.external_provider}</small></span></Link></td>
    <td>{money(p.current_price)}<small>{p.original_price&&p.original_price>p.current_price?`ลด ${number((1-p.current_price/p.original_price)*100)}%`:"ไม่มีส่วนลด"}</small></td>
    <td>{money(p.commission_amount)}<small>{number(p.commission_rate*100)}%</small></td>
    <td>{number(p.units_sold)}</td><td>{s?number(s.sales_velocity):"—"}</td><td>{s?number(s.sales_acceleration):"—"}</td>
    <td>{s?`${number(s.data_confidence*100)}%`:"—"}</td><td>{s?number(s.product_momentum_score):"—"}</td>
    <td className="opportunity-cell">{s?number(s.viral_opportunity_base_score):"—"}</td><td><TrendBadge trend={s?.explanation_json.trend??"LOW_DATA"}/></td>
   </tr>)}</tbody></table></div>:<div className="large-empty"><span className="empty-orbit">PR</span><h2>{total?"ไม่พบสินค้าตามตัวกรอง":"ยังไม่มีสินค้าใน Radar"}</h2><p>{total?"ปรับตัวกรองเพื่อค้นหาโอกาสเพิ่มเติม":"นำเข้าชุดข้อมูลจำลองจากเครื่อง development เพื่อเริ่มสำรวจคะแนนและประวัติ"}</p></div>}
  </section>
 </>;
}
