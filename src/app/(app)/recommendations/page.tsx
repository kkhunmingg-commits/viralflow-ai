import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { PageHeading } from "@/components/page-heading";
import { RecommendationTable } from "@/components/recommendation-table";
import { AssignmentSaveForm } from "@/components/assignment-save-form";
import { getRecommendationData, filterPairScores } from "@/features/assignments/services";
import { SCORE_VERSION } from "@/features/assignments/types";
const schema=z.object({account:z.string().optional(),mode:z.enum(["GROWTH","AFFILIATE"]).optional().catch(undefined),category:z.string().optional(),minScore:z.coerce.number().min(0).max(100).catch(0)});
export default async function RecommendationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const filter=schema.parse(await searchParams),client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
 const {input,plan}=await getRecommendationData(client,data.user.id);
 const selected=filterPairScores(plan.assignments.map(a=>a.score),filter);
 return <>
 <PageHeading eyebrow="PRODUCT × CATEGORY × ACCOUNT" title="Recommendations" description={`แผนวันนี้ ${plan.date} · เลือกสินค้าตามความเหมาะสมของแต่ละบัญชี`} action={<AssignmentSaveForm/>}/>
 <section className="panel radar-section"><form className="radar-filters">
 <label>บัญชี<select name="account" defaultValue={filter.account??""}><option value="">ทุกบัญชี</option>{input.accounts.map(a=><option key={a.id} value={a.id}>{a.display_name}</option>)}</select></label>
 <label>โหมด<select name="mode" defaultValue={filter.mode??""}><option value="">ALL</option><option>GROWTH</option><option>AFFILIATE</option></select></label>
 <label>หมวดหมู่<select name="category" defaultValue={filter.category??""}><option value="">ทุกหมวดหมู่</option>{[...new Set(input.categories.map(c=>c.key))].map(c=><option key={c}>{c}</option>)}</select></label>
 <label>คะแนนขั้นต่ำ<input name="minScore" type="number" min="0" max="100" defaultValue={filter.minScore}/></label>
 <button className="primary-action">ใช้ตัวกรอง</button><Link href="/recommendations" className="secondary-action">ล้างค่า</Link>
 </form></section>
 <p className="muted">คะแนนสด ณ เวลาเปิดหน้า · แผนที่บันทึกเก็บหลักฐานแยกต่างหาก · {SCORE_VERSION}</p>
 {input.accounts.filter(a=>selected.some(s=>s.accountId===a.id)).map(a=><section className="panel radar-section" key={a.id}>
 <div className="panel-heading"><h2>{a.display_name} — {a.effective_mode}</h2><Link href={`/accounts/${a.id}`}>ดูบัญชี</Link></div>
 <RecommendationTable input={input} scores={selected.filter(s=>s.accountId===a.id)}/>
 </section>)}
 {!selected.length?<section className="panel"><h2>ยังไม่มีคำแนะนำที่ตรงเงื่อนไข</h2><p>ตรวจสถานะบัญชี ความสดใหม่ของสินค้า และข้อมูลหมวดหมู่</p></section>:null}
 <section className="panel radar-section"><h2>เงื่อนไขที่ยังไม่ผ่าน</h2>{plan.scores.filter(s=>!s.eligible&&(!filter.account||s.accountId===filter.account)&&(!filter.mode||s.mode===filter.mode)&&(!filter.category||s.categoryKey===filter.category)).map(s=><p key={s.accountId+s.productId}>{input.accounts.find(a=>a.id===s.accountId)?.display_name} · {input.products.find(p=>p.product.id===s.productId)?.product.title}: {s.blockers.map(b=>b.reason).join(" ")}</p>)}</section>
 </>;
}
