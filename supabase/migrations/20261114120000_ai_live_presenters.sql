-- AI LIVE presenters made in Google Flow by the owner's existing Flow worker (14 Nov, owner).
-- One presenter = 1 face take (text-to-video; its last frame becomes the face), then 12 talking takes and 2 idle takes
-- that all start from that face (Flow "frames" mode), so every take shows the same person. The owner's computer then
-- turns the takes into a CPU lip-sync bundle (ai-live-cpu/loop_presenter). Takes are flow_clips of kind PRESENTER_CLIP.

alter table public.flow_clips drop constraint if exists flow_clips_kind_check;
alter table public.flow_clips add constraint flow_clips_kind_check
  check(kind in ('GROWTH','AFFILIATE','DRAMA_SHOT','DRAMA','PRODUCT_SHOT','PRODUCT_CLIP','PRESENTER_CLIP'));

create table if not exists public.ai_live_presenters (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 -- flow_clips rows need a channel; the Google account pool is shared, so any of the owner's accounts works.
 tiktok_account_id uuid not null,
 name text not null check(char_length(name) between 1 and 60),
 -- Free text the owner gave for the look (age, style, clothing); goes into the face prompt only.
 look text not null default '' check(char_length(look)<=300),
 status text not null default 'FACE' check(status in ('FACE','CLIPS','READY','FAILED')),
 face_still_path text check(face_still_path is null or char_length(face_still_path)<=500),
 -- [{key, role FACE|TALK|IDLE, line, clipId, attempts, status PLANNED|QUEUED|DONE|FAILED, path, error}]
 takes jsonb not null default '[]' check(jsonb_typeof(takes)='array'),
 error text check(error is null or char_length(error)<=500),
 ready_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
create index if not exists ai_live_presenters_owner on public.ai_live_presenters(owner_id,created_at desc);

alter table public.ai_live_presenters enable row level security;
revoke all on public.ai_live_presenters from public,anon,authenticated;
grant select on public.ai_live_presenters to authenticated;
grant all on public.ai_live_presenters to service_role;
drop policy if exists ai_live_presenters_read on public.ai_live_presenters;
create policy ai_live_presenters_read on public.ai_live_presenters for select to authenticated using(owner_id=(select auth.uid()));
