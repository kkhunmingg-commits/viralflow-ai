import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {PageHeading} from "@/components/page-heading";
import {ProductImage} from "@/components/product-presentation";
import {discoverPublicProducts} from "@/features/products/public-discovery";
import {importDiscoveredProduct} from "./actions";
export default async function PublicDiscoveryPage(){
  const client=await createClient(),{data}=await client.auth.getUser();if(!data.user)redirect("/login");
  const result=await discoverPublicProducts().then(candidates=>({candidates,failure:false})).catch(()=>({candidates:[],failure:true}));
  const {candidates,failure}=result;
  return <><PageHeading eyebrow="PUBLIC PRODUCT SOURCES" title="ค้นสินค้าจากแหล่งสาธารณะ" description="ค้นภาพของรุ่นสินค้าจริงพร้อมผู้สร้างและสัญญาอนุญาต ปัจจุบันเริ่มจาก Casio F-91W"/>
    <section className="panel"><p>รายการนี้เป็นแหล่งภาพและข้อมูลรุ่นสินค้า ยังไม่ใช่รายการขายที่ตรวจสต็อก ราคา ยอดขาย หรือคอมมิชชันแล้ว ระบบจะไม่นำค่าที่ไม่ทราบไปอ้างเป็นผลตลาด</p>
      <p>นำเข้าแล้วต้องตรวจว่าเป็นรุ่นเดียวกัน ตรวจสิทธิ์และเงื่อนไขเครดิตภาพ และบันทึกข้อเท็จจริง ก่อนส่ง Creative Brain</p>
      {failure?<p role="alert">แหล่งข้อมูลยังตอบกลับไม่สำเร็จ <Link href="/product-radar/discover">ลองค้นใหม่</Link></p>:!candidates.length?<p>ยังไม่พบภาพที่ผ่านตัวกรองแหล่งข้อมูลและสัญญาอนุญาต</p>:candidates.map(c=><article className="panel" key={c.pageId}>
        <ProductImage url={c.imageUrl} title={c.fileTitle}/><h2>{c.productTitle}</h2><p>{c.fileTitle}</p>
        <p>ภาพโดย {c.creator} · <a href={c.licenseUrl} target="_blank" rel="noreferrer">{c.license}</a> · <a href={c.sourceUrl} target="_blank" rel="noreferrer">หน้าต้นฉบับ</a></p>
        <p><a href={c.manufacturerUrl} target="_blank" rel="noreferrer">ตรวจรุ่นกับผู้ผลิต</a> · สถานะ: รอตรวจรุ่นและสิทธิ์ภาพ</p>
        <form action={importDiscoveredProduct}><input type="hidden" name="model" value={c.modelKey}/><input type="hidden" name="pageId" value={c.pageId}/><button className="primary-action">นำเข้าสินค้าและภาพเพื่อรอตรวจ</button></form>
      </article>)}
    </section></>;
}
