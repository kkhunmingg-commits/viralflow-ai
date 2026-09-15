-- Phase 5A only. Previous migrations remain untouched.
create table public.account_product_scores (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, product_id uuid not null, category_id uuid,
 run_id uuid not null, calculated_at timestamptz not null,
 product_component numeric(7,4) not null check(product_component between 0 and 100),
 category_component numeric(7,4) not null check(category_component between 0 and 100),
 account_category_component numeric(7,4) not null check(account_category_component between 0 and 100),
 commercial_component numeric(7,4) not null check(commercial_component between 0 and 100),
 mode_fit_component numeric(7,4) not null check(mode_fit_component between 0 and 100),
 confidence_component numeric(7,4) not null check(confidence_component between 0 and 100),
 freshness_component numeric(7,4) not null check(freshness_component between 0 and 100),
 competition_component numeric(7,4) not null check(competition_component between 0 and 100),
 account_product_fit_score numeric(7,4) not null check(account_product_fit_score between 0 and 100),
 final_viral_opportunity_score numeric(7,4) not null check(final_viral_opportunity_score between 0 and 100),
 effective_mode text not null check(effective_mode in ('GROWTH','AFFILIATE')),
 eligible boolean not null, score_version text not null,
 explanation_json jsonb not null check(jsonb_typeof(explanation_json)='object'),
 created_at timestamptz not null default now(),
 unique(owner_id,id,tiktok_account_id,product_id),
 unique(owner_id,run_id,tiktok_account_id,product_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
 foreign key(owner_id,category_id) references public.categories(owner_id,id) on delete cascade
);
create index account_product_scores_account_time_idx on public.account_product_scores(owner_id,tiktok_account_id,calculated_at desc);
create index account_product_scores_product_idx on public.account_product_scores(owner_id,product_id);
create index account_product_scores_category_idx on public.account_product_scores(owner_id,category_id);

create table public.product_assignments (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, product_id uuid not null,
 category_key text not null, score_id uuid not null,
 assignment_date date not null, rank_for_account integer not null check(rank_for_account>0),
 effective_mode text not null check(effective_mode in ('GROWTH','AFFILIATE')),
 final_score numeric(7,4) not null check(final_score between 0 and 100),
 status text not null check(status in ('CANDIDATE','SELECTED','SKIPPED','BLOCKED','USED','EXPIRED')),
 score_version text not null, reason_json jsonb not null check(jsonb_typeof(reason_json)='object'),
 -- Future creative/post/performance tables should reference assignment id, preserving this evidence.
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,tiktok_account_id,product_id,assignment_date),
 foreign key(owner_id,score_id,tiktok_account_id,product_id)
 references public.account_product_scores(owner_id,id,tiktok_account_id,product_id) on delete cascade
);
create index product_assignments_account_day_idx on public.product_assignments(owner_id,assignment_date,tiktok_account_id,rank_for_account);
create index product_assignments_score_idx on public.product_assignments(owner_id,score_id,tiktok_account_id,product_id);
create index product_assignments_product_day_idx on public.product_assignments(owner_id,product_id,assignment_date);
create trigger product_assignments_touch before update on public.product_assignments for each row execute function private.touch_updated_at();
alter table public.account_product_scores enable row level security;
alter table public.product_assignments enable row level security;
revoke all on public.account_product_scores,public.product_assignments from public,anon,authenticated;
grant select,insert on public.account_product_scores to authenticated;
grant select,insert,update on public.product_assignments to authenticated;
create policy account_product_scores_read on public.account_product_scores for select to authenticated using((select auth.uid())=owner_id);
create policy account_product_scores_append on public.account_product_scores for insert to authenticated with check((select auth.uid())=owner_id);
create policy product_assignments_read on public.product_assignments for select to authenticated using((select auth.uid())=owner_id);
create policy product_assignments_insert on public.product_assignments for insert to authenticated with check((select auth.uid())=owner_id);
create policy product_assignments_update on public.product_assignments for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);

-- Atomic owner/day persistence. Invoker privileges preserve RLS and composite owner FKs.
create function public.save_daily_assignments(p_date date,p_scores jsonb,p_assignments jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare owner uuid:=auth.uid(); r jsonb; inserted integer:=0; affected integer:=0;
begin
 if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner::text||p_date::text,0));
 -- An exact transport retry carries the same run/pair identifiers. Keep the
 -- first immutable evaluation and continue rebuilding the active plan.
 insert into public.account_product_scores
 select * from jsonb_populate_recordset(null::public.account_product_scores,p_scores)
 on conflict(owner_id,run_id,tiktok_account_id,product_id) do nothing;
 update public.product_assignments set status='EXPIRED'
 where owner_id=owner and assignment_date=p_date and status='CANDIDATE';
 for r in select value from jsonb_array_elements(p_assignments) loop
  if (r->>'owner_id')::uuid<>owner or (r->>'assignment_date')::date<>p_date then
   raise exception 'Plan owner/date mismatch' using errcode='42501';
  end if;
  insert into public.product_assignments select * from jsonb_populate_record(null::public.product_assignments,r)
  on conflict(owner_id,tiktok_account_id,product_id,assignment_date) do update
  set score_id=excluded.score_id,rank_for_account=excluded.rank_for_account,effective_mode=excluded.effective_mode,
      final_score=excluded.final_score,status=excluded.status,reason_json=excluded.reason_json,score_version=excluded.score_version
  where product_assignments.status in ('CANDIDATE','EXPIRED','BLOCKED');
  get diagnostics affected=row_count;
  inserted:=inserted+affected;
 end loop;
 return inserted;
end $$;
revoke all on function public.save_daily_assignments(date,jsonb,jsonb) from public,anon;
grant execute on function public.save_daily_assignments(date,jsonb,jsonb) to authenticated;
comment on table public.account_product_scores is 'Immutable account-product-fit-v1 evaluations with complete input evidence.';
comment on table public.product_assignments is 'Owner/day decisions linked to immutable evaluations; future creatives and posts reference assignment id.';
