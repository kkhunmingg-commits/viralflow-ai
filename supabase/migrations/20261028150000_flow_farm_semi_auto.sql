-- Semi-auto clip pipeline: the owner's Google Flow accounts, the clips a one-click batch asks for,
-- and the library those clips wait in until the owner posts them by hand (or TikTok's API is approved).
-- Generation runs on the owner's own computer (workers/flow-browser/farm.mjs); this schema only
-- records what it was asked to make and what came back. Nothing here posts to TikTok.

-- Flow accounts in the order they are drained: the first is used until Flow says its credits are gone,
-- then the next. The browser profile for each lives only on the owner's computer, keyed by this id.
create table public.flow_accounts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 -- The TikTok account whose clips this Google account makes (at most 5 per TikTok account).
 -- Null = a shared account any TikTok account may use once its own accounts are out of credits.
 tiktok_account_id uuid,
 label text not null check(char_length(label) between 1 and 60),
 priority integer not null default 1 check(priority between 1 and 100),
 -- An estimate for planning only; the worker keeps going until Flow itself reports no credits.
 clips_per_day_estimate integer not null default 5 check(clips_per_day_estimate between 1 and 200),
 active boolean not null default true,
 -- Bangkok calendar day on which Flow reported this account out of credits.
 exhausted_on date,
 clips_today integer not null default 0 check(clips_today>=0),
 clips_today_on date,
 last_used_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 unique(owner_id,label),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
create index flow_accounts_owner_order on public.flow_accounts(owner_id,tiktok_account_id,priority,created_at);

create function private.limit_flow_accounts_per_tiktok() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.tiktok_account_id is not null and (select count(*) from public.flow_accounts
      where owner_id=new.owner_id and tiktok_account_id=new.tiktok_account_id and id<>new.id) >= 5 then
    raise exception 'FLOW_ACCOUNT_LIMIT_5';
  end if;
  return new;
end $$;
create trigger flow_accounts_limit before insert or update of tiktok_account_id on public.flow_accounts
 for each row execute function private.limit_flow_accounts_per_tiktok();
revoke all on function private.limit_flow_accounts_per_tiktok() from public,anon,authenticated;

-- When the owner's computer last asked for work, so the page can say whether the worker is running.
create table public.flow_worker_status (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 last_seen_at timestamptz not null default now(),
 note text check(note is null or char_length(note)<=300)
);

create table public.flow_clips (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null,
 batch_id uuid not null,
 product_id uuid,
 kind text not null check(kind in ('GROWTH','AFFILIATE')),
 title text not null check(char_length(title) between 1 and 200),
 prompt text not null check(char_length(prompt) between 1 and 12000),
 caption text not null check(char_length(caption) between 1 and 2200),
 hashtags jsonb not null default '[]' check(jsonb_typeof(hashtags)='array'),
 -- Private Storage path of the cleared product photo Flow uses as the ingredient image.
 reference_image_path text check(reference_image_path is null or reference_image_path like 'owner/'||owner_id::text||'/%'),
 status text not null default 'QUEUED' check(status in
   ('QUEUED','GENERATING','READY','SCHEDULED','POSTED','FAILED','SKIPPED_NO_CREDIT','DISCARDED')),
 flow_account_id uuid,
 lease_until timestamptz,
 error text check(error is null or char_length(error)<=500),
 storage_path text check(storage_path is null or storage_path like 'owner/'||owner_id::text||'/flow-clips/%'),
 video_sha256 text check(video_sha256 is null or video_sha256 ~ '^[0-9a-f]{64}$'),
 video_bytes integer check(video_bytes is null or video_bytes>0),
 duration_seconds numeric(8,3) check(duration_seconds is null or duration_seconds>0),
 width integer check(width is null or width>0), height integer check(height is null or height>0),
 ready_at timestamptz,
 scheduled_at timestamptz,
 posted_at timestamptz,
 post_url text check(post_url is null or post_url ~ '^https://(www\.|vm\.|vt\.)?tiktok\.com/'),
 -- The MP4 is removed from Storage once the clip is posted or discarded; the row stays as history.
 file_deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 foreign key(owner_id,product_id) references public.products(owner_id,id) on delete set null (product_id),
 foreign key(owner_id,flow_account_id) references public.flow_accounts(owner_id,id) on delete set null (flow_account_id),
 check(status not in ('READY','SCHEDULED') or (storage_path is not null and video_sha256 is not null and file_deleted_at is null)),
 check(status<>'SCHEDULED' or scheduled_at is not null),
 check(status<>'POSTED' or posted_at is not null)
);
create index flow_clips_queue on public.flow_clips(owner_id,status,created_at);
create index flow_clips_library on public.flow_clips(owner_id,tiktok_account_id,status,ready_at desc);
-- The same file is never put in the library twice.
create unique index flow_clips_unique_video on public.flow_clips(owner_id,video_sha256)
 where video_sha256 is not null and status not in ('FAILED','DISCARDED');

alter table public.flow_accounts enable row level security;
alter table public.flow_clips enable row level security;
alter table public.flow_worker_status enable row level security;
create policy flow_worker_status_read on public.flow_worker_status for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.flow_worker_status from public,anon,authenticated;
grant select on public.flow_worker_status to authenticated;
grant all on public.flow_worker_status to service_role;
create policy flow_accounts_read on public.flow_accounts for select to authenticated using(owner_id=(select auth.uid()));
create policy flow_clips_read on public.flow_clips for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.flow_accounts,public.flow_clips from public,anon,authenticated;
grant select on public.flow_accounts,public.flow_clips to authenticated;
grant all on public.flow_accounts,public.flow_clips to service_role;

/** Hands the oldest queued clip to the worker for one Flow account. Only the server (service role) calls it.
 *  A clip already GENERATING is never handed out again: a Generate click may have reached Google. */
create or replace function public.claim_flow_clip(p_owner uuid, p_flow_account uuid, p_lease_seconds integer default 1200)
returns setof public.flow_clips language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tiktok uuid;
begin
  select tiktok_account_id into v_tiktok from public.flow_accounts where owner_id=p_owner and id=p_flow_account and active;
  if not found then raise exception 'FLOW_ACCOUNT_UNAVAILABLE'; end if;
  -- A linked Google account only makes its own TikTok account's clips; a shared one makes anyone's.
  select id into v_id from public.flow_clips
   where owner_id=p_owner and status='QUEUED' and (v_tiktok is null or tiktok_account_id=v_tiktok)
   order by created_at, id limit 1 for update skip locked;
  if v_id is null then return; end if;
  update public.flow_accounts set last_used_at=now(), updated_at=now() where owner_id=p_owner and id=p_flow_account;
  return query update public.flow_clips set status='GENERATING', flow_account_id=p_flow_account,
    lease_until=now()+make_interval(secs=>greatest(60,least(p_lease_seconds,3600))), updated_at=now()
   where id=v_id returning *;
end $$;
revoke all on function public.claim_flow_clip(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_flow_clip(uuid,uuid,integer) to service_role;

/** Skips queued clips no Google account can make today: every active account that may make them is out of credits. */
create or replace function public.skip_unreachable_flow_clips(p_owner uuid, p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.flow_clips c set status='SKIPPED_NO_CREDIT', updated_at=now()
   where c.owner_id=p_owner and c.status='QUEUED' and not exists(
     select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active
       and (f.exhausted_on is null or f.exhausted_on<>p_today)
       and (f.tiktok_account_id is null or f.tiktok_account_id=c.tiktok_account_id))
     -- Only once at least one account was actually tried: no accounts at all is a setup problem, not "no credits".
     and exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active
       and (f.tiktok_account_id is null or f.tiktok_account_id=c.tiktok_account_id));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.skip_unreachable_flow_clips(uuid,date) from public,anon,authenticated;
grant execute on function public.skip_unreachable_flow_clips(uuid,date) to service_role;
