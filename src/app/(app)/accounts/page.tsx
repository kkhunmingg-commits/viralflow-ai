import type { Metadata } from "next";
import Link from "next/link";
import { AccountFields } from "@/components/account-fields";
import { PageHeading } from "@/components/page-heading";
import { getAccountAffiliateReadiness } from "@/features/accounts/account-performance";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { serverEnv } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";
import {
  createMockAccount,
  deleteMockAccount,
  seedDevelopmentAccounts,
  updateMockAccount,
} from "./actions";

export const metadata: Metadata = { title: "บัญชี TikTok" };

const permissionText = (value: boolean | null) =>
  value === true ? "พร้อม" : value === false ? "ไม่พร้อม" : "ยังไม่ทราบ";

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id ?? "";
  const accounts = ownerId ? await getOwnerAccounts(supabase, ownerId) : [];
  const canSeed =
    process.env.NODE_ENV === "development" && serverEnv.allowDevMockSeed;

  return (
    <>
      <PageHeading
        eyebrow="MULTI-ACCOUNT BRAIN"
        title="บัญชี TikTok"
        description="จัดการโปรไฟล์จำลอง ตรวจความพร้อม และแยกโหมดของแต่ละบัญชีจากข้อมูลจริง"
        action={canSeed ? <form action={seedDevelopmentAccounts}><button className="secondary-action">สร้างชุดข้อมูลทดสอบ</button></form> : undefined}
      />

      <details className="panel create-account-panel">
        <summary>+ เพิ่มบัญชีจำลอง</summary>
        <form action={createMockAccount} className="account-form">
          <AccountFields />
          <button className="primary-action" type="submit">บันทึกบัญชีจำลอง</button>
        </form>
      </details>

      <section className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">ACCOUNTS</p><h2>{accounts.length} บัญชี</h2></div>
          <span className="muted">รองรับหลายบัญชีโดยไม่จำกัดจำนวน</span>
        </div>
        {accounts.length ? (
          <div className="account-cards">
            {accounts.map((account) => {
              const readiness = getAccountAffiliateReadiness(account);
              return (
                <article className="account-card" key={account.id}>
                  <div className="account-card-top">
                    <span className="account-avatar large">{account.display_name.slice(0, 1)}</span>
                    <div className="badge-group">
                      <span className={`mode-badge ${account.mode.toLowerCase()}`}>{account.mode}</span>
                      <span className={`mode-badge ${account.effective_mode.toLowerCase()}`}>{account.effective_mode}</span>
                      <span className={`status-badge ${readiness.canPublish ? "ready" : "blocked"}`}>{readiness.canPublish ? "READY" : "BLOCKED"}</span>
                    </div>
                  </div>
                  <h3><Link href={`/accounts/${account.id}`}>{account.display_name}</Link></h3>
                  <p>@{account.username}</p>
                  <dl>
                    <div><dt>ผู้ติดตาม</dt><dd>{account.follower_count.toLocaleString("th-TH")}</dd></div>
                    <div><dt>Affiliate eligibility</dt><dd>{readiness.canAffiliate ? "พร้อม" : "ยังไม่พร้อม"}</dd></div>
                    <div><dt>Product cart</dt><dd>{permissionText(account.cart_enabled)}</dd></div>
                    <div><dt>Authorization</dt><dd><span className={`status-badge ${account.authorization_status === "disconnected" ? "disconnected" : readiness.authorizationReady ? "ready" : "blocked"}`}>{account.authorization_status.toUpperCase()}</span></dd></div>
                    <div><dt>เป้าหมาย / เพดาน</dt><dd>{account.daily_post_target} / {account.daily_post_hard_limit}</dd></div>
                    <div><dt>สถานะบัญชี</dt><dd>{account.account_status}</dd></div>
                  </dl>
                  <Link className="account-detail-link" href={`/accounts/${account.id}`}>ดูข้อมูลเชิงลึก →</Link>
                  {account.is_mock ? (
                    <details className="edit-account">
                      <summary>แก้ไขบัญชีจำลอง</summary>
                      <form action={updateMockAccount.bind(null, account.id)} className="account-form">
                        <AccountFields account={account} />
                        <div className="form-actions">
                          <button className="primary-action" type="submit">บันทึก</button>
                          <button className="danger-action" formAction={deleteMockAccount.bind(null, account.id)}>ลบบัญชีจำลอง</button>
                        </div>
                      </form>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="large-empty">
            <span className="empty-orbit">AC</span>
            <h2>เริ่มต้นด้วยบัญชีจำลอง</h2>
            <p>เพิ่มข้อมูลบัญชีด้านบนเพื่อทดลองโหมด ความพร้อม และ dashboard โดยไม่เชื่อม TikTok OAuth</p>
          </div>
        )}
      </section>
    </>
  );
}
