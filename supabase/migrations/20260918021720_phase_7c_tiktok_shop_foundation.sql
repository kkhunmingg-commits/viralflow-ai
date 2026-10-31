-- Phase 7C only: TikTok Shop / Affiliate commerce foundation. No real Shop API calls.

-- Effective business mode is commerce-aware. A requested AFFILIATE/AUTO account
-- remains effectively GROWTH until every local commerce capability is true.
drop index if exists public.tiktok_accounts_owner_effective_mode_idx;
alter table public.tiktok_accounts drop column effective_mode;
drop function private.account_effective_mode(text,bigint,boolean,boolean);
create function private.account_effective_mode(
  requested_mode text,
  followers bigint,
  is_shop_creator_eligible boolean,
  has_ecommerce_permission boolean,
  has_cart boolean
)
returns text language sql immutable security invoker set search_path='' as $$
  select case
    when upper(coalesce(requested_mode,'AUTO'))='GROWTH' then 'GROWTH'
    when coalesce(followers,0)>=1000
      and is_shop_creator_eligible is true
      and has_ecommerce_permission is true
      and has_cart is true then 'AFFILIATE'
    else 'GROWTH'
  end
$$;
revoke all on function private.account_effective_mode(text,bigint,boolean,boolean,boolean) from public,anon;
grant execute on function private.account_effective_mode(text,bigint,boolean,boolean,boolean) to authenticated,service_role;
alter table public.tiktok_accounts add column effective_mode text generated always as (
  private.account_effective_mode(mode,follower_count,shop_creator_eligible,ecommerce_permission,cart_enabled)
) stored;
create index tiktok_accounts_owner_effective_mode_idx on public.tiktok_accounts(owner_id,effective_mode);

create table public.tiktok_shop_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  provider text not null default 'mock' check(provider in ('mock','tiktok_shop')),
  authorization_type text not null default 'CREATOR' check(authorization_type in ('CREATOR','SELLER')),
  authorization_status text not null default 'NOT_CONNECTED' check(authorization_status in ('NOT_CONNECTED','PENDING','AUTHORIZED','PARTIAL','REAUTH_REQUIRED','REVOKED','ERROR')),
  api_access_status text not null default 'APPROVAL_REQUIRED' check(api_access_status in ('AVAILABLE','APPROVAL_REQUIRED','NOT_AVAILABLE')),
  region text not null check(region ~ '^[A-Z]{2}$'),
  shop_id text,
  shop_cipher text,
  granted_scopes text[] not null default '{}',
  missing_scopes text[] not null default '{}',
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  is_mock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,tiktok_account_id,authorization_type),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  check(is_mock or provider='tiktok_shop')
);

create table public.creator_commerce_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  shop_connection_id uuid not null,
  creator_user_id text,
  region text not null check(region ~ '^[A-Z]{2}$'),
  commerce_status text not null check(commerce_status in ('GROWTH','FOLLOWER_READY_NO_COMMERCE','COMMERCE_BLOCKED','AFFILIATE_READY','REAUTH_REQUIRED')),
  follower_eligible boolean not null,
  affiliate_eligible boolean not null,
  ecommerce_permission boolean not null,
  cart_permission boolean not null,
  showcase_available boolean not null default false,
  attachment_available boolean not null default false,
  blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,tiktok_account_id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,shop_connection_id) references public.tiktok_shop_connections(owner_id,id) on delete cascade
);

create table public.shop_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  shop_connection_id uuid not null,
  product_id uuid,
  external_product_id text not null,
  region text not null check(region ~ '^[A-Z]{2}$'),
  title text not null check(char_length(title) between 1 and 300),
  seller_name text,
  seller_status text not null default 'UNKNOWN' check(seller_status in ('ACTIVE','INACTIVE','SUSPENDED','UNKNOWN')),
  currency text not null check(char_length(currency)=3),
  current_price numeric(14,2) not null check(current_price>=0),
  original_price numeric(14,2) check(original_price is null or original_price>=current_price),
  commission_rate numeric(7,6) check(commission_rate is null or commission_rate between 0 and 1),
  product_status text not null check(product_status in ('ACTIVE','INACTIVE','UNAVAILABLE','UNDER_REVIEW','REJECTED')),
  collaboration_status text not null check(collaboration_status in ('OPEN','TARGETED','NONE','UNKNOWN')),
  audit_status text not null check(audit_status in ('APPROVED','PENDING','REJECTED','UNKNOWN')),
  product_url text,
  image_url text,
  provider_metadata jsonb not null default '{}' check(jsonb_typeof(provider_metadata)='object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,shop_connection_id,external_product_id),
  foreign key(owner_id,shop_connection_id) references public.tiktok_shop_connections(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete set null (product_id)
);

create table public.shop_product_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  shop_product_id uuid not null,
  captured_at timestamptz not null,
  event_id text not null,
  title text not null,
  price numeric(14,2) not null check(price>=0),
  original_price numeric(14,2),
  commission_rate numeric(7,6) check(commission_rate is null or commission_rate between 0 and 1),
  product_status text not null,
  collaboration_status text not null,
  audit_status text not null,
  observation_json jsonb not null default '{}' check(jsonb_typeof(observation_json)='object'),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,shop_product_id,event_id),
  foreign key(owner_id,shop_product_id) references public.shop_products(owner_id,id) on delete cascade
);

create table public.shop_product_permissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  shop_product_id uuid not null,
  permission_status text not null check(permission_status in ('ALLOWED','APPROVAL_REQUIRED','NOT_ALLOWED','REVOKED','UNKNOWN')),
  can_add_to_showcase boolean not null default false,
  can_attach_to_video boolean not null default false,
  collaboration_id text,
  blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
  checked_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,tiktok_account_id,shop_product_id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,shop_product_id) references public.shop_products(owner_id,id) on delete cascade
);

create table public.account_product_commerce_eligibility (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  shop_product_id uuid not null,
  content_fit boolean not null,
  commerce_eligible boolean not null,
  account_ready boolean not null,
  product_eligible boolean not null,
  attachment_allowed boolean not null,
  region_match boolean not null,
  status text not null check(status in ('CONTENT_ONLY','ELIGIBLE','BLOCKED','REAUTH_REQUIRED')),
  blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,shop_product_id) references public.shop_products(owner_id,id) on delete cascade
);

create table public.shoppable_content_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  shop_product_id uuid not null,
  publishing_queue_id uuid,
  commerce_eligibility_id uuid not null,
  intent_type text not null check(intent_type in ('PRODUCT_ATTACHMENT','SHOWCASE_LINK')),
  status text not null check(status in ('DRAFT','BLOCKED','READY_FOR_REVIEW','APPROVAL_REQUIRED','CANCELLED')),
  product_truth_status text not null check(product_truth_status in ('PASS','REVIEW','REJECT')),
  metadata_json jsonb not null default '{}' check(jsonb_typeof(metadata_json)='object'),
  blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,shop_product_id) references public.shop_products(owner_id,id) on delete cascade,
  foreign key(owner_id,publishing_queue_id) references public.publishing_queue(owner_id,id) on delete cascade,
  foreign key(owner_id,commerce_eligibility_id) references public.account_product_commerce_eligibility(owner_id,id)
);

alter table public.publishing_queue add column shoppable_content_intent_id uuid;
alter table public.publishing_queue add constraint publishing_queue_shoppable_intent_fkey
  foreign key(owner_id,shoppable_content_intent_id) references public.shoppable_content_intents(owner_id,id);

create index shop_connections_owner_status_idx on public.tiktok_shop_connections(owner_id,authorization_status,updated_at desc);
create index commerce_profiles_owner_status_idx on public.creator_commerce_profiles(owner_id,commerce_status,updated_at desc);
create index commerce_profiles_connection_idx on public.creator_commerce_profiles(owner_id,shop_connection_id);
create index shop_products_owner_status_idx on public.shop_products(owner_id,product_status,last_seen_at desc);
create index shop_products_linked_product_idx on public.shop_products(owner_id,product_id) where product_id is not null;
create index shop_snapshots_product_time_idx on public.shop_product_snapshots(owner_id,shop_product_id,captured_at desc);
create index shop_permissions_account_status_idx on public.shop_product_permissions(owner_id,tiktok_account_id,permission_status);
create index shop_permissions_product_idx on public.shop_product_permissions(owner_id,shop_product_id);
create index commerce_eligibility_account_time_idx on public.account_product_commerce_eligibility(owner_id,tiktok_account_id,evaluated_at desc);
create index commerce_eligibility_product_idx on public.account_product_commerce_eligibility(owner_id,shop_product_id);
create index shoppable_intents_account_status_idx on public.shoppable_content_intents(owner_id,tiktok_account_id,status,created_at desc);
create index shoppable_intents_product_idx on public.shoppable_content_intents(owner_id,shop_product_id);
create index shoppable_intents_queue_idx on public.shoppable_content_intents(owner_id,publishing_queue_id) where publishing_queue_id is not null;
create index shoppable_intents_eligibility_idx on public.shoppable_content_intents(owner_id,commerce_eligibility_id);

create trigger tiktok_shop_connections_touch before update on public.tiktok_shop_connections for each row execute function private.touch_updated_at();
create trigger creator_commerce_profiles_touch before update on public.creator_commerce_profiles for each row execute function private.touch_updated_at();
create trigger shop_products_touch before update on public.shop_products for each row execute function private.touch_updated_at();
create trigger shop_product_permissions_touch before update on public.shop_product_permissions for each row execute function private.touch_updated_at();
create trigger shoppable_content_intents_touch before update on public.shoppable_content_intents for each row execute function private.touch_updated_at();

alter table public.tiktok_shop_connections enable row level security;
alter table public.creator_commerce_profiles enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_product_snapshots enable row level security;
alter table public.shop_product_permissions enable row level security;
alter table public.account_product_commerce_eligibility enable row level security;
alter table public.shoppable_content_intents enable row level security;

revoke all on public.tiktok_shop_connections,public.creator_commerce_profiles,public.shop_products,public.shop_product_snapshots,public.shop_product_permissions,public.account_product_commerce_eligibility,public.shoppable_content_intents from public,anon,authenticated;
grant select on public.tiktok_shop_connections,public.creator_commerce_profiles,public.shop_products,public.shop_product_snapshots,public.shop_product_permissions,public.account_product_commerce_eligibility,public.shoppable_content_intents to authenticated;
grant select,insert,update,delete on public.tiktok_shop_connections,public.creator_commerce_profiles,public.shop_products,public.shop_product_permissions,public.shoppable_content_intents to service_role;
grant select,insert on public.shop_product_snapshots,public.account_product_commerce_eligibility to service_role;

create policy shop_connections_owner_read on public.tiktok_shop_connections for select to authenticated using((select auth.uid())=owner_id);
create policy commerce_profiles_owner_read on public.creator_commerce_profiles for select to authenticated using((select auth.uid())=owner_id);
create policy shop_products_owner_read on public.shop_products for select to authenticated using((select auth.uid())=owner_id);
create policy shop_snapshots_owner_read on public.shop_product_snapshots for select to authenticated using((select auth.uid())=owner_id);
create policy shop_permissions_owner_read on public.shop_product_permissions for select to authenticated using((select auth.uid())=owner_id);
create policy commerce_eligibility_owner_read on public.account_product_commerce_eligibility for select to authenticated using((select auth.uid())=owner_id);
create policy shoppable_intents_owner_read on public.shoppable_content_intents for select to authenticated using((select auth.uid())=owner_id);

comment on table public.tiktok_shop_connections is 'Sanitized TikTok Shop authorization metadata only. Real tokens must use Phase 7A server-only AES-GCM encryption pattern.';
comment on table public.shop_product_snapshots is 'Append-only TikTok Shop product truth observations.';
comment on table public.account_product_commerce_eligibility is 'Append-only separation of content fit from commerce eligibility.';
comment on table public.shoppable_content_intents is 'Metadata intent only; Phase 7C never attaches a product or creates a real shoppable post.';
