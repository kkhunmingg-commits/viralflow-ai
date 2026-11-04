-- Drama Studio: serialized short dramas made from the same free Google Flow queue as every other clip.
-- A series keeps its story bible and running memory; each episode is a few 8-second shots made one at a time
-- (the next shot starts from the previous shot's last frame), then cut together on the server into one MP4
-- that waits in the ordinary clip library. Nothing here posts to TikTok or spends paid API credits.

-- Two new clip kinds in the existing queue: a production shot (never shown in the library) and a finished episode.
alter table public.flow_clips drop constraint if exists flow_clips_kind_check;
alter table public.flow_clips add constraint flow_clips_kind_check check(kind in ('GROWTH','AFFILIATE','DRAMA_SHOT','DRAMA'));

create table public.drama_series (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 -- The TikTok channel the series is made for; its linked Google accounts make the shots.
 tiktok_account_id uuid not null,
 genre text not null check(genre in ('HORROR','ACTION','COMEDY','ROMANCE','MYSTERY','FANTASY')),
 title text not null check(char_length(title) between 1 and 120),
 logline text not null check(char_length(logline) between 1 and 600),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
 total_episodes integer not null check(total_episodes between 3 and 60),
 shots_per_episode integer not null default 4 check(shots_per_episode between 2 and 6),
 episodes_per_day integer not null default 1 check(episodes_per_day between 1 and 5),
 -- Characters, places, the key object, the hidden truth and the locked ending (see src/features/drama/contracts.ts).
 bible jsonb not null check(jsonb_typeof(bible)='object'),
 -- What the story knows after the latest finished episode: where everyone is, what changed, open threads.
 story_state jsonb not null default '{}' check(jsonb_typeof(story_state)='object'),
 writer text not null default 'showrunner-v1' check(char_length(writer) between 1 and 60),
 -- The cast still taken from episode 1's first shot; every episode opens from it so faces do not drift.
 key_still_path text check(key_still_path is null or key_still_path like 'owner/'||owner_id::text||'/drama/%'),
 next_episode_number integer not null default 1 check(next_episode_number>=1),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
create index drama_series_owner on public.drama_series(owner_id,status,created_at);

create table public.drama_episodes (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 series_id uuid not null,
 number integer not null check(number>=1),
 phase text not null check(char_length(phase) between 1 and 30),
 title text not null check(char_length(title) between 1 and 160),
 summary text not null check(char_length(summary) between 1 and 2000),
 cliffhanger text not null default '' check(char_length(cliffhanger)<=600),
 -- TikTok caption and hashtags the finished episode carries into the library.
 caption text not null check(char_length(caption) between 1 and 2200),
 hashtags jsonb not null default '[]' check(jsonb_typeof(hashtags)='array'),
 status text not null default 'PRODUCING' check(status in ('PRODUCING','ASSEMBLING','READY','FAILED')),
 -- The story state this episode leaves behind; copied to the series once the episode is cut.
 state_after jsonb not null default '{}' check(jsonb_typeof(state_after)='object'),
 -- Bangkok day the episode was started, for the episodes-per-day limit.
 started_on date not null,
 -- The finished episode in the clip library (kind DRAMA).
 flow_clip_id uuid,
 assemble_attempts integer not null default 0 check(assemble_attempts between 0 and 20),
 error text check(error is null or char_length(error)<=500),
 ready_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 unique(series_id,number),
 foreign key(owner_id,series_id) references public.drama_series(owner_id,id) on delete cascade,
 foreign key(owner_id,flow_clip_id) references public.flow_clips(owner_id,id) on delete set null (flow_clip_id)
);
create index drama_episodes_open on public.drama_episodes(owner_id,status,series_id,number);

create table public.drama_shots (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id) on delete cascade,
 series_id uuid not null,
 episode_id uuid not null,
 position integer not null check(position between 1 and 6),
 prompt text not null check(char_length(prompt) between 1 and 12000),
 -- Thai line spoken in the shot, burned in as a subtitle when the episode is cut.
 subtitle text not null default '' check(char_length(subtitle)<=200),
 -- What the worker attaches in Flow: nothing, the series key still, or the previous shot's last frame.
 reference_mode text not null check(reference_mode in ('NONE','KEY_STILL','PREVIOUS_FRAME')),
 status text not null default 'PLANNED' check(status in ('PLANNED','QUEUED','DONE','FAILED','SKIPPED')),
 flow_clip_id uuid,
 attempts integer not null default 0 check(attempts between 0 and 20),
 -- Out of credits: try again from this time (the next Bangkok day).
 retry_after timestamptz,
 last_frame_path text check(last_frame_path is null or last_frame_path like 'owner/'||owner_id::text||'/drama/%'),
 video_path text check(video_path is null or video_path like 'owner/'||owner_id::text||'/flow-clips/%'),
 duration_seconds numeric(8,3) check(duration_seconds is null or duration_seconds>0),
 error text check(error is null or char_length(error)<=500),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id),
 unique(episode_id,position),
 foreign key(owner_id,series_id) references public.drama_series(owner_id,id) on delete cascade,
 foreign key(owner_id,episode_id) references public.drama_episodes(owner_id,id) on delete cascade,
 foreign key(owner_id,flow_clip_id) references public.flow_clips(owner_id,id) on delete set null (flow_clip_id)
);
create index drama_shots_episode on public.drama_shots(owner_id,episode_id,position);
-- One shot of a series in the Flow queue at a time: the next one needs this one's last frame.
create unique index drama_shots_one_queued on public.drama_shots(series_id) where status='QUEUED';

alter table public.drama_series enable row level security;
alter table public.drama_episodes enable row level security;
alter table public.drama_shots enable row level security;
create policy drama_series_read on public.drama_series for select to authenticated using(owner_id=(select auth.uid()));
create policy drama_episodes_read on public.drama_episodes for select to authenticated using(owner_id=(select auth.uid()));
create policy drama_shots_read on public.drama_shots for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.drama_series,public.drama_episodes,public.drama_shots from public,anon,authenticated;
grant select on public.drama_series,public.drama_episodes,public.drama_shots to authenticated;
grant all on public.drama_series,public.drama_episodes,public.drama_shots to service_role;
