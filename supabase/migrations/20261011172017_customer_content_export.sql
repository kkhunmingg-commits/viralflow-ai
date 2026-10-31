-- Additive, export-only jobs. No scheduler, TikTok settings or existing rows change.
create table public.content_export_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null,
 product_id uuid,
 request_key uuid not null,
 mode text not null check(mode in ('GROWTH','AFFILIATE')),
 topic text not null default '' check(char_length(topic)<=400),
 status text not null default 'QUEUED' check(status in ('QUEUED','THINKING','IMAGING','VOICING','GENERATING','COMPOSING','REVIEW_REQUIRED','READY','FAILED','CANCELLED')),
 budget_usd numeric not null check(budget_usd between .3 and 1),
 reserved_usd numeric not null default 0 check(reserved_usd>=0),
 title text not null default '', script text not null default '', caption text not null default '', rationale text not null default '',
 message text not null default '', approved_at timestamptz,
 checkpoint jsonb not null default '{}',
 storage_path text, checksum text,
 lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,request_key),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id),
 foreign key(owner_id,product_id) references public.products(owner_id,id)
);
create unique index content_export_account_active on public.content_export_runs(owner_id,tiktok_account_id)
 where status in ('QUEUED','THINKING','IMAGING','VOICING','GENERATING','COMPOSING');
alter table public.content_export_runs enable row level security;
create policy content_export_owner_read on public.content_export_runs for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.content_export_runs from public,anon,authenticated;
grant select(id,owner_id,tiktok_account_id,product_id,mode,topic,status,budget_usd,reserved_usd,title,script,caption,rationale,message,approved_at,created_at,updated_at)
 on public.content_export_runs to authenticated;
grant all on public.content_export_runs to service_role;
create function public.claim_content_export_run(p_owner_id uuid,p_run_id uuid,p_lease_token uuid)
returns public.content_export_runs language plpgsql security invoker set search_path='' as $$
declare v_row public.content_export_runs;
begin
 update public.content_export_runs set lease_token=p_lease_token,lease_expires_at=now()+interval '180 seconds'
 where owner_id=p_owner_id and id=p_run_id and status in ('QUEUED','THINKING','IMAGING','VOICING','GENERATING','COMPOSING')
 and (lease_expires_at is null or lease_expires_at<now()) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.claim_content_export_run(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_content_export_run(uuid,uuid,uuid) to service_role;
