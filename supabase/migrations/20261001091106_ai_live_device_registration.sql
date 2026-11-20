-- AI LIVE delivery only. Kept local until an explicit deployment/migration approval.
-- Mutations are server-only. Membership is checked with fresh Auth app_metadata
-- before calling these SECURITY INVOKER RPCs with the server-only service role.
create table public.ai_live_devices (
  device_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null check (length(public_key) between 80 and 256),
  key_fingerprint text not null check (key_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_id, device_id),
  unique (key_fingerprint)
);
create index ai_live_devices_owner_active_idx on public.ai_live_devices(owner_id) where revoked_at is null;

create table public.ai_live_device_challenges (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  nonce_hash text not null unique check (nonce_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '120 seconds')
);
create index ai_live_device_challenges_expiry_idx on public.ai_live_device_challenges(expires_at);
create index ai_live_device_challenges_owner_expiry_idx on public.ai_live_device_challenges(owner_id, expires_at);

create table public.ai_live_device_lease_nonces (
  device_id uuid not null references public.ai_live_devices(device_id) on delete cascade,
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  primary key (device_id, nonce_hash)
);
create index ai_live_device_lease_nonces_expiry_idx on public.ai_live_device_lease_nonces(expires_at);

alter table public.ai_live_devices enable row level security;
alter table public.ai_live_device_challenges enable row level security;
alter table public.ai_live_device_lease_nonces enable row level security;
revoke all on public.ai_live_devices, public.ai_live_device_challenges, public.ai_live_device_lease_nonces from public, anon, authenticated;
grant select, insert, update, delete on public.ai_live_devices, public.ai_live_device_challenges, public.ai_live_device_lease_nonces to service_role;

create function public.ai_live_register_device(
  p_owner_id uuid, p_device_id uuid, p_challenge_id uuid, p_nonce_hash text,
  p_public_key text, p_key_fingerprint text, p_device_limit integer, p_entitlement_expires_at timestamptz
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_device public.ai_live_devices%rowtype;
  v_challenge public.ai_live_device_challenges%rowtype;
  v_active_count integer;
begin
  if p_owner_id is null or p_device_id is null or p_challenge_id is null
    or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
    or p_device_limit is null or p_device_limit < 1 or p_device_limit > 1000
    or p_entitlement_expires_at is null or p_entitlement_expires_at <= clock_timestamp()
    or p_public_key is null or length(p_public_key) not between 80 and 256
    or p_key_fingerprint is null or p_key_fingerprint !~ '^[a-f0-9]{64}$' then return false; end if;
  -- Both owner limit and global identity are locked, preventing parallel overbooking/takeover.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-live-owner:' || p_owner_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-live-device:' || p_device_id::text, 0));
  select * into v_challenge from public.ai_live_device_challenges where id = p_challenge_id for update;
  if not found or v_challenge.owner_id <> p_owner_id or v_challenge.device_id <> p_device_id
    or v_challenge.nonce_hash <> p_nonce_hash or v_challenge.consumed_at is not null
    or v_challenge.expires_at <= clock_timestamp() then return false; end if;
  select * into v_device from public.ai_live_devices where device_id = p_device_id for update;
  if found and (v_device.owner_id <> p_owner_id or v_device.key_fingerprint <> p_key_fingerprint or v_device.public_key <> p_public_key) then return false; end if;
  if exists (select 1 from public.ai_live_devices where key_fingerprint = p_key_fingerprint and device_id <> p_device_id) then return false; end if;
  select count(*) into v_active_count from public.ai_live_devices where owner_id = p_owner_id and revoked_at is null;
  if (v_device.device_id is null or v_device.revoked_at is not null) and v_active_count >= p_device_limit then return false; end if;
  if v_device.device_id is not null and v_device.revoked_at is null and v_active_count > p_device_limit then return false; end if;
  insert into public.ai_live_devices(device_id,owner_id,public_key,key_fingerprint)
    values (p_device_id,p_owner_id,p_public_key,p_key_fingerprint)
    on conflict (device_id) do update set revoked_at = null, last_seen_at = clock_timestamp();
  update public.ai_live_device_challenges set consumed_at = clock_timestamp() where id = p_challenge_id;
  delete from public.ai_live_device_challenges where owner_id = p_owner_id and expires_at < clock_timestamp() - interval '10 minutes';
  return true;
end;
$$;

create function public.ai_live_claim_device_lease(p_owner_id uuid,p_device_id uuid,p_nonce_hash text,p_expires_at timestamptz,p_device_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_inserted integer;
begin
  if p_expires_at is null or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '120 seconds'
    or p_device_limit is null or p_device_limit < 1 or p_device_limit > 1000
    or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-live-owner:' || p_owner_id::text, 0));
  perform 1 from public.ai_live_devices where device_id = p_device_id and owner_id = p_owner_id and revoked_at is null for update;
  if not found then return false; end if;
  if (select count(*) from public.ai_live_devices where owner_id = p_owner_id and revoked_at is null) > p_device_limit then return false; end if;
  delete from public.ai_live_device_lease_nonces where device_id = p_device_id and expires_at < clock_timestamp();
  insert into public.ai_live_device_lease_nonces(device_id,nonce_hash,expires_at) values (p_device_id,p_nonce_hash,p_expires_at)
    on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;
  update public.ai_live_devices set last_seen_at = clock_timestamp() where device_id = p_device_id;
  return true;
end;
$$;

create function public.ai_live_revoke_device(p_owner_id uuid,p_device_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-live-owner:' || p_owner_id::text, 0));
  update public.ai_live_devices set revoked_at = coalesce(revoked_at,clock_timestamp()) where device_id = p_device_id and owner_id = p_owner_id;
  if not found then return false; end if;
  delete from public.ai_live_device_lease_nonces where device_id = p_device_id;
  return true;
end;
$$;

revoke all on function public.ai_live_register_device(uuid,uuid,uuid,text,text,text,integer,timestamptz) from public, anon, authenticated;
revoke all on function public.ai_live_claim_device_lease(uuid,uuid,text,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.ai_live_revoke_device(uuid,uuid) from public, anon, authenticated;
grant execute on function public.ai_live_register_device(uuid,uuid,uuid,text,text,text,integer,timestamptz) to service_role;
grant execute on function public.ai_live_claim_device_lease(uuid,uuid,text,timestamptz,integer) to service_role;
grant execute on function public.ai_live_revoke_device(uuid,uuid) to service_role;
