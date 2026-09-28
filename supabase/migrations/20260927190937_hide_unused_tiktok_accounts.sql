-- Hiding an unused connection must keep its identity and dependent history so
-- reauthorizing the same TikTok open_id restores the original account row.
alter table public.tiktok_accounts
  add column hidden_at timestamptz;

comment on column public.tiktok_accounts.hidden_at is
  'Owner-hidden account; preserved for history and restored on OAuth reconnect.';
