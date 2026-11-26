-- 26 Nov (Lucky: only products that pay commission): the owner's TikTok Shop showcase, read in LIVE Manager, carries
-- each product's estimated commission and stock. Products seen there are marked in_showcase; a later read that no
-- longer lists one clears the mark.
alter table public.tiktok_shop_products
  add column if not exists commission numeric(12,2) check (commission is null or commission >= 0),
  add column if not exists stock integer check (stock is null or stock >= 0),
  add column if not exists in_showcase boolean not null default false,
  add column if not exists showcase_seen_at timestamptz;

create index if not exists tiktok_shop_products_owner_commission_idx
  on public.tiktok_shop_products (owner_id, commission desc nulls last) where in_showcase;
