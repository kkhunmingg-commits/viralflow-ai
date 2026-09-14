import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import {
  getAccountAffiliateReadiness,
  getDashboardSummary,
} from "@/features/accounts/account-performance";
import { getOwnerAccounts, getOwnerTodayStats } from "@/features/accounts/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "ภาพรวม" };

function bangkokDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id ?? "";
  const [accounts, todayStats] = ownerId
    ? await Promise.all([
        getOwnerAccounts(supabase, ownerId),
        getOwnerTodayStats(supabase, ownerId, bangkokDate()),
      ])
    : [[], []];
  const summary = getDashboardSummary(accounts, todayStats);
  const cards = [
    { label: "บัญชีทั้งหมด", value: summary.totalAccounts.toLocaleString("th-TH"), note: "บัญชีใน Account Brain", tone: "blue" },
    { label: "Growth accounts", value: summary.growthAccounts.toLocaleString("th-TH"), note: "effective mode", tone: "violet" },
    { label: "Affiliate accounts", value: summary.affiliateAccounts.toLocaleString("th-TH"), note: "effective mode", tone: "green" },
    { label: "บัญชีที่ถูกบล็อก", value: summary.blockedAccounts.toLocaleString("th-TH"), note: "ยังเผยแพร่ไม่ได้", tone: "amber" },
    { label: "โพสต์ที่วางแผนวันนี้", value: summary.plannedPosts.toLocaleString("th-TH"), note: "รวม daily target", tone: "blue" },
    { label: "ผู้ติดตามรวม", value: summary.followerTotal.toLocaleString("th-TH"), note: "ทุกบัญชี", tone: "violet" },
    { label: "ผู้ติดตามเพิ่มวันนี้", value: summary.followersGained.toLocaleString("th-TH"), note: "จาก daily stats", tone: "green" },
    { label: "คำสั่งซื้อวันนี้", value: summary.orders.toLocaleString("th-TH"), note: "จาก daily stats", tone: "amber" },
    { label: "GMV วันนี้", value: `฿${summary.gmv.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`, note: "จาก daily stats", tone: "blue" },
    { label: "คอมมิชชันวันนี้", value: `฿${summary.commission.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`, note: "จาก daily stats", tone: "green" },
  ] as const;

  return (
    <>
      <PageHeading eyebrow="MULTI-ACCOUNT OVERVIEW" title="ภาพรวมการทำงาน" description="ตัวเลขทั้งหมดคำนวณจากบัญชีและสถิติรายวันใน Supabase" action={<button className="primary-action" disabled>START AUTO <span>Phase 10</span></button>} />
      <section className="stats-grid dashboard-stats" aria-label="ตัวชี้วัดวันนี้">
        {cards.map((item) => <article className={`stat-card ${item.tone}`} key={item.label}><p>{item.label}</p><strong>{item.value}</strong><small>{item.note}</small></article>)}
      </section>
      <section className="panel account-panel">
        <div className="panel-heading"><div><p className="eyebrow">ACCOUNT BRAIN</p><h2>สถานะบัญชี</h2></div><Link href="/accounts">จัดการบัญชี →</Link></div>
        {accounts.length ? <div className="account-list">{accounts.map((account) => {
          const readiness = getAccountAffiliateReadiness(account);
          return <Link className="account-row" href={`/accounts/${account.id}`} key={account.id}><span className="account-avatar">{account.display_name.slice(0, 1)}</span><div className="account-info"><strong>{account.display_name}</strong><small>@{account.username}</small></div><div className="account-metric"><strong>{account.follower_count.toLocaleString("th-TH")}</strong><small>ผู้ติดตาม</small></div><span className={`mode-badge ${account.effective_mode.toLowerCase()}`}>{account.effective_mode}</span><span className={`status-badge ${readiness.canPublish ? "ready" : "blocked"}`}>{readiness.canPublish ? "READY" : "BLOCKED"}</span></Link>;
        })}</div> : <div className="compact-empty"><span>01</span><div><strong>ยังไม่มีบัญชี TikTok</strong><p>เพิ่มบัญชีจำลองในหน้า Accounts เพื่อเริ่มคำนวณ dashboard</p></div></div>}
      </section>
      <section className="panel next-step"><div><p className="eyebrow">PHASE 2</p><h2>Multi-Account Brain</h2></div><p>โหมด ความพร้อม สถิติ และ category affinity เชื่อมกับข้อมูลจริงแล้ว</p><span>ACTIVE</span></section>
    </>
  );
}
