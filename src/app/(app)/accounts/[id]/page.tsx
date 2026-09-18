import type { Metadata } from "next";
import Image from "next/image";
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
import { disconnectTikTokAccount, refreshTikTokCreatorInfo } from "../tiktok-actions";
import {getCommerceAccount} from "@/features/commerce/services";

export const metadata: Metadata = { title: "รายละเอียดบัญชี" };

const blockerLabels: Record<ReadinessBlockerCode, string> = {
  FOLLOWERS_BELOW_1000: "ผู้ติดตามยังไม่ถึง 1,000 คน",
  SHOP_CREATOR_NOT_ELIGIBLE: "ยังไม่มีสิทธิ์ TikTok Shop Creator",
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

  const { account, stats, affinities, publishHealth, latestEligibility } = await getAccountDetailData(supabase, ownerId, id);
  if (!account) notFound();
  const { data: publishingRows } = await supabase.from("publishing_queue").select("status").eq("owner_id", ownerId).eq("tiktok_account_id", id);
  const recommendations = await getRecommendationData(supabase, ownerId);
  const commerce=await getCommerceAccount(supabase,ownerId,id);

  const readiness = getAccountAffiliateReadiness(account);
  const performance = getAccountPerformanceSummary(stats);
  const rankedAffinities = getAccountCategoryAffinity(affinities);

  return (
    <>
      <section className="panel radar-section"><h2>Recommended Products Today</h2><RecommendationTable input={recommendations.input} scores={getRecommendationsForAccount(recommendations.plan,id).map(a=>a.score)}/></section>
      <PageHeading eyebrow="ACCOUNT DETAIL" title={account.display_name} description={`${account.username ? `@${account.username}` : "ยังไม่มี creator username"} · ข้อมูลจริงจาก Supabase`} action={<Link className="secondary-action" href="/accounts">← กลับหน้าบัญชี</Link>} />

      <section className="panel radar-section">
        <div className="panel-heading">
          <div><p className="eyebrow">TIKTOK CONNECTION</p><h2>{account.connection_status ?? "DISCONNECTED"}</h2></div>
          <div className="badge-group"><span className="status-badge ready">Direct Post: {account.direct_post_status ?? "UNAVAILABLE"}</span><span className="status-badge ready">Upload: {account.upload_status ?? "UNAVAILABLE"}</span></div>
        </div>
        <div className="detail-summary-grid">
          <article className="detail-account-card">
            <div className="account-card-top">
              {account.avatar_url ? <Image className="account-avatar large" src={account.avatar_url} alt={account.display_name} width={56} height={56} unoptimized /> : <span className="account-avatar large">{account.display_name.slice(0, 1)}</span>}
              <div><strong>{account.display_name}</strong><p>{account.username ? `@${account.username}` : "username จะได้จาก creator_info เมื่อมี video.publish"}</p></div>
            </div>
            <dl className="detail-list">
              <div><dt>Authorization</dt><dd>{account.authorization_status}</dd></div>
              <div><dt>Token expiry</dt><dd>{account.token_expires_at ? new Date(account.token_expires_at).toLocaleString("th-TH") : "ไม่มี active token"}</dd></div>
              <div><dt>Creator sync</dt><dd>{account.creator_info_sync_at ? new Date(account.creator_info_sync_at).toLocaleString("th-TH") : "ยังไม่ sync"}</dd></div>
              <div><dt>Audit</dt><dd>{account.audit_status ?? "UNAUDITED"}</dd></div>
              <div><dt>Max video</dt><dd>{account.creator_max_video_duration ? `${account.creator_max_video_duration} วินาที` : "ยังไม่มีข้อมูล"}</dd></div>
            </dl>
          </article>
          <article>
            <dl className="detail-list">
              <div><dt>Scopes granted</dt><dd>{account.granted_scopes?.join(", ") || "ไม่มี"}</dd></div>
              <div><dt>Scopes missing</dt><dd>{account.missing_scopes?.join(", ") || "ไม่มี"}</dd></div>
              <div><dt>Privacy options</dt><dd>{account.privacy_level_options?.join(", ") || "ยังไม่มีข้อมูล"}</dd></div>
              <div><dt>Comments / Duet / Stitch</dt><dd>{[account.comment_disabled, account.duet_disabled, account.stitch_disabled].map((disabled) => disabled === null || disabled === undefined ? "?" : disabled ? "ปิด" : "เปิด").join(" / ")}</dd></div>
              <div><dt>App approval</dt><dd>publish {account.video_publish_approval_status ?? "UNKNOWN"} · upload {account.video_upload_approval_status ?? "UNKNOWN"}</dd></div>
              <div><dt>Last error</dt><dd>{account.last_auth_error ?? account.last_sync_error ?? "ไม่มี"}</dd></div>
            </dl>
            <div className="form-actions">
              <Link className="secondary-action" href="/accounts/connect/tiktok">Reconnect</Link>
              {account.granted_scopes?.includes("video.publish") ? <form action={refreshTikTokCreatorInfo.bind(null, account.id)}><button className="secondary-action">Refresh creator_info</button></form> : null}
              {account.open_id && account.connection_status !== "DISCONNECTED" ? <form action={disconnectTikTokAccount.bind(null, account.id)}><button className="danger-action">Disconnect</button></form> : null}
            </div>
          </article>
        </div>
      </section>
      <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">SHOP & AFFILIATE COMMERCE</p><h2>{commerce?.account.commerce_profile?.commerce_status??"NOT_SYNCED"}</h2></div><Link href={`/commerce/accounts/${id}`}>เปิด Commerce detail →</Link></div><dl className="detail-list"><div><dt>Shop connection</dt><dd>{commerce?.account.connection?.authorization_status??"NOT_CONNECTED"}</dd></div><div><dt>Affiliate eligibility</dt><dd>{commerce?.account.commerce_profile?.affiliate_eligible?"ELIGIBLE":"NOT ELIGIBLE"}</dd></div><div><dt>Ecommerce permission</dt><dd>{account.ecommerce_permission===true?"YES":"NO"}</dd></div><div><dt>Cart permission</dt><dd>{account.cart_enabled===true?"YES":"NO"}</dd></div><div><dt>Effective mode</dt><dd>{account.mode} → {account.effective_mode}</dd></div><div><dt>Product attach readiness</dt><dd>{commerce?.account.commerce_profile?.attachment_available?"READY":"BLOCKED"}</dd></div><div><dt>Commerce blockers</dt><dd>{((commerce?.account.commerce_profile?.blockers_json??[]) as string[]).join(", ")||"ไม่มี"}</dd></div><div><dt>Last sync</dt><dd>{commerce?.account.connection?.last_synced_at?new Date(commerce.account.connection.last_synced_at).toLocaleString("th-TH"):"ยังไม่ sync"}</dd></div></dl></section>
      <section className="panel radar-section">
        <div className="panel-heading"><div><p className="eyebrow">PUBLISHING QUEUE</p><h2>{publishingRows?.length ?? 0} รายการ</h2></div><Link href="/publishing">เปิดคิว →</Link></div>
        <dl className="detail-list">
          <div><dt>Awaiting review</dt><dd>{(publishingRows ?? []).filter(row => ["DRAFT", "REVIEW_REQUIRED"].includes(row.status)).length}</dd></div>
          <div><dt>Active</dt><dd>{(publishingRows ?? []).filter(row => ["APPROVED", "QUEUED", "UPLOADING", "PROCESSING", "RETRYING"].includes(row.status)).length}</dd></div>
          <div><dt>Waiting for slot</dt><dd>{(publishingRows ?? []).filter(row => row.status === "WAITING_FOR_SLOT").length}</dd></div>
          <div><dt>Draft delivered / published</dt><dd>{(publishingRows ?? []).filter(row => ["DRAFT_DELIVERED", "PUBLISHED"].includes(row.status)).length}</dd></div>
        </dl>
      </section>

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

      <section className="panel radar-section">
        <div className="panel-heading"><div><p className="eyebrow">ACCOUNT HEALTH & ELIGIBILITY</p><h2>{publishHealth?.health_status??"NOT CHECKED"}</h2></div><span className="phase-chip">LOCAL STATE</span></div>
        {publishHealth?<dl className="detail-list">
          <div><dt>Mode</dt><dd>{publishHealth.requested_mode} → {publishHealth.effective_mode}</dd></div>
          <div><dt>Effective Publish Cap</dt><dd>{publishHealth.effective_publish_cap}</dd></div>
          <div><dt>Used Slots</dt><dd>{publishHealth.posts_today}</dd></div>
          <div><dt>Remaining Slots</dt><dd>{Math.max(0,publishHealth.effective_publish_cap-publishHealth.posts_today)}</dd></div>
          <div><dt>Eligibility</dt><dd>{latestEligibility?.final_status??"NOT CHECKED"}</dd></div>
          <div><dt>Authorization</dt><dd>{publishHealth.authorization_status}</dd></div>
          <div><dt>Blockers</dt><dd>{([...(publishHealth.blockers_json as string[]),...((latestEligibility?.blockers_json??[]) as string[])]).filter((value,index,values)=>values.indexOf(value)===index).join(", ")||"ไม่มี"}</dd></div>
        </dl>:<p className="muted">ข้อมูลจะถูกคำนวณเมื่อวิดีโอเข้าสู่ pre-publish gate โดยยังไม่เรียก TikTok API</p>}
      </section>

      <section className="dashboard-grid">
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">CATEGORY AFFINITY</p><h2>หมวดหมู่ที่เหมาะกับบัญชี</h2></div></div>{rankedAffinities.length ? <div className="data-list">{rankedAffinities.map((row) => <div key={row.id}><strong>{row.category_key}</strong><span>คะแนน {Math.round(Number(row.affinity_score ?? row.score) * 100)}%</span><small>ความมั่นใจ {Math.round(Number(row.confidence) * 100)}% · {row.sample_size} ตัวอย่าง</small></div>)}</div> : <p className="muted">ยังไม่มีข้อมูล affinity แบบ manual หรือจาก learning loop</p>}</article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">RECENT DAILY STATS</p><h2>14 วันล่าสุด</h2></div></div>{stats.length ? <div className="data-list">{stats.map((row) => <div key={row.id}><strong>{row.stat_date}</strong><span>+{row.followers_gained} followers</span><small>{row.views.toLocaleString("th-TH")} views · {row.orders} orders</small></div>)}</div> : <p className="muted">ยังไม่มีสถิติรายวันสำหรับบัญชีนี้</p>}</article>
      </section>
    </>
  );
}
