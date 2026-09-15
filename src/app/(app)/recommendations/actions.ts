"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { persistDailyAssignments } from "@/features/assignments/services";
export async function saveRecommendations() {
  const client=await createClient();const {data}=await client.auth.getUser();
  if(!data.user)return {message:"กรุณาเข้าสู่ระบบ"};
  try {
    const result=await persistDailyAssignments(client,data.user.id);
    revalidatePath("/recommendations");
    return {message:`บันทึก ${result.assignments} คำแนะนำจาก ${result.scores} คู่สินค้า × บัญชีแล้ว`};
  } catch {return {message:"บันทึกไม่สำเร็จ กรุณาลองใหม่"};}
}
