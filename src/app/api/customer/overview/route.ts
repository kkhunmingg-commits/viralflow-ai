import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCustomerRecords } from "@/features/control-center/customer-data";
import { customerPeriod, mapCustomerOverview } from "@/features/control-center/customer-mapping";

export async function GET(request: Request) {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return NextResponse.json({ message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try {
    const records = await readCustomerRecords(client, data.user.id);
    const period = customerPeriod(new URL(request.url).searchParams.get("period"));
    return NextResponse.json(mapCustomerOverview(records, period), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "ยังโหลดข้อมูลไม่ได้ กรุณาลองอีกครั้ง" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
