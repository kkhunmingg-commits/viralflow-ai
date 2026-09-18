import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { getPublishingDetail } from "@/features/publishing/services";
import { createClient } from "@/lib/supabase/server";
import { cancelPublishAction, consentPublishAction, createShoppableIntentAction, fetchPublishStatusAction, preparePublishAction, retryPublishAction, schedulePublishAction, sendPublishAction } from "../actions";

export default async function PublishingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");
  let detail; try { detail = await getPublishingDetail(client, data.user.id, id); } catch { return notFound(); }
  const { queue, account, attempts, events, consents,intents,shopProducts } = detail;
  const canCancel = !["UPLOADING", "PROCESSING", "DRAFT_DELIVERED", "PUBLISHED", "CANCELLED"].includes(queue.status);
  return <>
    <PageHeading eyebrow="PUBLISHING DETAIL" title={`${account.display_name} · ${queue.publish_mode}`} description={`สถานะ ${queue.status} · ${queue.source_method}`} action={<Link className="secondary-action" href="/publishing">← Publishing Queue</Link>} />
    <section className="detail-summary-grid">
      <article className="panel"><h2>Pre-publish state</h2><dl className="detail-list">
        <div><dt>Status</dt><dd>{queue.status}</dd></div><div><dt>Connection</dt><dd>{account.connection_status}</dd></div>
        <div><dt>Scope</dt><dd>{queue.publish_mode === "DIRECT_POST" ? "video.publish" : "video.upload"}</dd></div>
        <div><dt>Audit / privacy</dt><dd>{account.audit_status} / {queue.privacy_level ?? "REQUIRED"}</dd></div>
        <div><dt>Phase 6C evidence</dt><dd>{queue.eligibility_check_id ? "REFRESHED" : "NOT READY"}</dd></div>
        <div><dt>Consent</dt><dd>{queue.consent_id ? "RECORDED" : "REQUIRED"}</dd></div>
        <div><dt>Provider</dt><dd>{queue.provider_publish_id ?? "NOT SENT"}</dd></div>
        <div><dt>Retry</dt><dd>{queue.retry_count} / {queue.max_retries}</dd></div>
      </dl></article>
      <article className="panel"><h2>Controls</h2><div className="video-actions">
        {queue.status === "REVIEW_REQUIRED" && !queue.eligibility_check_id ? <form action={preparePublishAction.bind(null, id)}><button className="secondary-action">REFRESH CHECKS</button></form> : null}
        {queue.status === "REVIEW_REQUIRED" ? <form className="account-form" action={consentPublishAction.bind(null, id)}>
          <label>Caption<textarea name="caption" maxLength={2200} defaultValue={queue.caption_snapshot} /></label>
          <label>Privacy<select name="privacy_level" defaultValue={queue.privacy_level ?? "SELF_ONLY"}>{(account.privacy_level_options as string[]).map((option: string) => <option key={option}>{option}</option>)}</select></label>
          <label><input name="allow_comment" type="checkbox" defaultChecked={!account.comment_disabled} /> Allow comments</label>
          <label><input name="allow_duet" type="checkbox" defaultChecked={!account.duet_disabled} /> Allow duet</label>
          <label><input name="allow_stitch" type="checkbox" defaultChecked={!account.stitch_disabled} /> Allow stitch</label>
          <label><input name="is_aigc" type="checkbox" defaultChecked={queue.is_aigc} /> AI-generated content</label>
          <label><input name="brand_organic_toggle" type="checkbox" /> Own brand promotion</label>
          <label><input name="brand_content_toggle" type="checkbox" /> Branded content</label>
          <button className="primary-action">I CONSENT TO SEND TO TIKTOK</button>
        </form> : null}
        {["APPROVED", "QUEUED", "RETRYING"].includes(queue.status) ? <form action={sendPublishAction.bind(null, id, queue.publish_mode)}><button className="primary-action">{queue.publish_mode === "DIRECT_POST" ? "DIRECT POST" : "UPLOAD DRAFT"}</button></form> : null}
        {queue.status === "APPROVED" ? <form className="account-form" action={schedulePublishAction.bind(null, id)}><label>Schedule<input name="scheduled_for" type="datetime-local" required /></label><button className="secondary-action">SCHEDULE</button></form> : null}
        {queue.provider_publish_id && ["PROCESSING", "UPLOADING"].includes(queue.status) ? <form action={fetchPublishStatusAction.bind(null, id)}><button className="secondary-action">REFRESH STATUS</button></form> : null}
        {["FAILED", "RETRYING"].includes(queue.status) && queue.retry_count < queue.max_retries ? <form action={retryPublishAction.bind(null, id)}><button className="secondary-action">RETRY</button></form> : null}
        {canCancel ? <form action={cancelPublishAction.bind(null, id)}><button className="danger-action">CANCEL</button></form> : null}
      </div></article>
    </section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">SHOPPABLE CONTENT INTENT</p><h2>{intents[0]?.status??"NOT REQUESTED"}</h2></div><Link href={`/commerce/accounts/${account.id}`}>Commerce profile →</Link></div>
      {intents[0]?<dl className="detail-list"><div><dt>Product truth</dt><dd>{intents[0].product_truth_status}</dd></div><div><dt>Intent only</dt><dd>ไม่มีการ attach สินค้าจริงใน Phase 7C</dd></div><div><dt>Blockers</dt><dd>{(intents[0].blockers_json as string[]).join(", ")||"ไม่มี"}</dd></div></dl>:shopProducts.length?<form className="account-form" action={createShoppableIntentAction.bind(null,id)}><label>Shop product<select name="shop_product_id" required>{shopProducts.map(product=><option key={product.id} value={product.id}>{product.title} · {product.region}</option>)}</select></label><button className="secondary-action">BUILD SHOPPABLE INTENT</button></form>:<p className="muted">ไม่มี Shop product ที่ active และ approved สำหรับบัญชีนี้</p>}
    </section>
    <section className="panel radar-section"><div className="panel-heading"><div><p className="eyebrow">APPEND-ONLY AUDIT</p><h2>Status history</h2></div></div><div className="data-list">{events.map(event => <div key={event.id}><strong>{event.from_status ?? "—"} → {event.to_status}</strong><span>{event.source}</span><small>{new Date(event.occurred_at).toLocaleString("th-TH")} · {event.reason_code ?? event.provider_status ?? "state change"}</small></div>)}</div></section>
    <section className="detail-summary-grid"><article className="panel"><h2>Attempts</h2>{attempts.length ? attempts.map(attempt => <p key={attempt.id}>{attempt.operation} #{attempt.attempt_number} · {attempt.status} · {attempt.error_code ?? "OK"}</p>) : <p className="muted">ยังไม่มี provider attempt</p>}</article><article className="panel"><h2>Consent snapshots</h2>{consents.length ? consents.map(consent => <p key={consent.id}>v{consent.consent_version} · {consent.privacy_level ?? "draft"} · {new Date(consent.consented_at).toLocaleString("th-TH")}</p>) : <p className="muted">ยังไม่มี explicit consent</p>}</article></section>
  </>;
}
