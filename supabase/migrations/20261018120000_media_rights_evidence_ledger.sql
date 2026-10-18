-- Additive rights & evidence ledger. Existing tables, rows and functions are unchanged.
-- A file's presence never attests rights: an owner records documented permission once,
-- it is reviewed, and every later use is checked against that record (fail-closed).
create table public.media_asset_rights (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 media_asset_id uuid not null, product_id uuid,
 origin_source text not null check(origin_source in ('OWNER_CREATED','COMMISSIONED','LICENSED_STOCK','MERCHANT_LICENSED','ORIGINAL_GRAPHIC')),
 asset_role text not null check(asset_role in ('REAL_IMAGE','REAL_FOOTAGE','COMPARISON_FOOTAGE','ORIGINAL_GRAPHIC','LICENSED_STOCK','MUSIC','VOICE')),
 source_reference text not null check(char_length(source_reference) between 1 and 2000),
 rightsholder text not null check(char_length(rightsholder) between 1 and 300),
 license_type text not null check(char_length(license_type) between 1 and 300),
 proof_uri text check(proof_uri is null or char_length(proof_uri)<=2000),
 proof_sha256 text check(proof_sha256 is null or proof_sha256 ~ '^[a-f0-9]{64}$'),
 allows_commercial boolean not null default false, allows_edit boolean not null default false, allows_promotion boolean not null default false,
 platform_scope text[] not null default '{}', account_scope uuid[], territory text[] not null default '{}',
 music_constraints text not null default '', likeness_constraints text not null default '',
 depicts_product_operation boolean not null default false,
 attested_by uuid not null, attested_at timestamptz not null default now(),
 review_state text not null default 'PENDING' check(review_state in ('PENDING','APPROVED','REJECTED')),
 reviewed_by uuid, reviewed_at timestamptz,
 expires_at timestamptz, revoked_at timestamptz, revocation_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,media_asset_id),
 -- Third-party media needs a stored proof; owner-made or original graphics still need a reference.
 check(origin_source in ('OWNER_CREATED','ORIGINAL_GRAPHIC') or proof_sha256 is not null),
 check(review_state='PENDING' or (reviewed_by is not null and reviewed_at is not null)),
 check((revoked_at is null)=(revocation_reason is null)),
 check(platform_scope <@ array['TIKTOK','INSTAGRAM','FACEBOOK','YOUTUBE']::text[]),
 foreign key(owner_id,media_asset_id) references public.media_assets(owner_id,id) on delete cascade,
 foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade
);
-- Which reviewed source assets an output was built from, with the rights seen at build time.
create table public.media_asset_usages (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 media_asset_id uuid not null, rights_id uuid not null, master_video_id uuid, video_variation_id uuid,
 rights_snapshot jsonb not null check(jsonb_typeof(rights_snapshot)='object'), created_at timestamptz not null default now(),
 check(num_nonnulls(master_video_id,video_variation_id)=1),
 foreign key(owner_id,media_asset_id) references public.media_assets(owner_id,id) on delete cascade,
 foreign key(owner_id,rights_id) references public.media_asset_rights(owner_id,id) on delete cascade,
 foreign key(owner_id,master_video_id) references public.master_videos(owner_id,id) on delete cascade,
 foreign key(owner_id,video_variation_id) references public.video_variations(owner_id,id) on delete cascade
);
create unique index media_asset_usages_master on public.media_asset_usages(owner_id,master_video_id,media_asset_id) where master_video_id is not null;
create unique index media_asset_usages_variation on public.media_asset_usages(owner_id,video_variation_id,media_asset_id) where video_variation_id is not null;
create index media_asset_usages_asset on public.media_asset_usages(owner_id,media_asset_id);
-- Verified product/topic facts the Creative Agent may cite by id.
create table public.content_evidence (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 product_id uuid, topic text check(topic is null or char_length(topic) between 1 and 160),
 statement text not null check(char_length(statement) between 1 and 500),
 source text not null check(source in ('PDP','LABEL','OWNER_FOOTAGE','AUTHORIZED_SOURCE')),
 source_reference text not null check(char_length(source_reference) between 1 and 2000),
 role text check(role is null or role in ('PROBLEM','SELLING_POINT','OBSERVATION')),
 captured_at timestamptz not null, verified_by uuid not null, verified_at timestamptz not null default now(),
 revoked_at timestamptz, created_at timestamptz not null default now(),
 unique(owner_id,id), check(num_nonnulls(product_id,topic)>=1), check(captured_at<=verified_at),
 foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade
);
create index content_evidence_product on public.content_evidence(owner_id,product_id) where revoked_at is null;
create index content_evidence_topic on public.content_evidence(owner_id,topic) where revoked_at is null;

-- Reviewed scope is immutable; revocation is one-way. A wider permission needs a new reviewed record.
create function private.guard_media_asset_rights() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.revoked_at is not null then raise exception 'media_rights_revoked_is_final'; end if;
 if old.review_state<>'PENDING' and (to_jsonb(new)-'revoked_at'-'revocation_reason'-'updated_at')<>(to_jsonb(old)-'revoked_at'-'revocation_reason'-'updated_at')
 then raise exception 'media_rights_reviewed_record_immutable'; end if;
 new.updated_at=now();return new;
end $$;
create trigger media_asset_rights_guard before update on public.media_asset_rights for each row execute function private.guard_media_asset_rights();

-- Reasons a video may not be used now; empty means allowed. Videos without recorded usages
-- keep the existing review gates (legacy/provider outputs), they are not silently cleared here.
create function public.media_rights_violations(p_owner uuid,p_video_kind text,p_video_id uuid,p_account uuid,p_platform text default 'TIKTOK',p_at timestamptz default now())
returns text[] language sql stable security invoker set search_path='' as $$
 with targets as (
  select u.* from public.media_asset_usages u where u.owner_id=p_owner and (
   (p_video_kind='MASTER' and u.master_video_id=p_video_id) or (p_video_kind='VARIATION' and u.video_variation_id=p_video_id) or
   (p_video_kind='VARIATION' and u.master_video_id=(select v.master_video_id from public.video_variations v where v.owner_id=p_owner and v.id=p_video_id)))
 ), reasons as (
  select unnest(array_remove(array[
   case when r.revoked_at is not null and r.revoked_at<=p_at then 'REVOKED' end,
   case when r.review_state<>'APPROVED' then 'NOT_APPROVED' end,
   case when r.expires_at is not null and r.expires_at<=p_at then 'EXPIRED' end,
   case when not r.allows_commercial then 'COMMERCIAL_NOT_ALLOWED' end,
   case when not r.allows_edit then 'EDIT_NOT_ALLOWED' end,
   case when not (p_platform=any(r.platform_scope)) then 'PLATFORM_OUT_OF_SCOPE' end,
   case when r.account_scope is not null and not (p_account=any(r.account_scope)) then 'ACCOUNT_OUT_OF_SCOPE' end
  ],null)) as reason from targets t join public.media_asset_rights r on r.owner_id=t.owner_id and r.id=t.rights_id
 ) select coalesce(array_agg(distinct reason order by reason),'{}') from reasons
$$;

-- Final publish-time gate: the upload transition fails if any source right no longer holds.
create function private.enforce_publish_media_rights() returns trigger language plpgsql security definer set search_path='' as $$
declare v_reasons text[];
begin
 if new.status='UPLOADING' and old.status is distinct from 'UPLOADING' then
  v_reasons:=public.media_rights_violations(new.owner_id,new.video_kind,new.video_id,new.tiktok_account_id);
  if cardinality(v_reasons)>0 then raise exception 'media_rights_blocked:%',array_to_string(v_reasons,','); end if;
 end if;return new;
end $$;
create trigger publishing_queue_media_rights before update of status on public.publishing_queue for each row execute function private.enforce_publish_media_rights();

-- Revocation stops queued, not-yet-submitted posts and rejects derived outputs.
create function private.propagate_media_rights_revocation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.revoked_at is not null and old.revoked_at is null then
  with masters as (select master_video_id id from public.media_asset_usages where owner_id=new.owner_id and rights_id=new.id and master_video_id is not null),
  variations as (
   select video_variation_id id from public.media_asset_usages where owner_id=new.owner_id and rights_id=new.id and video_variation_id is not null
   union select v.id from public.video_variations v join masters m on v.master_video_id=m.id where v.owner_id=new.owner_id)
  , q as (
   update public.publishing_queue set status='CANCELLED',cancelled_at=now(),last_error_code='MEDIA_RIGHTS_REVOKED',last_error_message='Source media rights were revoked'
   where owner_id=new.owner_id and status in ('DRAFT','REVIEW_REQUIRED','APPROVED','QUEUED','WAITING_FOR_SLOT','RETRYING')
    and coalesce(external_state,'READY') in ('READY','FAILED_RETRYABLE') and lease_token is null
    and ((video_kind='MASTER' and video_id in (select id from masters)) or (video_kind='VARIATION' and video_id in (select id from variations)))
   returning 1)
  , mv as (update public.master_videos set status='REJECTED' where owner_id=new.owner_id and id in (select id from masters) and status<>'REJECTED' returning 1)
  update public.video_variations set status='REJECTED' where owner_id=new.owner_id and id in (select id from variations) and status<>'REJECTED';
 end if;return new;
end $$;
create trigger media_asset_rights_revoked after update of revoked_at on public.media_asset_rights for each row execute function private.propagate_media_rights_revocation();

alter table public.media_asset_rights enable row level security;
alter table public.media_asset_usages enable row level security;
alter table public.content_evidence enable row level security;
create policy media_asset_rights_read on public.media_asset_rights for select to authenticated using(owner_id=(select auth.uid()));
create policy media_asset_usages_read on public.media_asset_usages for select to authenticated using(owner_id=(select auth.uid()));
create policy content_evidence_read on public.content_evidence for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.media_asset_rights,public.media_asset_usages,public.content_evidence from public,anon,authenticated;
grant select on public.media_asset_rights,public.media_asset_usages,public.content_evidence to authenticated;
grant all on public.media_asset_rights,public.media_asset_usages,public.content_evidence to service_role;
revoke all on function private.guard_media_asset_rights(),private.enforce_publish_media_rights(),private.propagate_media_rights_revocation() from public,anon,authenticated;
revoke all on function public.media_rights_violations(uuid,text,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.media_rights_violations(uuid,text,uuid,uuid,text,timestamptz) to service_role;
