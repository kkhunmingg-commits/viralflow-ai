-- 25 Nov (Lucky): products are split by where they are sold.
--  * Shopee / Lazada links stay for the link clips posted to Facebook / Instagram / YouTube.
--  * TikTok Shop best-sellers are pulled from TikTok Shop's own web pages (shop.tiktok.com/th) by the ViralFlow Chrome
--    extension in the owner's Chrome, the owner picks some, ViralFlow makes clips of them automatically, and the same
--    picks are what Praew presents in the TikTok LIVE (so the product she talks about is the one pinned in the cart).

create table if not exists public.tiktok_shop_products (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 -- TikTok Shop's product id (digits).
 product_id text not null check(product_id ~ '^[0-9]{6,30}$'),
 -- Exactly as TikTok Shop shows it: the live cart shows the same title, so the pin is matched by it.
 title text not null check(char_length(title) between 1 and 300),
 shop_name text check(shop_name is null or char_length(shop_name)<=120),
 category text check(category is null or char_length(category)<=80),
 price numeric check(price is null or price>=0),
 original_price numeric check(original_price is null or original_price>=0),
 sold_count bigint check(sold_count is null or sold_count>=0),
 rating numeric check(rating is null or (rating>=0 and rating<=5)),
 review_count bigint check(review_count is null or review_count>=0),
 image_url text check(image_url is null or (image_url ~ '^https://' and char_length(image_url)<=2000)),
 product_url text not null check(product_url ~ '^https://' and char_length(product_url)<=2000),
 -- Last time a pull from TikTok Shop saw it (numbers above are from then).
 seen_at timestamptz not null default now(),
 -- The owner picked it: a clip is made of it and Praew presents it while `live` is on.
 picked_at timestamptz,
 live boolean not null default false,
 clip_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,product_id)
);
create index if not exists tiktok_shop_products_owner_sold on public.tiktok_shop_products(owner_id,sold_count desc nulls last);
create index if not exists tiktok_shop_products_owner_live on public.tiktok_shop_products(owner_id) where live;

alter table public.tiktok_shop_products enable row level security;
revoke all on public.tiktok_shop_products from public,anon,authenticated;
grant select on public.tiktok_shop_products to authenticated;
grant all on public.tiktok_shop_products to service_role;
drop policy if exists tiktok_shop_products_read on public.tiktok_shop_products;
create policy tiktok_shop_products_read on public.tiktok_shop_products for select to authenticated using(owner_id=(select auth.uid()));

-- Clips of TikTok Shop products go through the same Flow clip pipeline as the link clips.
alter table public.product_link_clips drop constraint if exists product_link_clips_platform_check;
alter table public.product_link_clips add constraint product_link_clips_platform_check check(platform in ('SHOPEE','LAZADA','TIKTOK'));
alter table public.product_link_clips drop constraint if exists product_link_clips_source_check;
alter table public.product_link_clips add constraint product_link_clips_source_check check(source in ('MANUAL_LINK','AFFILIATE_API','TIKTOK_SHOP'));
