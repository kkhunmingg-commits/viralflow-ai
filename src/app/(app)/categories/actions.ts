"use server";
import {revalidatePath} from "next/cache";
import {persistCategoryIntelligence} from "@/features/categories/services";
import {createClient} from "@/lib/supabase/server";
import {serverEnv} from "@/lib/server-env";
export async function buildCategoryIntelligence():Promise<{message:string}>{if(process.env.NODE_ENV!=="development"||!serverEnv.allowDevMockSeed)return{message:"การประมวลผลตัวอย่างเปิดเฉพาะ development"};const client=await createClient();const {data,error}=await client.auth.getUser();if(error||!data.user)return{message:"กรุณาเข้าสู่ระบบ"};try{const result=await persistCategoryIntelligence(client,data.user.id);revalidatePath("/categories","layout");revalidatePath("/product-radar","layout");return{message:`ประมวลผล ${result.categories} หมวดหมู่แล้ว`};}catch{return{message:"ประมวลผลหมวดหมู่ไม่สำเร็จ กรุณาตรวจว่ามี Product Radar data"};}}
