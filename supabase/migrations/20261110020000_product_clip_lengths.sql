-- Product clips from a link: 24- and 40-second clips (3 and 5 Flow takes) besides 8 / 16 / 32.
alter table public.product_link_clips drop constraint if exists product_link_clips_length_seconds_check;
alter table public.product_link_clips add constraint product_link_clips_length_seconds_check check(length_seconds in (8,16,24,32,40));
