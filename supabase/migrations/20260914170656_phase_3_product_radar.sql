-- Phase 3: append-only observations and versioned scoring.
create table public.products (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 external_provider text not null check (char_length(external_provider) between 1 and 50),
 external_product_id text not null check (char_length(external_product_id) between 1 and 200),
 title text not null check (char_length(title) between 1 and 300),
 slug text not null, category_key text not null,
 image_url text check (image_url is null or image_url ~ '^https://'),
 product_url text check (product_url is null or product_url ~ '^https://'),
 currency text not null default 'THB' check (currency = 'THB'),
 current_price numeric(14,2) not null check (current_price >= 0),
 original_price numeric(14,2) check (original_price >= 0),
 commission_rate numeric(7,6) not null check (commission_rate between 0 and 1),
 commission_amount numeric(14,2) not null check (commission_amount >= 0),
 rating numeric(3,2) check (rating between 0 and 5),
 review_count bigint not null check (review_count >= 0),
 units_sold bigint not null check (units_sold >= 0),
 status text not null check (status in ('available','unavailable','discontinued')),
 provider_metadata jsonb not null default '{}' check (jsonb_typeof(provider_metadata) = 'object'),
 first_seen_at timestamptz not null, last_seen_at timestamptz not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,external_provider,external_product_id)
);
create index products_owner_category_idx on public.products(owner_id,category_key);
create table public.product_snapshots (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 product_id uuid not null, captured_at timestamptz not null,
 ingestion_event_id text not null check (char_length(ingestion_event_id) between 1 and 300),
 price numeric(14,2) not null check (price >= 0), original_price numeric(14,2) check (original_price >= 0),
 commission_rate numeric(7,6) not null check (commission_rate between 0 and 1),
 commission_amount numeric(14,2) not null check (commission_amount >= 0),
 rating numeric(3,2) check (rating between 0 and 5),
 review_count bigint not null check (review_count >= 0), units_sold bigint not null check (units_sold >= 0),
 status text not null check (status in ('available','unavailable','discontinued')),
 competition numeric(5,4) check (competition between 0 and 1),
 creative_potential numeric(5,4) check (creative_potential between 0 and 1),
 provider_metadata jsonb not null default '{}' check (jsonb_typeof(provider_metadata) = 'object'),
 observation_json jsonb not null check (jsonb_typeof(observation_json) = 'object'),
 created_at timestamptz not null default now(),
 unique(owner_id,product_id,ingestion_event_id),
 unique(owner_id,product_id,captured_at),
 unique(owner_id,product_id,id),
 foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade
);
create index product_snapshots_owner_time_idx on public.product_snapshots(owner_id,captured_at desc);
create table public.product_scores (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 product_id uuid not null, snapshot_id uuid not null,
 calculated_at timestamptz not null,
 sales_velocity double precision not null check (sales_velocity >= 0 and sales_velocity < 'Infinity'),
 sales_acceleration double precision not null check (sales_acceleration between -3 and 3),
 price_attractiveness numeric(7,4) not null check (price_attractiveness between 0 and 100),
 commission_score numeric(7,4) not null check (commission_score between 0 and 100),
 rating_score numeric(7,4) not null check (rating_score between 0 and 100),
 competition_score numeric(7,4) not null check (competition_score between 0 and 100),
 creative_potential_score numeric(7,4) not null check (creative_potential_score between 0 and 100),
 product_momentum_score numeric(7,4) not null check (product_momentum_score between 0 and 100),
 viral_opportunity_base_score numeric(7,4) not null check (viral_opportunity_base_score between 0 and 100),
 review_confidence numeric(5,4) not null check (review_confidence between 0 and 1),
 data_confidence numeric(5,4) not null check (data_confidence between 0 and 1),
 score_version text not null check (char_length(score_version) between 1 and 100),
 explanation_json jsonb not null check (jsonb_typeof(explanation_json) = 'object'),
 unique(owner_id,snapshot_id,score_version),
 foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
 foreign key(owner_id,product_id,snapshot_id) references public.product_snapshots(owner_id,product_id,id) on delete cascade
);
create index product_scores_owner_product_time_idx on public.product_scores(owner_id,product_id,calculated_at desc);
create index product_scores_owner_rank_idx on public.product_scores(owner_id,viral_opportunity_base_score desc);
create trigger products_touch_updated_at before update on public.products
 for each row execute function private.touch_updated_at();
alter table public.products enable row level security;
revoke all on public.products from public, anon, authenticated;
grant select, insert, update on public.products to authenticated;
create policy products_select_own on public.products for select to authenticated using ((select auth.uid()) = owner_id);
create policy products_insert_own on public.products for insert to authenticated with check ((select auth.uid()) = owner_id);
alter table public.product_snapshots enable row level security;
revoke all on public.product_snapshots from public, anon, authenticated;
grant select, insert on public.product_snapshots to authenticated;
create policy product_snapshots_select_own on public.product_snapshots for select to authenticated using ((select auth.uid()) = owner_id);
create policy product_snapshots_insert_own on public.product_snapshots for insert to authenticated with check ((select auth.uid()) = owner_id);
alter table public.product_scores enable row level security;
revoke all on public.product_scores from public, anon, authenticated;
grant select, insert on public.product_scores to authenticated;
create policy product_scores_select_own on public.product_scores for select to authenticated using ((select auth.uid()) = owner_id);
create policy product_scores_insert_own on public.product_scores for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy products_update_own on public.products for update to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- One transaction: normalize in the service, lock one product, upsert current facts,
-- append the event exactly once. Retries cannot mutate historical observations.
create function public.ingest_product_observation(p_provider text,p_event text,p_captured timestamptz,p_product jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
 v_owner uuid := auth.uid();
 v_id uuid;
 v_previous public.product_snapshots%rowtype;
 v_snapshot public.product_snapshots%rowtype;
begin
 if v_owner is null then raise insufficient_privilege using message = 'Authentication required'; end if;
 if p_provider <> 'mock' then raise exception 'Production product providers are disabled'; end if;
 if p_captured > now() + interval '1 minute' then raise exception 'Future observation rejected'; end if;
 if p_product->>'currency' <> 'THB' then raise exception 'Only THB is supported in V1'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_provider || ':' || (p_product->>'external_product_id'),0));
 select id into v_id from public.products where owner_id=v_owner
   and external_provider=p_provider and external_product_id=p_product->>'external_product_id';
 if v_id is not null then
   select * into v_previous from public.product_snapshots where owner_id=v_owner and product_id=v_id and ingestion_event_id=p_event;
   if found then
     if v_previous.observation_json <> p_product or v_previous.captured_at <> p_captured then
       raise exception 'Event identity reused with a different payload';
     end if;
     return to_jsonb(v_previous);
   end if;
 end if;
 insert into public.products (
  owner_id,external_provider,external_product_id,title,slug,category_key,image_url,product_url,currency,
  current_price,original_price,commission_rate,commission_amount,rating,review_count,units_sold,status,
  first_seen_at,last_seen_at,provider_metadata
 ) values (
  v_owner,p_provider,p_product->>'external_product_id',p_product->>'title',
  p_product->>'external_product_id',p_product->>'category_key',p_product->>'image_url',p_product->>'product_url','THB',
  (p_product->>'price')::numeric,(p_product->>'original_price')::numeric,
  (p_product->>'commission_rate')::numeric,(p_product->>'commission_amount')::numeric,
  (p_product->>'rating')::numeric,(p_product->>'review_count')::bigint,(p_product->>'units_sold')::bigint,
  p_product->>'status',p_captured,p_captured,coalesce(p_product->'provider_metadata','{}'::jsonb)
 ) on conflict(owner_id,external_provider,external_product_id) do update set
  title=excluded.title,category_key=excluded.category_key,image_url=excluded.image_url,product_url=excluded.product_url,
  current_price=excluded.current_price,original_price=excluded.original_price,commission_rate=excluded.commission_rate,
  commission_amount=excluded.commission_amount,rating=excluded.rating,review_count=excluded.review_count,
  units_sold=excluded.units_sold,status=excluded.status,last_seen_at=excluded.last_seen_at,provider_metadata=excluded.provider_metadata
 where public.products.last_seen_at <= excluded.last_seen_at
 returning id into v_id;
 if v_id is null then
   select id into v_id from public.products where owner_id=v_owner and external_provider=p_provider
     and external_product_id=p_product->>'external_product_id';
 end if;
 update public.products set first_seen_at=least(first_seen_at,p_captured) where owner_id=v_owner and id=v_id and first_seen_at > p_captured;
 insert into public.product_snapshots (
  owner_id,product_id,captured_at,ingestion_event_id,price,original_price,commission_rate,commission_amount,
  rating,review_count,units_sold,status,competition,creative_potential,provider_metadata,observation_json
 ) values (
  v_owner,v_id,p_captured,p_event,(p_product->>'price')::numeric,(p_product->>'original_price')::numeric,
  (p_product->>'commission_rate')::numeric,(p_product->>'commission_amount')::numeric,
  (p_product->>'rating')::numeric,(p_product->>'review_count')::bigint,(p_product->>'units_sold')::bigint,
  p_product->>'status',(p_product->>'competition')::numeric,(p_product->>'creative_potential')::numeric,
  coalesce(p_product->'provider_metadata','{}'::jsonb),p_product
 ) returning * into v_snapshot;
 return to_jsonb(v_snapshot);
end;
$$;
revoke all on function public.ingest_product_observation(text,text,timestamptz,jsonb) from public,anon;
grant execute on function public.ingest_product_observation(text,text,timestamptz,jsonb) to authenticated;
comment on table public.product_snapshots is 'Append-only observations. Same event is idempotent; client updates/deletes denied.';
comment on table public.product_scores is 'Immutable score audit per snapshot and algorithm version. Current UI recalculates freshness.';
