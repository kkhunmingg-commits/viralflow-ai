import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "การเชื่อมต่อ" };

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, provider, status, granted_scopes, verified_at")
    .eq("owner_id", userData.user?.id ?? "")
    .order("created_at", { ascending: true });

  return (
    <>
      <PageHeading
        eyebrow="CAPABILITY CONTROL"
        title="การเชื่อมต่อ"
        description="สถานะและ scope ของผู้ให้บริการจะแสดงแยกจากข้อมูลลับ"
      />
      <section className="integration-grid">
        <article className="panel integration-card">
          <div className="integration-logo supabase-logo">S</div>
          <div>
            <h2>Supabase</h2>
            <p>Authentication, database และ Row Level Security</p>
          </div>
          <span className="health-badge">CONNECTED</span>
        </article>
        <article className="panel integration-card disabled">
          <div className="integration-logo">TT</div>
          <div>
            <h2>TikTok</h2>
            <p>ยังไม่เชื่อมต่อ production ตามข้อกำหนด Phase 1</p>
          </div>
          <span className="phase-chip">PHASE 7</span>
        </article>
        <article className="panel integration-card disabled">
          <div className="integration-logo">TS</div>
          <div>
            <h2>TikTok Shop</h2>
            <p>รอการยืนยัน market, scope และ creator authorization</p>
          </div>
          <span className="phase-chip">PHASE 8</span>
        </article>
      </section>
      {integrations?.length ? (
        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">DATABASE</p><h2>Integration records</h2></div></div>
          <div className="integration-records">
            {integrations.map((item) => (
              <div key={item.id}>
                <strong>{item.provider}</strong>
                <span>{item.status}</span>
                <small>{item.granted_scopes.length} scopes</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

