"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server-env";
import { MockProductProvider } from "@/features/products/providers";
import { ingestProducts } from "@/features/products/services";
export async function seedProductRadar():Promise<{message:string}> {
  if(process.env.NODE_ENV!=="development" || !serverEnv.allowDevMockSeed) return {message:"การสร้างข้อมูลตัวอย่างเปิดเฉพาะ development"};
  const client=await createClient();
  const {data,error}=await client.auth.getUser();
  if(error || !data.user) return {message:"กรุณาเข้าสู่ระบบ"};
  try {
    // Keep the same dataset clock across retries, including a partially completed run.
    const existing=await client.from("products").select("provider_metadata").eq("owner_id",data.user.id)
      .eq("external_provider","mock").like("external_product_id","fixture-%").order("created_at").limit(1);
    if(existing.error) throw existing.error;
    const saved=existing.data?.[0]?.provider_metadata?.seed_anchor;
    const anchor=typeof saved==="string"?new Date(saved):new Date(Math.floor(Date.now()/3600000)*3600000);
    const result=await ingestProducts(client,data.user.id,new MockProductProvider(anchor));
    revalidatePath("/product-radar","layout");
    return {message:`บันทึกสินค้า ${result.products} รายการ และประวัติ ${result.observations} จุดแล้ว การกดซ้ำไม่สร้างข้อมูลซ้ำ`};
  } catch {
    return {message:"นำเข้าข้อมูลไม่สำเร็จ กรุณาตรวจการเชื่อมต่อและลองอีกครั้ง ระบบเก็บรายการที่สำเร็จไว้แล้ว"};
  }
}
