import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccountDetailData } from "@/features/accounts/queries";
import { createClient } from "@/lib/supabase/server";
import { DisconnectTikTokButton } from "../disconnect-tiktok-button";
import { presentAccount } from "../account-presentation";
import "../accounts.css";
import {AccountSafetyCard} from "@/components/customer-control-center/account-safety";
import {loadOwnerAccountSafety} from "@/features/compliance-brain/store";

export const metadata: Metadata = { title: "บัญชี TikTok" };

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) notFound();
  const { account } = await getAccountDetailData(supabase, userData.user.id, id);
  if (!account || (process.env.NODE_ENV === "production" && account.is_mock)) notFound();

  const connection = presentAccount(account).connection;
  const disconnected = account.connection_status === "DISCONNECTED" || ["revoked", "disconnected"].includes(account.authorization_status);
  const safety=await loadOwnerAccountSafety(supabase,userData.user.id,[account.id]);
  return <div className="accounts-page account-customer-detail">
    <Link className="accounts-detail-link" href="/accounts">← กลับไปบัญชีทั้งหมด</Link>
    <header className="accounts-hero"><div className="accounts-hero-copy"><p className="accounts-overline">บัญชีของคุณ</p>
      <h1>{account.display_name}</h1><p>{account.username ? `@${account.username}` : "บัญชี TikTok"}</p></div></header>
    <section className="accounts-card" aria-label="รายละเอียดบัญชี TikTok">
      <div className="accounts-card-header">
        {account.avatar_url && !account.is_mock
          ? <Image className="accounts-avatar" src={account.avatar_url} alt="" width={64} height={64} unoptimized />
          : <span className="accounts-avatar accounts-avatar-fallback" aria-hidden="true">{account.display_name.slice(0, 1).toUpperCase()}</span>}
        <div className="accounts-identity"><h2>{account.display_name}</h2><p>{account.username ? `@${account.username}` : "TikTok"}</p></div>
        <span className={`accounts-badge ${connection.tone}`}><span className="accounts-badge-dot" />{connection.label}</span>
      </div>
      <p className="account-customer-mode">โหมดที่เลือก: <strong>{account.mode}</strong></p>
      <div className="accounts-card-actions">
        {disconnected ? <Link className="accounts-connect" href="/accounts/connect/tiktok/qr">เชื่อม TikTok บัญชีอื่น</Link>
          : !account.is_mock ? <DisconnectTikTokButton accountId={account.id} accountName={account.display_name} /> : null}
        <Link className="accounts-detail-link" href={`/auto?account=${account.id}`}>ไปหน้า Home →</Link>
      </div>
    </section>
    <AccountSafetyCard summary={safety[account.id]} />
  </div>;
}
