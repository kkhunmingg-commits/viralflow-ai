-- Product clips from a pasted Shopee / Lazada link. The owner pastes an (affiliate) link, checks the product details,
-- picks 8 / 16 / 32 seconds, and the free Google Flow queue makes one 8-second take per shot (kind PRODUCT_SHOT).
-- The server cuts the takes into one MP4 (kind PRODUCT_CLIP), which waits for the owner's review. After approval it
-- is posted to Facebook Page Reels, Instagram Reels and YouTube Shorts with the link as the first comment.
-- TikTok stays draft-only (its API cannot attach a product basket).

alter table public.flow_clips drop constraint if exists flow_clips_kind_check;
alter table public.flow_clips add constraint flow_clips_kind_check check(kind in ('GROWTH','AFFILIATE','DRAMA_SHOT','DRAMA','PRODUCT_SHOT','PRODUCT_CLIP'));

create table if not exists public.product_link_clips (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 -- The channel whose linked Google accounts make the takes (the same queue as the promo clips).
 tiktok_account_id uuid not null,
 platform text not null check(platform in ('SHOPEE','LAZADA')),
 -- MANUAL_LINK today; AFFILIATE_API once the Shopee/Lazada affiliate API is open to the account.
 source text not null default 'MANUAL_LINK' check(source in ('MANUAL_LINK','AFFILIATE_API')),
 -- Exactly as pasted (affiliate tracking kept): goes in the caption and the first comment.
 link text not null check(link ~ '^https://' and char_length(link)<=1000),
 product_url text check(product_url is null or (product_url ~ '^https://' and char_length(product_url)<=2000)),
 external_id text check(external_id is null or char_length(external_id)<=80),
 title text not null check(char_length(title) between 1 and 300),
 -- The facts the owner kept from the product page; the script uses nothing else.
 facts jsonb not null default '[]' check(jsonb_typeof(facts)='array'),
 -- Listing photos copied to private Storage, in the order the shots use them.
 image_paths jsonb not null default '[]' check(jsonb_typeof(image_paths)='array'),
 length_seconds integer not null check(length_seconds in (8,16,32)),
 -- Shots, narration, caption, comment and the compliance check (src/features/product-links/script.ts).
 script jsonb not null check(jsonb_typeof(script)='object'),
 status text not null default 'PRODUCING' check(status in ('PRODUCING','ASSEMBLING','REVIEW','APPROVED','PUBLISHING','PUBLISHED','REJECTED','FAILED')),
 -- One flow_clips row per shot, in order; a remade shot replaces its id.
 shot_clip_ids jsonb not null default '[]' check(jsonb_typeof(shot_clip_ids)='array'),
 shot_attempts jsonb not null default '[]' check(jsonb_typeof(shot_attempts)='array'),
 final_clip_id uuid,
 -- Platforms the owner chose at approval, and each one's posting state.
 targets jsonb not null default '[]' check(jsonb_typeof(targets)='array'),
 posts jsonb not null default '[]' check(jsonb_typeof(posts)='array'),
 assemble_attempts integer not null default 0 check(assemble_attempts between 0 and 20),
 error text check(error is null or char_length(error)<=500),
 ready_at timestamptz, reviewed_at timestamptz, published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
create index if not exists product_link_clips_owner on public.product_link_clips(owner_id,status,created_at desc);

alter table public.product_link_clips enable row level security;
revoke all on public.product_link_clips from public,anon,authenticated;
grant select on public.product_link_clips to authenticated;
grant all on public.product_link_clips to service_role;
drop policy if exists product_link_clips_read on public.product_link_clips;
create policy product_link_clips_read on public.product_link_clips for select to authenticated using(owner_id=(select auth.uid()));
