-- Drama Studio 2.1: a drama's main Google account keeps making normal clips (it is locked to one story, not to
-- drama only), and repair accounts are their own kind of Google account, added in the drama tab.

-- CLIP: linked in the clip tab, makes normal clips and can be a drama's main account.
-- REPAIR: added in the drama tab, shared by every series, makes only the drama shots sent to it.
alter table public.flow_accounts add column purpose text not null default 'CLIP' check(purpose in ('CLIP','REPAIR'));
alter table public.flow_accounts add constraint flow_accounts_repair_unlinked check(purpose='CLIP' or tiktok_account_id is null);

/**
 * Hands the oldest queued clip this Google account may make to the worker. Clips that name an account go only to
 * that account, and first. A drama's main account makes that day's episode first, so the drama gets its credits
 * before normal clips; once the episode is shot it makes normal clips as usual.
 * A repair account makes only clips sent to it.
 */
create or replace function public.claim_flow_clip(p_owner uuid, p_flow_account uuid, p_lease_seconds integer default 1200)
returns setof public.flow_clips language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tiktok uuid; v_purpose text; v_shooting boolean; v_today date;
begin
  select tiktok_account_id, purpose into v_tiktok, v_purpose from public.flow_accounts where owner_id=p_owner and id=p_flow_account and active;
  if not found then raise exception 'FLOW_ACCOUNT_UNAVAILABLE'; end if;
  -- Reserved for the drama while today's episode is being shot, or is due today and about to start (the episode
  -- is created a moment after the worker checks in, so a normal clip must not slip in first).
  v_today := (now() at time zone 'Asia/Bangkok')::date;
  v_shooting := exists(select 1 from public.drama_series s
    where s.owner_id=p_owner and s.flow_account_id=p_flow_account and s.status='ACTIVE' and (
      exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.status='PRODUCING')
      or (s.next_episode_number<=s.total_episodes
        and not exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and (e.status<>'READY' or e.started_on=v_today))
        and not (s.previous_series_id is not null and s.next_episode_number=1 and (s.created_at at time zone 'Asia/Bangkok')::date=v_today))));
  -- A linked Google account only makes its own TikTok account's clips; a shared one makes anyone's.
  select id into v_id from public.flow_clips
   where owner_id=p_owner and status='QUEUED'
     and (required_flow_account_id=p_flow_account
       or (required_flow_account_id is null and v_purpose='CLIP' and not v_shooting and (v_tiktok is null or tiktok_account_id=v_tiktok)))
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
       and not exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active and f.purpose='CLIP'
         and (f.exhausted_on is null or f.exhausted_on<>p_today)
         and (f.tiktok_account_id is null or f.tiktok_account_id=c.tiktok_account_id))
       -- Only once at least one account was actually tried: no accounts at all is a setup problem, not "no credits".
       and exists(select 1 from public.flow_accounts f where f.owner_id=p_owner and f.active and f.purpose='CLIP'
         and (f.tiktok_account_id is null or f.tiktok_account_id=c.tiktok_account_id))));
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.skip_unreachable_flow_clips(uuid,date) from public,anon,authenticated;
grant execute on function public.skip_unreachable_flow_clips(uuid,date) to service_role;
