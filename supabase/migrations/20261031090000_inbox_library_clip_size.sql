-- Library clips are sent server to TikTok, so they are not bound by the 4 MB browser upload limit.
alter table public.tiktok_inbox_uploads drop constraint if exists tiktok_inbox_uploads_video_size_check;
alter table public.tiktok_inbox_uploads add constraint tiktok_inbox_uploads_video_size_check check (video_size between 1000 and 50000000);
