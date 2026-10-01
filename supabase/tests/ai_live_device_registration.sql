-- Scoped acceptance test against an already migrated database.
-- Uses existing owners read-only. All temporary device records are rolled back.
begin;
do $$
declare
  owner_a uuid;
  owner_b uuid;
  device_a uuid := gen_random_uuid();
  device_b uuid := gen_random_uuid();
  challenge_id uuid;
  nonce text;
  public_key_a text := 'SQL_TEST_ONLY_' || repeat('A', 100);
  public_key_b text := 'SQL_TEST_ONLY_' || repeat('B', 100);
  fingerprint_a text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  fingerprint_b text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  active_before integer;
  allowed_count integer;
begin
  select id into owner_a from auth.users order by id limit 1;
  select id into owner_b from auth.users where id <> owner_a order by id limit 1;
  if owner_a is null or owner_b is null then raise exception 'Two existing owners required; no users created'; end if;
  select count(*) into active_before from public.ai_live_devices where owner_id=owner_a and revoked_at is null;
  allowed_count := active_before + 1;
  if allowed_count > 1000 then raise exception 'No available test slot; no data changed'; end if;
  challenge_id := gen_random_uuid(); nonce := fingerprint_a;
  insert into public.ai_live_device_challenges(id,owner_id,device_id,nonce_hash,issued_at,expires_at)
    values(challenge_id,owner_a,device_a,nonce,clock_timestamp(),clock_timestamp()+interval '110 seconds');
  if public.ai_live_register_device(owner_a,device_a,challenge_id,nonce,public_key_a,fingerprint_a,allowed_count,clock_timestamp()+interval '1 hour') is not true then raise exception 'Register failed'; end if;
  if public.ai_live_register_device(owner_a,device_a,challenge_id,nonce,public_key_a,fingerprint_a,allowed_count,clock_timestamp()+interval '1 hour') is not false then raise exception 'Replay accepted'; end if;
  challenge_id := gen_random_uuid(); nonce := fingerprint_b;
  insert into public.ai_live_device_challenges(id,owner_id,device_id,nonce_hash,issued_at,expires_at)
    values(challenge_id,owner_a,device_a,nonce,clock_timestamp(),clock_timestamp()+interval '110 seconds');
  if public.ai_live_register_device(owner_a,device_a,challenge_id,nonce,public_key_a,fingerprint_a,allowed_count,clock_timestamp()+interval '1 hour') is not true then raise exception 'Safe duplicate registration failed'; end if;
  if (select count(*) from public.ai_live_devices where device_id=device_a) <> 1 then raise exception 'Duplicate device row'; end if;
  if public.ai_live_revoke_device(owner_b,device_a) is not false then raise exception 'Cross-owner revoke accepted'; end if;
  if not exists(select 1 from public.ai_live_devices where device_id=device_a and owner_id=owner_a and revoked_at is null) then raise exception 'Cross-owner changed device'; end if;
  challenge_id := gen_random_uuid(); nonce := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into public.ai_live_device_challenges(id,owner_id,device_id,nonce_hash,issued_at,expires_at)
    values(challenge_id,owner_a,device_b,nonce,clock_timestamp(),clock_timestamp()+interval '110 seconds');
  if public.ai_live_register_device(owner_a,device_b,challenge_id,nonce,public_key_b,fingerprint_b,allowed_count,clock_timestamp()+interval '1 hour') is not false then raise exception 'Device limit not enforced'; end if;
  if public.ai_live_register_device(owner_a,device_b,challenge_id,nonce,public_key_b,fingerprint_b,allowed_count,clock_timestamp()-interval '1 second') is not false then raise exception 'Expired entitlement accepted'; end if;
  if public.ai_live_claim_device_lease(owner_b,device_a,nonce,clock_timestamp()+interval '100 seconds',allowed_count) is not false then raise exception 'Cross-owner lease accepted'; end if;
  if public.ai_live_claim_device_lease(owner_a,device_a,nonce,clock_timestamp()+interval '100 seconds',allowed_count) is not true then raise exception 'Lease failed'; end if;
  if public.ai_live_claim_device_lease(owner_a,device_a,nonce,clock_timestamp()+interval '100 seconds',allowed_count) is not false then raise exception 'Lease replay accepted'; end if;
  if public.ai_live_revoke_device(owner_a,device_a) is not true then raise exception 'Revoke failed'; end if;
  if public.ai_live_revoke_device(owner_a,device_a) is not true then raise exception 'Idempotent revoke failed'; end if;
  if public.ai_live_claim_device_lease(owner_a,device_a,nonce,clock_timestamp()+interval '100 seconds',allowed_count) is not false then raise exception 'Revoked device accepted'; end if;
end;
$$;
set local role authenticated;
do $$
begin
  begin
    perform device_id from public.ai_live_devices;
    raise exception 'Authenticated direct read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.ai_live_revoke_device(gen_random_uuid(),gen_random_uuid());
    raise exception 'Authenticated direct revoke unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform device_id from public.ai_live_devices;
    raise exception 'Anonymous direct read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
select 'AI LIVE registration / isolation / revoke / replay / limit tests passed; fixture changes rolled back' as result;
