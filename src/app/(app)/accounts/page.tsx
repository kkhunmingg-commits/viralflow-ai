import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getOwnerAccounts } from "@/features/accounts/queries";
import type { TikTokAccount } from "@/features/accounts/types";
import { createClient } from "@/lib/supabase/server";
import { presentAccount } from "./account-presentation";
import { DisconnectTikTokButton } from "./disconnect-tiktok-button";
import { HideTikTokAccountButton } from "./hide-tiktok-account-button";

export const metadata: Metadata = { title: "บัญชี TikTok" };

function AccountCard({ account }: { account: TikTokAccount }) {
  const state = presentAccount(account).connection;
  const disconnected = account.connection_status === "DISCONNECTED" || ["revoked", "disconnected"].includes(account.authorization_status);
  return <article className="accounts-card accounts-customer-card">
    <div className="accounts-card-header">
      {account.avatar_url && !account.is_mock
        ? <Image className="accounts-avatar" src={account.avatar_url} alt="" width={54} height={54} unoptimized />
        : <span className="accounts-avatar accounts-avatar-fallback" aria-hidden="true">{account.display_name.slice(0, 1).toUpperCase()}</span>}
      <div className="accounts-identity"><h2>{account.display_name}</h2><p>{account.username ? `@${account.username}` : "บัญชี TikTok"}</p></div>
      <span className={`accounts-badge ${state.tone}`}><span className="accounts-badge-dot" />{state.label}</span>
      {!account.is_mock && disconnected ? <HideTikTokAccountButton accountId={account.id}
        accountName={account.username ? `@${account.username}` : account.display_name} /> : null}
    </div>
    <p className="account-customer-mode">โหมด: <strong>{account.mode}</strong></p>
    <div className="accounts-card-actions">
      <Link className="accounts-detail-link" href={`/accounts/${account.id}`}>เปิดบัญชี →</Link>
      {!account.is_mock && !disconnected && <DisconnectTikTokButton accountId={account.id} accountName={account.display_name} />}
    </div>
  </article>;
}

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  let accounts: TikTokAccount[] = [];
  let loadError = false;
  try { accounts = userData.user ? await getOwnerAccounts(supabase, userData.user.id) : []; }
  catch { loadError = true; }
  if (process.env.NODE_ENV === "production") accounts = accounts.filter((account) => !account.is_mock);

  return <div className="accounts-page">
    <header className="accounts-hero"><div className="accounts-hero-copy"><p className="accounts-overline">บัญชีของคุณ</p>
      <h1>บัญชี TikTok</h1><p>เลือกบัญชีที่ ViralFlow จะใช้ทำงานให้คุณ</p></div>
      <Link className="accounts-connect" href={accounts.length ? "/accounts/connect/tiktok/qr" : "/accounts/connect/tiktok"}>＋ เชื่อม TikTok บัญชีอื่น</Link></header>
    {loadError ? <section className="accounts-empty accounts-error" role="alert"><h2>โหลดบัญชีไม่สำเร็จ</h2>
      <p>กรุณาลองอีกครั้ง</p><Link className="accounts-connect" href="/accounts">ลองอีกครั้ง</Link></section>
      : accounts.length ? <section aria-label="บัญชี TikTok"><div className="accounts-section-head"><h2>บัญชีของคุณ</h2>
          <span>{accounts.length.toLocaleString("th-TH")} บัญชี</span></div>
          <div className="accounts-grid">{accounts.map((account) => <AccountCard key={account.id} account={account} />)}</div></section>
        : <section className="accounts-empty"><span className="accounts-empty-icon" aria-hidden="true">♪</span>
          <h2>เริ่มด้วยบัญชี TikTok ของคุณ</h2><p>เชื่อมบัญชีเพื่อเริ่มใช้งาน ViralFlow</p>
          <Link className="accounts-connect" href="/accounts/connect/tiktok">เชื่อม TikTok →</Link></section>}
  </div>;
}
