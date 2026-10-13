import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dashboard } from "@/features/multi-account/service";
import { AutomationDashboard } from "./panel";
import "./styles.css";
export default async function MultiAccountPage() {
  const client = await createClient(), { data } = await client.auth.getUser(); if (!data.user) redirect("/login");
  const view = await dashboard(createAdminClient(), data.user.id);
  if (!view.installed) return <section className="panel"><h1>ระบบหลายบัญชี</h1><p>กำลังเตรียมคิวใหม่ ระบบเดิมยังทำงานตามเดิม</p><Link href="/auto">กลับหน้าหลัก</Link></section>;
  return <AutomationDashboard initial={view} />;
}
