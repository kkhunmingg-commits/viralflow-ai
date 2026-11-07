-- Drama Studio 2.3: takes. "ไม่ผ่าน" no longer throws the cut away: it stays as a rejected take of that episode and
-- a new take is shot from the next day. The owner compares every take side by side, picks one (which counts as
-- approved) and the other takes are deleted.
alter table public.drama_episodes drop constraint if exists drama_episodes_review_check;
alter table public.drama_episodes add constraint drama_episodes_review_check check(review in ('PENDING','APPROVED','REJECTED'));
-- Several takes share an episode number; only one may be open, waiting, or approved.
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid='public.drama_episodes'::regclass and contype='u'
    and pg_get_constraintdef(oid) = 'UNIQUE (series_id, number)';
  if c is not null then execute format('alter table public.drama_episodes drop constraint %I', c); end if;
end $$;
create unique index if not exists drama_episodes_one_take on public.drama_episodes(series_id,number) where review<>'REJECTED';
alter table public.drama_episodes add column if not exists take integer not null default 1 check(take between 1 and 50);
-- Episode 1's key still (faces for the whole season) belongs to the take it came from.
alter table public.drama_episodes add column if not exists key_still_path text check(key_still_path is null or char_length(key_still_path)<=500);

/** Same as 2.2, except that a rejected take never reserves the account. */
create or replace function public.claim_flow_clip(p_owner uuid, p_flow_account uuid, p_lease_seconds integer default 1200)
returns setof public.flow_clips language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tiktok uuid; v_purpose text; v_shooting boolean; v_today date;
begin
  select tiktok_account_id, purpose into v_tiktok, v_purpose from public.flow_accounts where owner_id=p_owner and id=p_flow_account and active;
  if not found then raise exception 'FLOW_ACCOUNT_UNAVAILABLE'; end if;
  v_today := (now() at time zone 'Asia/Bangkok')::date;
  v_shooting := exists(select 1 from public.drama_series s
    where s.owner_id=p_owner and s.flow_account_id=p_flow_account and s.status='ACTIVE' and (
      exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.status='PRODUCING')
      or (s.next_episode_number<=s.total_episodes and (s.redo_on is null or s.redo_on<=v_today)
        and not exists(select 1 from public.drama_episodes e where e.owner_id=p_owner and e.series_id=s.id and e.review<>'REJECTED'
          and (e.status<>'READY' or e.started_on=v_today or e.review<>'APPROVED')))));
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
