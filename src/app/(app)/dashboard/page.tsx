import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ภาพรวม" };

const statCards = [
  { label: "โพสต์วันนี้", value: "0", note: "ยังไม่เปิด Publisher", tone: "blue" },
  { label: "ค่าใช้จ่ายวันนี้", value: "฿0.00", note: "Paid providers ปิดอยู่", tone: "green" },
  { label: "ยอดดูวันนี้", value: "—", note: "รอข้อมูล Analytics", tone: "violet" },
  { label: "คอมมิชชัน", value: "—", note: "รอสิทธิ์ TikTok Shop", tone: "amber" },
] as const;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id ?? "";
  const { data: accounts } = await supabase
    .from("tiktok_accounts")
    .select(
      "id, display_name, username, follower_count, detected_mode, account_status, ecommerce_permission, cart_enabled",
    )
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });

  return (
    <>
      <PageHeading
        eyebrow="OVERVIEW"
        title="ภาพรวมการทำงาน"
        description="สถานะบัญชี ความพร้อม และผลลัพธ์สำคัญในที่เดียว"
        action={<button className="primary-action" disabled>START AUTO <span>Phase 10</span></button>}
      />

      <section className="stats-grid" aria-label="ตัวชี้วัดวันนี้">
        {statCards.map((item) => (
          <article className={"stat-card " + item.tone} key={item.label}>
            <p>{item.label}</p>
            <strong>{item.value}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <article className="panel account-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACCOUNT BRAIN</p>
              <h2>บัญชีที่เชื่อมต่อ</h2>
            </div>
            <Link href="/accounts">จัดการบัญชี →</Link>
          </div>
          {accounts?.length ? (
            <div className="account-list">
              {accounts.map((account) => (
                <div className="account-row" key={account.id}>
                  <span className="account-avatar">{account.display_name.slice(0, 1)}</span>
                  <div className="account-info">
                    <strong>{account.display_name}</strong>
                    <small>@{account.username}</small>
                  </div>
                  <div className="account-metric">
                    <strong>{account.follower_count.toLocaleString("th-TH")}</strong>
                    <small>ผู้ติดตาม</small>
                  </div>
                  <span className={"mode-badge " + account.detected_mode}>
                    {account.detected_mode === "affiliate" ? "AFFILIATE" : "GROWTH"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="compact-empty">
              <span>01</span>
              <div>
                <strong>ยังไม่มีบัญชี TikTok</strong>
                <p>เพิ่มโปรไฟล์บัญชีในหน้า Accounts เพื่อเริ่มวางแผน</p>
              </div>
            </div>
          )}
        </article>

        <article className="panel readiness-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">FOUNDATION</p>
              <h2>ความพร้อมของระบบ</h2>
            </div>
            <span className="health-badge">HEALTHY</span>
          </div>
          <ul className="readiness-list">
            <li><span className="check">✓</span><div><strong>Authentication</strong><small>Supabase SSR session</small></div></li>
            <li><span className="check">✓</span><div><strong>Data isolation</strong><small>Row Level Security</small></div></li>
            <li><span className="check">✓</span><div><strong>Environment</strong><small>Validated at startup</small></div></li>
            <li><span className="waiting">•</span><div><strong>TikTok integration</strong><small>รอการอนุมัติใน Phase 7–8</small></div></li>
          </ul>
        </article>
      </section>

      <section className="panel next-step">
        <div><p className="eyebrow">NEXT MILESTONE</p><h2>Phase 2 · Account Brain</h2></div>
        <p>โมเดลหลายบัญชี การตรวจสิทธิ์ และการคำนวณ Growth/Affiliate mode แบบอัตโนมัติ</p>
        <span>ยังไม่เริ่ม</span>
      </section>
    </>
  );
}

