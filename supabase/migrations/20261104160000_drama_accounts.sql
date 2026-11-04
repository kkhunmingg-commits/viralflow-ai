-- Drama Studio 2: every series is made by its own Google (Flow) account, with a second "repair" account that
-- remakes any shot that failed or did not pass the server's checks. Additive: existing series keep working unrouted.

-- A clip may name the one Google account allowed to make it (drama shots do; growth and affiliate clips do not).
alter table public.flow_clips add column required_flow_account_id uuid;
alter table public.flow_clips add constraint flow_clips_required_account_fkey
  foreign key(owner_id,required_flow_account_id) references public.flow_accounts(owner_id,id) on delete set null (required_flow_account_id);
create index flow_clips_required_queue on public.flow_clips(owner_id,required_flow_account_id) where status='QUEUED';

alter table public.drama_series add column flow_account_id uuid;
alter table public.drama_series add column repair_flow_account_id uuid;
-- The series this one follows when the previous story ended and a new one in the same genre started by itself.
alter table public.drama_series add column previous_series_id uuid;
alter table public.drama_series add column auto_next boolean not null default true;
alter table public.drama_series add constraint drama_series_flow_account_fkey
  foreign key(owner_id,flow_account_id) references public.flow_accounts(owner_id,id) on delete set null (flow_account_id);
alter table public.drama_series add constraint drama_series_repair_account_fkey
  foreign key(owner_id,repair_flow_account_id) references public.flow_accounts(owner_id,id) on delete set null (repair_flow_account_id);
alter table public.drama_series add constraint drama_series_previous_fkey
  foreign key(owner_id,previous_series_id) references public.drama_series(owner_id,id) on delete set null (previous_series_id);
alter table public.drama_series add constraint drama_series_repair_differs check(repair_flow_account_id is null or repair_flow_account_id is distinct from flow_account_id);
-- One running story per Google account: its daily credits are exactly one episode.
create unique index drama_series_one_per_account on public.drama_series(flow_account_id) where status in ('ACTIVE','PAUSED') and flow_account_id is not null;

-- Which account the shot is (or was last) queued on.
alter table public.drama_shots add column route text not null default 'PRIMARY' check(route in ('PRIMARY','REPAIR'));

/**
 * Hands the oldest queued clip this Google account may make to the worker. Clips that name an account go only to
 * that account, and first. An account that is the main account of a running drama makes nothing else.
 */
create or replace function public.claim_flow_clip(p_owner uuid, p_flow_account uuid, p_lease_seconds integer default 1200)
returns setof public.flow_clips language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tiktok uuid; v_dedicated boolean;
begin
  select tiktok_account_id into v_tiktok from public.flow_accounts where owner_id=p_owner and id=p_flow_account and active;
  if not found then raise exception 'FLOW_ACCOUNT_UNAVAILABLE'; end if;
  v_dedicated := exists(select 1 from public.drama_series s where s.owner_id=p_owner and s.flow_account_id=p_flow_account and s.status='ACTIVE');
  -- A linked Google account only makes its own TikTok account's clips; a shared one makes anyone's.
  select id into v_id from public.flow_clips
   where owner_id=p_owner and status='QUEUED'
     and (required_flow_account_id=p_flow_account
       or (required_flow_account_id is null and not v_dedicated and (v_tiktok is null or tiktok_account_id=v_tiktok)))
   order by (required_flow_account_id is not null) desc, created_at, id limit 1 for update skip locked;
  if v_id is null then return; end if;
  update public.flow_accounts set last_used_at=now(), updated_at=now() where owner_id=p_owner and id=p_flow_account;
  return query update public.flow_clips set status='GENERATING', flow_account_id=p_flow_account,
    lease_until=now()+make_interval(secs=>greatest(60,least(p_lease_seconds,3600))), updated_at=now()
   where id=v_id returning *;
end $$;
revoke all on function public.claim_flow_clip(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_flow_clip(uuid,uuid,integer) to service_role;

/** Skips queued clips no Google account can make today. A clip naming an account waits only on that account. */
create or replace function public.skip_unreachable_flow_clips(p_owner uuid, p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.flow_clips c set status='SKIPPED_NO_CREDIT', updated_at=now()
   where c.owner_id=p_owner and c.status='QUEUED' and (
     (c.required_flow_account_id is not null and not exists(
       select 1 from public.flow_accounts f where f.owner_id=p_owner and f.id=c.required_flow_account_id and f.active
         and (f.exhausted_on is null or f.exhausted_on<>p_today)))
     or (c.required_flow_account_id is null
       and not exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active
         and (f.exhausted_on is null or f.exhausted_on<>p_today)
         and (f.tiktok_account_id is null or f.tiktok_account_id=c.tiktok_account_id)
         and not exists(select 1 from public.drama_series s where s.owner_id=p_owner and s.flow_account_id=f.id and s.status='ACTIVE'))
       -- Only once at least one account was actually tried: no accounts at all is a setup problem, not "no credits".
       and exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active
         and (f.tiktok_account_id is null or f.tiktok_account_id=c.tiktok_account_id)
         and not exists(select 1 from public.drama_series s where s.owner_id=p_owner and s.flow_account_id=f.id and s.status='ACTIVE'))));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.skip_unreachable_flow_clips(uuid,date) from public,anon,authenticated;
grant execute on function public.skip_unreachable_flow_clips(uuid,date) to service_role;
