import Link from "next/link";
import { notFound,redirect } from "next/navigation";
import { z } from "zod";
import { PageHeading } from "@/components/page-heading";
import { ProductImage,TrendBadge,money,number } from "@/components/product-presentation";
import { createClient } from "@/lib/supabase/server";
import { getProductDetail } from "@/features/products/services";
import { getCategorySignals } from "@/features/categories/services";
import { CategoryStateBadge } from "@/components/category-presentation";
export default async function ProductDetailPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!z.uuid().safeParse(id).success) notFound();
  const client=await createClient();
  const {data}=await client.auth.getUser();
  if(!data.user) redirect("/login");
  const [result,categorySignals]=await Promise.all([getProductDetail(client,data.user.id,id),getCategorySignals(client,data.user.id)]);
  if(!result) notFound();
  const {product:p,score:s,snapshots,scores}=result;
  const category=categorySignals.get(p.category_key);
  return <>
    <PageHeading eyebrow="PRODUCT INTELLIGENCE" title={p.title} description={`${p.category_key} · ${p.external_provider} · ${p.currency}`} action={<Link className="secondary-action" href="/product-radar">← กลับ Radar</Link>} />
    <section className="panel product-detail-summary">
      <ProductImage url={p.image_url} title={p.title}/>
      <div><p className="eyebrow">CURRENT OFFER</p><h2>{money(p.current_price)}</h2>
        <p>คอมมิชชัน {number(p.commission_rate*100)}% · {money(p.commission_amount)} ต่อชิ้น</p>
        <p>ยอดสะสม {number(p.units_sold)} · คะแนนรีวิว {p.rating??"—"} / 5 ({number(p.review_count)} รีวิว)</p>
        <p>สถานะ {p.status} · ข้อมูลล่าสุด {new Date(p.last_seen_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p>
        <p>Category {category?<><CategoryStateBadge state={category.state}/> · Momentum {number(category.momentum)}</>:"ยังไม่มีคะแนนหมวดหมู่"}</p>
        {p.product_url?<a className="account-detail-link" href={p.product_url} target="_blank" rel="noopener noreferrer">เปิดหน้าสินค้า ↗</a>:null}
      </div>
      <div className="product-score-large"><strong>{s?number(s.viral_opportunity_base_score):"—"}</strong><span>Viral Opportunity / 100</span>{s?<TrendBadge trend={s.explanation_json.trend}/>:null}</div>
    </section>
    {s?<><section className="stats-grid">
      <article className="stat-card blue"><p>Momentum</p><strong>{number(s.product_momentum_score)}</strong><small>คะแนน 0–100</small></article>
      <article className="stat-card green"><p>Velocity</p><strong>{number(s.sales_velocity)}</strong><small>หน่วยต่อชั่วโมง</small></article>
      <article className="stat-card violet"><p>Acceleration</p><strong>{number(s.sales_acceleration)}</strong><small>อัตราเร่งที่ปรับฐานแล้ว</small></article>
      <article className="stat-card amber"><p>Data confidence</p><strong>{number(s.data_confidence*100)}%</strong><small>ข้อมูลอายุ {number(s.explanation_json.staleHours)} ชั่วโมง</small></article>
    </section>
    <section className="panel radar-section"><div className="panel-heading"><h2>ที่มาของคะแนน</h2><span className="phase-chip">{s.score_version}</span></div>
      <p className="muted">คำนวณความสดใหม่ขณะเปิดหน้า · ประวัติ {number(s.explanation_json.historyHours)} ชั่วโมง · ยอดเพิ่ม {number(s.explanation_json.salesDelta)} หน่วย</p>
      <div className="score-breakdown">{Object.entries(s.explanation_json.signals).map(([key,signal])=><article key={key}><div><strong>{key}</strong><b>{number(signal.score)}</b></div><meter min={0} max={100} value={signal.score} aria-label={key}/><p>{signal.reason}</p></article>)}</div>
      <p className="muted">Rating confidence: {number(s.review_confidence*100)}% · Velocity 1h / 6h / 24h: {Object.values(s.explanation_json.velocities).map(v=>v===null?"ข้อมูลไม่พอ":number(v)).join(" / ")}</p>
      <details><summary>ดูคำอธิบายแบบ JSON</summary><pre className="explanation-json">{JSON.stringify(s.explanation_json,null,2)}</pre></details>
    </section></>:null}
    <section className="panel radar-section"><h2>Snapshot และประวัติความเร็วขาย</h2><div className="radar-table-wrap"><table className="radar-table"><thead><tr><th>เวลาบันทึก (กรุงเทพฯ)</th><th>ราคา</th><th>คอมมิชชัน</th><th>ยอดขายสะสม</th><th>1h units/hour</th><th>สถานะ</th></tr></thead><tbody>
      {snapshots.map(row=><tr key={row.id}><td>{new Date(row.captured_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</td><td>{money(row.price)}</td><td>{money(row.commission_amount)}</td><td>{number(row.units_sold)}</td><td>{row.velocity_1h===null?"ข้อมูลไม่พอ":number(row.velocity_1h)}</td><td>{row.status}</td></tr>)}
    </tbody></table></div></section>
    <section className="panel radar-section"><h2>คะแนนที่บันทึกไว้ ({scores.length})</h2><p className="muted">ประวัติไม่ถูกเขียนทับ คะแนนสดด้านบนอาจลดลงเมื่อข้อมูลเก่า</p><div className="data-list">{scores.map((row,i)=><div key={row.id??i}><strong>{row.score_version}</strong><span>{number(row.viral_opportunity_base_score)}</span><small>{row.calculated_at}</small></div>)}</div></section>
  </>;
}
