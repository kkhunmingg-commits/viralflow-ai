-- Content bank: masters the system accepted (or refused) for posting, with the evidence for that call.
-- It sits on top of master_videos and the manual-post export; it never posts by itself.
create table public.content_bank_items (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null,
 master_video_id uuid not null,
 status text not null default 'ACCEPTED' check(status in ('ACCEPTED','REJECTED','EXPORTED','QUEUED_FOR_API','POSTED','WITHDRAWN')),
 -- Machine acceptance is not the owner's review; the owner still approves before anything is posted.
 owner_review text not null default 'PENDING' check(owner_review in ('PENDING','APPROVED','REJECTED')),
 rejection_reasons jsonb not null default '[]' check(jsonb_typeof(rejection_reasons)='array'),
 acceptance_checks jsonb not null default '[]' check(jsonb_typeof(acceptance_checks)='array'),
 video_sha256 text not null check(video_sha256 ~ '^[0-9a-f]{64}$'),
 creative_fingerprint text not null check(creative_fingerprint ~ '^[0-9a-f]{64}$'),
 caption text not null check(char_length(caption) between 1 and 2200),
 hashtags jsonb not null default '[]' check(jsonb_typeof(hashtags)='array'),
 story_format text, topic text,
 -- Billed spend and machine-time estimates are kept apart; an estimate is never reported as spend.
 cost_actual_usd numeric(12,4) not null default 0 check(cost_actual_usd>=0),
 cost_estimated_thb numeric(12,4) check(cost_estimated_thb>=0),
 cost_basis text not null,
 render_seconds numeric(10,2) check(render_seconds>=0), peak_rss_mb numeric(10,1) check(peak_rss_mb>=0),
 planned_slot_at timestamptz,
 slot_basis text check(slot_basis in ('AUDIENCE_DATA','DEFAULT_NO_DATA')),
 posting_route text not null default 'MANUAL_EXPORT' check(posting_route in ('MANUAL_EXPORT','AUTO_API')),
 publishing_queue_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 unique(owner_id,master_video_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 foreign key(owner_id,master_video_id) references public.master_videos(owner_id,id) on delete cascade
);
-- The same file or the same story must not be banked twice for one account.
create unique index content_bank_unique_video on public.content_bank_items(owner_id,tiktok_account_id,video_sha256) where status<>'REJECTED';
create unique index content_bank_unique_story on public.content_bank_items(owner_id,tiktok_account_id,creative_fingerprint) where status<>'REJECTED';
create index content_bank_account_slots on public.content_bank_items(owner_id,tiktok_account_id,planned_slot_at);

alter table public.content_bank_items enable row level security;
create policy content_bank_items_read on public.content_bank_items for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.content_bank_items from public,anon,authenticated;
grant select on public.content_bank_items to authenticated;
grant all on public.content_bank_items to service_role;
