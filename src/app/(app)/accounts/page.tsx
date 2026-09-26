import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AccountFields } from "@/components/account-fields";
import { getOwnerAccounts } from "@/features/accounts/queries";
import type { TikTokAccount } from "@/features/accounts/types";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import { tiktokRequirementLabel } from "@/lib/tiktok-config";
import { createClient } from "@/lib/supabase/server";
import { createMockAccount, deleteMockAccount, seedDevelopmentAccounts, updateMockAccount } from "./actions";
import { presentAccount, type AccountBadge, type AccountHealthSnapshot, type ShopSnapshot } from "./account-presentation";
import { DisconnectTikTokButton } from "./disconnect-tiktok-button";

export const metadata: Metadata = { title: "บัญชี TikTok" };

function Badge({ value }: { value: AccountBadge }) {
  return <span className={`accounts-badge ${value.tone}`}><span className="accounts-badge-dot" />{value.label}</span>;
}

function displayActivity(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value))
    : "ยังไม่มีกิจกรรม";
}

function AccountCard({ account, health, shop, canSeed }: {
  account: TikTokAccount; health?: AccountHealthSnapshot; shop?: ShopSnapshot; canSeed: boolean;
}) {
  const state = presentAccount(account, health, shop);
  return <article className="accounts-card">
    <div className="accounts-card-header">
      {account.avatar_url && !account.is_mock
        ? <Image className="accounts-avatar" src={account.avatar_url} alt="" width={54} height={54} unoptimized />
        : <span className="accounts-avatar accounts-avatar-fallback" aria-hidden="true">{account.display_name.slice(0, 1).toUpperCase()}</span>}
      <div className="accounts-identity"><h2>{account.display_name}</h2><p>{account.username ? `@${account.username}` : "ยังไม่มีชื่อผู้ใช้ TikTok"}</p></div>
      <Badge value={state.connection} />
    </div>
    <div className="accounts-mode-row"><span className={`accounts-mode ${account.mode.toLowerCase()}`}>{account.mode}</span>{account.mode === "AUTO" ? <span className="accounts-effective">โหมดปัจจุบัน: {account.effective_mode}</span> : null}</div>
    <dl className="accounts-details">
      <div><dt>การเผยแพร่</dt><dd><Badge value={state.publishing} /></dd></div>
      <div><dt>สุขภาพบัญชี</dt><dd><Badge value={state.accountHealth} /></dd></div>
      <div><dt>TikTok Shop</dt><dd><Badge value={state.shopStatus} /></dd></div>
      <div><dt>กิจกรรมล่าสุด</dt><dd className="accounts-activity">{displayActivity(state.activity)}</dd></div>
    </dl>
    <div className="accounts-card-actions">
      <Link className="accounts-detail-link" href={`/accounts/${account.id}`}>เปิดบัญชี <span aria-hidden="true">→</span></Link>
      {!account.is_mock && account.connection_status !== "DISCONNECTED" && ["authorized", "expired", "error"].includes(account.authorization_status)
        ? <DisconnectTikTokButton accountId={account.id} accountName={account.display_name} />
        : !account.is_mock && (account.connection_status === "DISCONNECTED" || account.authorization_status === "revoked" || account.authorization_status === "disconnected")
          ? <Link className="accounts-other-link" href="/auth/tiktok/start?new_account=1">เชื่อม TikTok บัญชีอื่น <span aria-hidden="true">→</span></Link>
          : null}
    </div>
    {canSeed && account.is_mock ? <details className="accounts-dev-edit"><summary>แก้ไขบัญชีจำลอง</summary><form action={updateMockAccount.bind(null, account.id)} className="account-form"><AccountFields account={account} /><div className="form-actions"><button className="primary-action" type="submit">บันทึก</button><button className="danger-action" formAction={deleteMockAccount.bind(null, account.id)}>ลบบัญชีจำลอง</button></div></form></details> : null}
  </article>;
}

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id ?? "";
  const canSeed = process.env.NODE_ENV === "development" && serverEnv.allowDevMockSeed;
  let accounts: TikTokAccount[] = [];
  let loadError = false;
  try { accounts = ownerId ? await getOwnerAccounts(supabase, ownerId) : []; }
  catch { loadError = true; }
  if (process.env.NODE_ENV === "production") accounts = accounts.filter((account) => !account.is_mock);

  const ids = accounts.map((account) => account.id);
  const [healthResult, shopResult] = ids.length && !loadError
    ? await Promise.all([
      supabase.from("account_publish_health").select("tiktok_account_id,health_status,updated_at").eq("owner_id", ownerId).in("tiktok_account_id", ids),
      supabase.from("creator_commerce_profiles").select("tiktok_account_id,attachment_available,synced_at").eq("owner_id", ownerId).in("tiktok_account_id", ids),
    ]) : [{ data: null }, { data: null }];
  const healthByAccount = new Map((healthResult.data ?? []).map((value) => [value.tiktok_account_id, value as AccountHealthSnapshot]));
  const shopByAccount = new Map((shopResult.data ?? []).map((value) => [value.tiktok_account_id, value as ShopSnapshot]));

  return <div className="accounts-page">
    <header className="accounts-hero"><div className="accounts-hero-copy"><p className="accounts-overline">VIRALFLOW / ACCOUNTS</p><h1>บัญชี TikTok</h1><p>เชื่อมและจัดการบัญชีที่ ViralFlow จะใช้ทำงานอัตโนมัติ</p></div><Link className="accounts-connect" href="/accounts/connect/tiktok"><span aria-hidden="true">＋</span> เชื่อม TikTok</Link></header>
    {tiktokOfficialSetupMissing.length ? <section className="accounts-setup" role="status"><div><strong>TikTok setup required</strong><p>{tiktokOfficialSetupMissing.map((key) => `${tiktokRequirementLabel(key)} missing`).join(" · ")}</p></div><Link href="/accounts/connect/tiktok">ดูการตั้งค่า →</Link></section> : null}
    {loadError ? <section className="accounts-empty accounts-error" role="alert"><span className="accounts-empty-icon" aria-hidden="true">!</span><h2>โหลดบัญชีไม่สำเร็จ</h2><p>โปรดลองอีกครั้ง หากยังพบปัญหา ให้ตรวจสอบการเชื่อมต่อของระบบ</p><Link className="accounts-connect" href="/accounts">ลองอีกครั้ง</Link></section>
      : accounts.length ? <section aria-label="บัญชี TikTok ที่เชื่อมต่อ"><div className="accounts-section-head"><h2>บัญชีของคุณ</h2><span>{accounts.length.toLocaleString("th-TH")} บัญชี</span></div><div className="accounts-grid">{accounts.map((account) => <AccountCard key={account.id} account={account} health={healthByAccount.get(account.id)} shop={shopByAccount.get(account.id)} canSeed={canSeed} />)}</div></section>
        : <section className="accounts-empty"><span className="accounts-empty-icon" aria-hidden="true">♪</span><h2>ยังไม่มีบัญชี TikTok</h2><p>เชื่อมบัญชีแรกของคุณเพื่อเริ่มใช้ ViralFlow</p><Link className="accounts-connect" href="/accounts/connect/tiktok">เชื่อม TikTok <span aria-hidden="true">→</span></Link><small>คุณสามารถเชื่อมหลายบัญชีได้</small></section>}
    {canSeed ? <details className="accounts-dev-tools"><summary>เครื่องมือทดสอบสำหรับการพัฒนา</summary><div className="accounts-dev-content"><p>บัญชีจำลองใช้ทดสอบในเครื่องเท่านั้น</p><form action={seedDevelopmentAccounts}><button className="accounts-secondary" type="submit">สร้างชุดข้อมูลทดสอบ</button></form><details><summary>เพิ่มบัญชีจำลอง</summary><form action={createMockAccount} className="account-form"><AccountFields /><button className="primary-action" type="submit">บันทึกบัญชีจำลอง</button></form></details></div></details> : null}
  </div>;
}
