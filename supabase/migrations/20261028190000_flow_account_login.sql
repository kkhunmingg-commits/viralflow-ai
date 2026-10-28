-- Google sign-in becomes part of linking a Flow account: a new account waits as PENDING until the owner's
-- computer has opened a sign-in window for it and seen Flow load, then READY. Only READY accounts make clips.
alter table public.flow_accounts
  add column login_state text not null default 'PENDING' check (login_state in ('PENDING','READY','FAILED')),
  add column login_note text check (char_length(login_note) <= 200),
  add column login_checked_at timestamptz;
