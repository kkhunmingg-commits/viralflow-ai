-- Keep each TikTok identity separate within its ViralFlow owner. Existing rows
-- retain their IDs and all dependent history, credentials, and integrations.
alter table public.tiktok_accounts
  add column provider text not null default 'tiktok',
  add constraint tiktok_accounts_provider_check check (provider = 'tiktok');

alter table public.tiktok_accounts
  add constraint tiktok_accounts_owner_provider_open_id_key
  unique (owner_id, provider, open_id);

drop index public.tiktok_accounts_open_id_unique_idx;

-- A username is mutable and may be reused; the provider open_id is the identity.
alter table public.tiktok_accounts
  drop constraint tiktok_accounts_owner_id_username_key;

create index tiktok_accounts_owner_username_idx
  on public.tiktok_accounts (owner_id, username)
  where username is not null;
