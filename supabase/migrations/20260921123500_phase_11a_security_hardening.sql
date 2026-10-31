-- Phase 11A: shared, service-only abuse throttling for public HTTP boundaries.
create table private.security_rate_limits (
  scope text not null check (char_length(scope) between 1 and 64),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

revoke all on table private.security_rate_limits from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.security_rate_limits to service_role;

create or replace function public.consume_security_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if char_length(p_scope) not between 1 and 64
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_security_rate_limit_input';
  end if;

  delete from private.security_rate_limits
  where updated_at < v_now - interval '2 days';

  insert into private.security_rate_limits (
    scope,
    key_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_scope, p_key_hash, v_now, 1, v_now)
  on conflict (scope, key_hash) do update
  set
    window_started_at = case
      when private.security_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then v_now
      else private.security_rate_limits.window_started_at
    end,
    request_count = case
      when private.security_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then 1
      else private.security_rate_limits.request_count + 1
    end,
    updated_at = v_now
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_security_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, text, integer, integer)
  to service_role;

comment on table private.security_rate_limits is
  'Short-lived server-only counters for public HTTP abuse throttling.';
comment on function public.consume_security_rate_limit(text, text, integer, integer) is
  'Atomically consumes one request in a fixed window; service_role only.';
