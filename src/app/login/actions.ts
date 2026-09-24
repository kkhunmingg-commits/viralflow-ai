"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

const loginSchema = z.object({
  email: z.email("กรุณากรอกอีเมลให้ถูกต้อง"),
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"),
});

export async function login(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const values = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!values.success) {
    return {
      error: values.error.issues[0]?.message ?? "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง",
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(values.data);
    if (error) {
      return { error: error.code === "invalid_credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองอีกครั้ง" };
    }
  } catch {
    return { error: "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองอีกครั้ง" };
  }

  redirect("/auto");
}

