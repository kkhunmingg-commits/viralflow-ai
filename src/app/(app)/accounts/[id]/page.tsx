import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import {
  getAccountAffiliateReadiness,
  getAccountCategoryAffinity,
  getAccountPerformanceSummary,
} from "@/features/accounts/account-performance";
import { getAccountDetailData } from "@/features/accounts/queries";
import type { ReadinessBlockerCode } from "@/features/accounts/types";
import { createClient } from "@/lib/supabase/server";
import { getRecommendationData } from "@/features/assignments/services";
import { getRecommendationsForAccount } from "@/features/assignments/planner";
import { RecommendationTable } from "@/components/recommendation-table";

export const metadata: Metadata = { title: "รายละเอียดบัญชี" };

const blockerLabels: Record<ReadinessBlockerCode, string> = {
  FOLLOWERS_BELOW_1000: "ผู้ติดตามยังไม่ถึง 1,000 คน",
  ECOMMERCE_PERMISSION_MISSING: "ยังไม่มีสิทธิ์ E-commerce",
  CART_NOT_ENABLED: "Product cart ยังไม่พร้อม",
  AUTHORIZATION_NOT_READY: "การอนุญาตบัญชียังไม่พร้อม",
  ACCOUNT_NOT_ACTIVE: "บัญชีไม่ได้อยู่ในสถานะปกติ",
};

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id;
  if (!ownerId) notFound();

  const { account, stats, affinities } = await getAccountDetailData(supabase, ownerId, id);
  if (!account) notFound();
  const recommendations = await getRecommendationData(supabase, ownerId);

  const readiness = getAccountAffiliateReadiness(account);
  const performance = getAccountPerformanceSummary(stats);
  const rankedAffinities = getAccountCategoryAffinity(affinities);

  return (
    <>
      <section className="panel radar-section"><h2>Recommended Products Today</h2><RecommendationTable input={recommendations.input} scores={getRecommendationsForAccount(recommendations.plan,id).map(a=>a.score)}/></section>
      <PageHeading eyebrow="ACCOUNT DETAIL" title={account.display_name} description={`@${account.username} · ข้อมูลจริงจาก Supabase`} action={<Link className="secondary-action" href="/accounts">← กลับหน้าบัญชี</Link>} />

      <section className="detail-summary-grid">
        <article className="panel detail-account-card">
          <div className="account-card-top"><span className="account-avatar large">{account.display_name.slice(0, 1)}</span><div className="badge-group"><span className={`mode-badge ${account.mode.toLowerCase()}`}>{account.mode}</span><span className={`mode-badge ${account.effective_mode.toLowerCase()}`}>{account.effective_mode}</span></div></div>
          <dl className="detail-list">
            <div><dt>ผู้ติดตาม</dt><dd>{account.follower_count.toLocaleString("th-TH")}</dd></div>
            <div><dt>เป้าหมายโพสต์</dt><dd>{account.daily_post_target} / {account.daily_post_hard_limit} ต่อวัน</dd></div>
            <div><dt>Affiliate</dt><dd>{readiness.canAffiliate ? "พร้อม" : "ยังไม่พร้อม"}</dd></div>
            <div><dt>Posting</dt><dd>{readiness.canPublish ? "พร้อมเผยแพร่" : "ถูกบล็อก"}</dd></div>
            <div><dt>สถานะ</dt><dd>{account.account_status}</dd></div>
          </dl>
        </article>
        <article className="panel">
          <p className="eyebrow">READINESS BLOCKERS</p><h2>{readiness.blockers.length ? `${readiness.blockers.length} รายการ` : "พร้อมใช้งาน"}</h2>
          {readiness.blockers.length ? <ul className="blocker-list">{readiness.blockers.map((blocker) => <li key={blocker}>{blockerLabels[blocker]}</li>)}</ul> : <p className="success-copy">ผ่านเงื่อนไขการทำงานทั้งหมดใน Phase 2</p>}
        </article>
      </section>

      <section className="stats-grid compact-stats" aria-label="สรุปผลการทำงาน">
        <article className="stat-card blue"><p>ผู้ติดตามเพิ่ม</p><strong>{performance.followersGained.toLocaleString("th-TH")}</strong><small>จากสถิติที่บันทึก</small></article>
        <article className="stat-card violet"><p>ยอดดู</p><strong>{performance.views.toLocaleString("th-TH")}</strong><small>{performance.engagements.toLocaleString("th-TH")} engagements</small></article>
        <article className="stat-card green"><p>คำสั่งซื้อ</p><strong>{performance.orders.toLocaleString("th-TH")}</strong><small>GMV ฿{performance.gmv.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</small></article>
        <article className="stat-card amber"><p>คอมมิชชัน</p><strong>฿{performance.commission.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong><small>{performance.postsPublished} โพสต์สำเร็จ</small></article>
      </section>

      <section className="dashboard-grid">
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">CATEGORY AFFINITY</p><h2>หมวดหมู่ที่เหมาะกับบัญชี</h2></div></div>{rankedAffinities.length ? <div className="data-list">{rankedAffinities.map((row) => <div key={row.id}><strong>{row.category_key}</strong><span>คะแนน {Math.round(Number(row.affinity_score ?? row.score) * 100)}%</span><small>ความมั่นใจ {Math.round(Number(row.confidence) * 100)}% · {row.sample_size} ตัวอย่าง</small></div>)}</div> : <p className="muted">ยังไม่มีข้อมูล affinity แบบ manual หรือจาก learning loop</p>}</article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">RECENT DAILY STATS</p><h2>14 วันล่าสุด</h2></div></div>{stats.length ? <div className="data-list">{stats.map((row) => <div key={row.id}><strong>{row.stat_date}</strong><span>+{row.followers_gained} followers</span><small>{row.views.toLocaleString("th-TH")} views · {row.orders} orders</small></div>)}</div> : <p className="muted">ยังไม่มีสถิติรายวันสำหรับบัญชีนี้</p>}</article>
      </section>
    </>
  );
}
