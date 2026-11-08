-- Lucky, 8 Nov: every signed-in Google account works for all three clip modes (promo clips, product clips from a
-- link, drama series). Before this, a promo or product clip could only be made by a Google account linked to that
-- clip's TikTok channel, and repair accounts made drama shots only.
--
-- Now one shared pool:
--   * A drama shot still names its account (the drama picker chooses: a full account for a new episode, a part-used
--     one for a remake) and is handed out first, as before.
--   * A promo or product clip may be made by ANY switched-on Google account, the channel's own accounts first
--     (the worker drains linked accounts first and each account takes its own channel's clips first).
--   * Shared quota: an account keeps back the shots the drama episode it is making still needs, and while a drama
--     episode is due today and has no account yet, the accounts that could still make a whole episode on their own
--     are kept for drama instead of being nibbled by promo clips. Promo clips use the rest.
--
-- flow_pool_status(owner) is the one place this is worked out: the claim uses it, and every clip page shows it.

create or replace function public.flow_pool_status(p_owner uuid)
returns table(flow_account_id uuid, label text, purpose text, tiktok_account_id uuid, active boolean, exhausted_today boolean,
  per_day integer, used_today integer, left_today integer, drama_reserved integer, free_today integer,
  drama_waiting integer, episode_shots integer, open_clip boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_today date := (now() at time zone 'Asia/Bangkok')::date; v_waiting integer; v_shots integer;
begin
  -- Drama episodes that still need an account today: open episodes no clip went to yet, plus series due to start one.
  select count(*), coalesce(max(x.shots), 4) into v_waiting, v_shots from (
    select s.shots_per_episode as shots from public.drama_episodes e join public.drama_series s on s.id=e.series_id
     where e.owner_id=p_owner and e.status='PRODUCING' and s.status='ACTIVE'
       and not exists(select 1 from public.flow_clips c where c.owner_id=p_owner and c.batch_id=e.id and c.kind='DRAMA_SHOT'
         and c.status<>'SKIPPED_NO_CREDIT')
    union all
    select s.shots_per_episode from public.drama_series s
     where s.owner_id=p_owner and s.status='ACTIVE' and s.next_episode_number<=s.total_episodes and (s.redo_on is null or s.redo_on<=v_today)
       and not exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.review<>'REJECTED'
         and (e.status<>'READY' or e.started_on=v_today or e.review<>'APPROVED'))
       and not (s.previous_series_id is not null and s.next_episode_number=1 and (s.created_at at time zone 'Asia/Bangkok')::date=v_today)
  ) x;

  return query
  with base as (
    select f.id, f.label, f.purpose, f.tiktok_account_id as tiktok, f.active, coalesce(f.exhausted_on=v_today, false) as exhausted,
      greatest(1, f.clips_per_day_estimate) as per_day, case when f.clips_today_on=v_today then f.clips_today else 0 end as used,
      -- Shots still to make in open drama episodes whose latest clip went to this account.
      (select count(*)::integer from public.drama_shots sh join public.drama_episodes e on e.id=sh.episode_id
        where sh.owner_id=p_owner and e.status='PRODUCING' and sh.status in ('PLANNED','QUEUED')
          and (select coalesce(c.flow_account_id, c.required_flow_account_id) from public.flow_clips c
                where c.owner_id=p_owner and c.batch_id=e.id and c.kind='DRAMA_SHOT' and c.status<>'SKIPPED_NO_CREDIT'
                order by c.created_at desc limit 1)=f.id) as reserved
    from public.flow_accounts f where f.owner_id=p_owner
  ), room as (
    select b.*, case when not b.active or b.exhausted then 0 else greatest(0, b.per_day-b.used) end as lft from base b
  ), pool as (
    select r.*, greatest(0, r.lft-r.reserved) as free from room r
  ), capable as (select count(*)::integer as n from pool where active and free>=v_shots)
  select p.id, p.label, p.purpose, p.tiktok, p.active, p.exhausted, p.per_day, p.used, p.lft, p.reserved, p.free,
    v_waiting, v_shots,
    -- May this account take a promo / product clip right now?
    (p.active and not p.exhausted
      and not (p.reserved>0 and p.free<=0)
      and not (v_waiting>0 and p.free>=v_shots and (select n from capable)<=v_waiting))
  from pool p;
end $$;
revoke all on function public.flow_pool_status(uuid) from public,anon,authenticated;
grant execute on function public.flow_pool_status(uuid) to service_role;

/**
 * Hands the next queued clip this Google account may make to the worker. Clips that name an account (drama shots) go
 * only to that account, and first. Any other clip may go to any account of the owner that flow_pool_status allows,
 * the account's own channel's clips first.
 */
create or replace function public.claim_flow_clip(p_owner uuid, p_flow_account uuid, p_lease_seconds integer default 1200)
returns setof public.flow_clips language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tiktok uuid; v_shooting boolean; v_today date; v_open boolean;
begin
  select tiktok_account_id into v_tiktok from public.flow_accounts where owner_id=p_owner and id=p_flow_account and active;
  if not found then raise exception 'FLOW_ACCOUNT_UNAVAILABLE'; end if;
  v_today := (now() at time zone 'Asia/Bangkok')::date;
  -- Older series that still name a fixed main account keep it for their episode while it is due (as before).
  v_shooting := exists(select 1 from public.drama_series s
    where s.owner_id=p_owner and s.flow_account_id=p_flow_account and s.status='ACTIVE' and (
      exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.status='PRODUCING')
      or (s.next_episode_number<=s.total_episodes and (s.redo_on is null or s.redo_on<=v_today)
        and not exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.review<>'REJECTED'
          and (e.status<>'READY' or e.started_on=v_today or e.review<>'APPROVED')))));
  select ps.open_clip into v_open from public.flow_pool_status(p_owner) ps where ps.flow_account_id=p_flow_account;
  select id into v_id from public.flow_clips
   where owner_id=p_owner and status='QUEUED'
     and (required_flow_account_id=p_flow_account
       or (required_flow_account_id is null and not v_shooting and coalesce(v_open, false)))
   order by (required_flow_account_id is not null) desc, (tiktok_account_id is not distinct from v_tiktok) desc, created_at, id
   limit 1 for update skip locked;
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
       -- Any switched-on account of the owner may make it now, so it is skipped only when every one is out.
       and not exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active
         and (f.exhausted_on is null or f.exhausted_on<>p_today))
       and exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active)));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.skip_unreachable_flow_clips(uuid,date) from public,anon,authenticated;
grant execute on function public.skip_unreachable_flow_clips(uuid,date) to service_role;
