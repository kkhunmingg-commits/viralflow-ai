-- Phase 4: the owner's publish decision on banked clips, and owner-imported real results while
-- TikTok API access is pending. Imported rows are real reports from the owner's own dashboards and are
-- labelled as such; they never share a source value with MOCK or API rows.

-- Content bank: whether a clip may be exported for posting, and the evidence behind that.
alter table public.content_bank_items
  add column content_type text check(content_type in ('GROWTH','AFFILIATE')),
  add column publish_decision text not null default 'PENDING_REVIEW' check(publish_decision in ('PENDING_REVIEW','READY_TO_EXPORT','DO_NOT_PUBLISH')),
  add column publish_blockers jsonb not null default '[]' check(jsonb_typeof(publish_blockers)='array'),
  add column media_rights_evidence jsonb not null default '[]' check(jsonb_typeof(media_rights_evidence)='array'),
  add column creative_source text,
  add column external_post_url text check(external_post_url is null or external_post_url ~ '^https://(www\.|vm\.|vt\.)?tiktok\.com/'),
  add column external_video_id text check(external_video_id is null or external_video_id ~ '^[0-9]{8,25}$'),
  add column posted_at timestamptz,
  add column reviewed_at timestamptz;
update public.content_bank_items set publish_decision='DO_NOT_PUBLISH', publish_blockers='["MACHINE_REJECTED"]' where status='REJECTED';
-- A rejected clip is never exportable; a clip the system blocked (for example test media) stays blocked.
alter table public.content_bank_items add constraint content_bank_rejected_not_exportable
  check(status<>'REJECTED' or publish_decision='DO_NOT_PUBLISH');
create unique index content_bank_external_video on public.content_bank_items(owner_id,external_video_id) where external_video_id is not null;

/** The owner's own review: only PENDING_REVIEW moves, and only the item's owner can move it. */
create or replace function public.review_content_bank_item(p_item uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_decision text;
begin
  update public.content_bank_items set publish_decision = case when p_approve then 'READY_TO_EXPORT' else 'DO_NOT_PUBLISH' end,
    owner_review = case when p_approve then 'APPROVED' else 'REJECTED' end,
    publish_blockers = case when p_approve then publish_blockers else publish_blockers || '["OWNER_DECLINED"]'::jsonb end,
    reviewed_at = now(), updated_at = now()
  where id = p_item and owner_id = (select auth.uid()) and publish_decision = 'PENDING_REVIEW' and status = 'ACCEPTED'
  returning publish_decision into v_decision;
  if v_decision is null then raise exception 'BANK_ITEM_NOT_REVIEWABLE'; end if;
  return v_decision;
end $$;
revoke all on function public.review_content_bank_item(uuid, boolean) from public, anon;
grant execute on function public.review_content_bank_item(uuid, boolean) to authenticated;

/** The owner says where they posted an exported clip, so imported results can be tied back to it. */
create or replace function public.record_content_bank_post(p_item uuid, p_url text, p_posted_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_video text := substring(p_url from '/video/([0-9]{8,25})');
begin
  update public.content_bank_items set status = 'POSTED', external_post_url = p_url, external_video_id = v_video,
    posted_at = p_posted_at, updated_at = now()
  where id = p_item and owner_id = (select auth.uid()) and publish_decision = 'READY_TO_EXPORT' and status in ('ACCEPTED','EXPORTED')
    and p_posted_at <= now() + interval '5 minutes'
  returning id into v_id;
  if v_id is null then raise exception 'BANK_ITEM_NOT_POSTABLE'; end if;
  return v_id;
end $$;
revoke all on function public.record_content_bank_post(uuid, text, timestamptz) from public, anon;
grant execute on function public.record_content_bank_post(uuid, text, timestamptz) to authenticated;

-- Each imported file, so the same export is not counted twice and every row can be traced to its file.
create table public.performance_import_batches (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null,
 kind text not null check(kind in ('VIDEO_PERFORMANCE','AFFILIATE_ORDERS')),
 file_name text not null check(char_length(file_name) between 1 and 300),
 file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'),
 report_format text not null,
 rows_read integer not null check(rows_read>=0), rows_imported integer not null check(rows_imported>=0),
 rows_linked integer not null default 0 check(rows_linked>=0),
 rejections jsonb not null default '[]' check(jsonb_typeof(rejections)='array'),
 imported_at timestamptz not null default now(),
 unique(owner_id,id),
 unique(owner_id,tiktok_account_id,kind,file_sha256),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
alter table public.performance_import_batches enable row level security;
create policy performance_import_batches_read on public.performance_import_batches for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.performance_import_batches from public,anon,authenticated;
grant select on public.performance_import_batches to authenticated;
grant all on public.performance_import_batches to service_role;

-- Video results: owner-imported reports get their own source and the metrics TikTok Studio exports.
alter table public.video_analytics_snapshots drop constraint video_analytics_snapshots_source_check;
alter table public.video_analytics_snapshots add constraint video_analytics_snapshots_source_check
  check(source in ('MOCK','TIKTOK_DISPLAY','TIKTOK_SHOP_ANALYTICS','OWNER_REPORT_IMPORT'));
alter table public.video_analytics_snapshots
  add column new_followers bigint check(new_followers is null or new_followers>=0),
  add column average_watch_seconds numeric(10,2) check(average_watch_seconds is null or average_watch_seconds>=0),
  add column full_watch_rate numeric(6,5) check(full_watch_rate is null or full_watch_rate between 0 and 1),
  add column import_batch_id uuid,
  add constraint video_analytics_import_batch foreign key(owner_id,import_batch_id) references public.performance_import_batches(owner_id,id) on delete cascade,
  add constraint video_analytics_import_has_batch check((source='OWNER_REPORT_IMPORT')=(import_batch_id is not null));

-- Affiliate orders: which channel earned them, so VIDEO and LIVE revenue are never counted twice.
alter table public.affiliate_conversion_events
  add column channel text not null default 'UNKNOWN' check(channel in ('VIDEO','LIVE','SHOWCASE','UNKNOWN')),
  add column import_batch_id uuid,
  add constraint affiliate_conversion_import_batch foreign key(owner_id,import_batch_id) references public.performance_import_batches(owner_id,id) on delete cascade,
  add constraint affiliate_conversion_import_has_batch check((source='OWNER_REPORT_IMPORT')=(import_batch_id is not null));
create index affiliate_conversion_channel_idx on public.affiliate_conversion_events(owner_id,tiktok_account_id,channel,occurred_at desc);
