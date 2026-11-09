-- Product clips from a link: 24- and 40-second clips (3 and 5 Flow takes) besides 8 / 16 / 32.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.product_link_clips'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%length_seconds%' loop
    execute format('alter table public.product_link_clips drop constraint %I', c);
  end loop;
end $$;
alter table public.product_link_clips add constraint product_link_clips_length_seconds_check check(length_seconds in (8,16,24,32,40));
