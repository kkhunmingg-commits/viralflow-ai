-- Drama Studio 2.2: the owner reviews every finished episode. The next episode starts only after "ผ่าน" (approved);
-- "ไม่ผ่าน" discards the cut and shoots the same episode again from the next day.
alter table public.drama_episodes add column review text not null default 'PENDING' check(review in ('PENDING','APPROVED'));
alter table public.drama_episodes add column reviewed_at timestamptz;
-- Episodes finished before reviews existed count as approved.
update public.drama_episodes set review='APPROVED', reviewed_at=now() where status='READY';
-- Bangkok day from which a rejected episode is shot again.
alter table public.drama_series add column redo_on date;

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
  -- is created a moment after the worker checks in, so a normal clip must not slip in first). An episode waiting for
  -- the owner's review, or a rejected one waiting for tomorrow, reserves nothing.
  v_today := (now() at time zone 'Asia/Bangkok')::date;
  v_shooting := exists(select 1 from public.drama_series s
    where s.owner_id=p_owner and s.flow_account_id=p_flow_account and s.status='ACTIVE' and (
      exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.status='PRODUCING')
      or (s.next_episode_number<=s.total_episodes and (s.redo_on is null or s.redo_on<=v_today)
        and not exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id
          and (e.status<>'READY' or e.started_on=v_today or e.review<>'APPROVED')))));
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

