import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "บัญชี TikTok" };

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { data: accounts } = await supabase
    .from("tiktok_accounts")
    .select("*")
    .eq("owner_id", userData.user?.id ?? "")
    .order("created_at", { ascending: true });

  return (
    <>
      <PageHeading
        eyebrow="ACCOUNT BRAIN"
        title="บัญชี TikTok"
        description="โปรไฟล์และสถานะสิทธิ์ของแต่ละบัญชีถูกแยกออกจากกัน"
        action={<button className="primary-action" disabled>+ เพิ่มบัญชี <span>Phase 2</span></button>}
      />
      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">CONNECTED ACCOUNTS</p><h2>{accounts?.length ?? 0} บัญชี</h2></div>
          <span className="muted">เป้าหมายเริ่มต้น 3 บัญชี</span>
        </div>
        {accounts?.length ? (
          <div className="account-cards">
            {accounts.map((account) => (
              <article className="account-card" key={account.id}>
                <div className="account-card-top">
                  <span className="account-avatar large">{account.display_name.slice(0, 1)}</span>
                  <span className={"mode-badge " + account.detected_mode}>{account.detected_mode.toUpperCase()}</span>
                </div>
                <h3>{account.display_name}</h3>
                <p>@{account.username}</p>
                <dl>
                  <div><dt>ผู้ติดตาม</dt><dd>{account.follower_count.toLocaleString("th-TH")}</dd></div>
                  <div><dt>สถานะบัญชี</dt><dd>{account.account_status}</dd></div>
                  <div><dt>E-commerce</dt><dd>{account.ecommerce_permission === true ? "พร้อม" : account.ecommerce_permission === false ? "ไม่พร้อม" : "ยังไม่ทราบ"}</dd></div>
                  <div><dt>Product cart</dt><dd>{account.cart_enabled === true ? "พร้อม" : account.cart_enabled === false ? "ไม่พร้อม" : "ยังไม่ทราบ"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div className="large-empty">
            <span className="empty-orbit">AC</span>
            <h2>เริ่มต้นด้วยบัญชีแรก</h2>
            <p>Phase 2 จะเปิดการเพิ่มบัญชีและบันทึกหลักฐานสิทธิ์อย่างปลอดภัย</p>
            <button disabled>เพิ่มบัญชีใน Phase 2</button>
          </div>
        )}
      </section>
    </>
  );
}

