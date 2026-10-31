import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import {
  getAccountAffiliateReadiness,
  getDashboardSummary,
} from "@/features/accounts/account-performance";
import { getOwnerAccounts, getOwnerTodayStats } from "@/features/accounts/queries";
import { createClient } from "@/lib/supabase/server";
import { getAnalyticsOverview } from "@/features/analytics/services";
import { getGrowthOverview, summarizeGrowth } from "@/features/growth/services";
import {getAutoOverview} from "@/features/auto/services";
import {AutoControls} from "@/components/auto-controls";

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
  const [accounts, todayStats, analytics, growthOverview,autoOverview] = ownerId
    ? await Promise.all([
        getOwnerAccounts(supabase, ownerId),
        getOwnerTodayStats(supabase, ownerId, bangkokDate()),
        getAnalyticsOverview(supabase, ownerId),
        getGrowthOverview(supabase, ownerId),
        getAutoOverview(supabase,ownerId),
      ])
    : [[], [], null, null,null];
  const summary = getDashboardSummary(accounts, todayStats);
  const growth = growthOverview ? summarizeGrowth(growthOverview) : null;
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
    { label: "Analytics SCALE", value: (analytics?.summary.scale ?? 0).toLocaleString("th-TH"), note: "winner-detection-v1", tone: "green" },
    { label: "Analytics WATCH", value: (analytics?.summary.watch ?? 0).toLocaleString("th-TH"), note: "ติดตามหลักฐานต่อ", tone: "amber" },
    { label: "Growth plateau", value: (growth?.plateau ?? 0).toLocaleString("th-TH"), note: "บัญชีที่ควรทดลองใหม่", tone: "amber" },
    { label: "Commerce recheck", value: (growth?.rechecks ?? 0).toLocaleString("th-TH"), note: "รอตรวจสิทธิ์จริง", tone: "violet" },
    { label: "Auto running", value: (autoOverview?.summary.running??0).toLocaleString("th-TH"), note: "บัญชีที่กำลัง orchestration", tone: "green" },
    { label: "Auto paused", value: (autoOverview?.summary.paused??0).toLocaleString("th-TH"), note: "resume จาก checkpoint ได้", tone: "amber" },
    { label: "Waiting approval", value: (autoOverview?.summary.waitingApprovals??0).toLocaleString("th-TH"), note: "ไม่ข้าม consent", tone: "violet" },
    { label: "Auto cost today", value: `$${(autoOverview?.summary.costToday??0).toFixed(2)}`, note: "paid provider disabled", tone: "blue" },
  ] as const;

  return (
    <>
      <PageHeading eyebrow="MULTI-ACCOUNT OVERVIEW" title="ภาพรวมการทำงาน" description="ตัวเลขทั้งหมดคำนวณจากบัญชีและสถิติรายวันใน Supabase" action={<AutoControls runId={autoOverview?.activeRun?.id} state={autoOverview?.activeRun?.state}/>} />
      <section className="stats-grid dashboard-stats" aria-label="ตัวชี้วัดวันนี้">
        {cards.map((item) => <article className={`stat-card ${item.tone}`} key={item.label}><p>{item.label}</p><strong>{item.value}</strong><small>{item.note}</small></article>)}
      </section>
      <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">GROWTH LEARNING</p><h2>Fastest growth & winning patterns</h2></div><Link href="/growth">เปิด Growth Engine →</Link></div><div className="detail-summary-grid"><div className="data-list">{growth?.fastest.length?growth.fastest.map(x=><div key={x.account.id}><strong>{x.account.display_name}</strong><span>{x.latestSnapshot?.follower_delta===null||x.latestSnapshot?.follower_delta===undefined?"UNKNOWN":`+${x.latestSnapshot.follower_delta}`}</span><small>{x.profile?.growth_state??"NEW"}</small></div>):<p className="muted">ยังไม่มี follower trajectory</p>}</div><div className="data-list"><div><strong>Winning hooks</strong><span>{growth?.winningHooks.length??0}</span><small>{growth?.winningHooks.map(x=>x.value).join(", ")||"ยังไม่มี"}</small></div><div><strong>Winning categories</strong><span>{growth?.winningCategories.length??0}</span><small>{growth?.winningCategories.map(x=>x.categoryKey).join(", ")||"ยังไม่มี"}</small></div></div></div></section>
      <section className="panel account-panel">
        <div className="panel-heading"><div><p className="eyebrow">ACCOUNT BRAIN</p><h2>สถานะบัญชี</h2></div><Link href="/accounts">จัดการบัญชี →</Link></div>
        {accounts.length ? <div className="account-list">{accounts.map((account) => {
          const readiness = getAccountAffiliateReadiness(account);
          return <Link className="account-row" href={`/accounts/${account.id}`} key={account.id}><span className="account-avatar">{account.display_name.slice(0, 1)}</span><div className="account-info"><strong>{account.display_name}</strong><small>{account.username ? `@${account.username}` : "ยังไม่มี username"}</small></div><div className="account-metric"><strong>{account.follower_count.toLocaleString("th-TH")}</strong><small>ผู้ติดตาม</small></div><span className={`mode-badge ${account.effective_mode.toLowerCase()}`}>{account.effective_mode}</span><span className={`status-badge ${readiness.canPublish ? "ready" : "blocked"}`}>{readiness.canPublish ? "READY" : "BLOCKED"}</span></Link>;
        })}</div> : <div className="compact-empty"><span>01</span><div><strong>ยังไม่มีบัญชี TikTok</strong><p>เพิ่มบัญชีจำลองในหน้า Accounts เพื่อเริ่มคำนวณ dashboard</p></div></div>}
      </section>
      <section className="panel next-step"><div><p className="eyebrow">PHASE 2</p><h2>Multi-Account Brain</h2></div><p>โหมด ความพร้อม สถิติ และ category affinity เชื่อมกับข้อมูลจริงแล้ว</p><span>ACTIVE</span></section>
    </>
  );
}
