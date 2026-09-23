import { NextResponse } from "next/server";
import { ownerOperationsHealth } from "@/features/operations/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await ownerOperationsHealth(createAdminClient(), data.user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "health_unavailable" }, { status: 503 });
  }
}
