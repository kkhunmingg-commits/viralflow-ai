-- Phase 11D: indexes tied to bounded UI reads, recovery scans, and analytics detail lookups.
-- No table, policy, or function semantics change. Tables are currently small; normal
-- transactional CREATE INDEX avoids nontransactional concurrent DDL in the migration runner.

create index if not exists publishing_queue_owner_priority_page_idx
  on public.publishing_queue(owner_id,priority desc,created_at,id);
create index if not exists master_videos_owner_updated_page_idx
  on public.master_videos(owner_id,updated_at desc,id desc);
create index if not exists operations_incidents_owner_seen_page_idx
  on public.operations_incidents(owner_id,last_seen_at desc,id desc);
create index if not exists auto_runs_owner_recent_page_idx
  on public.auto_runs(owner_id,updated_at desc,id desc);
create index if not exists publish_attempts_owner_recent_idx
  on public.publish_attempts(owner_id,created_at desc);
create index if not exists generation_jobs_owner_master_recent_idx
  on public.generation_jobs(owner_id,master_video_id,created_at desc);

create index if not exists video_analytics_owner_video_time_idx
  on public.video_analytics_snapshots(owner_id,video_id,source_snapshot_at desc);
create index if not exists video_analytics_owner_product_time_idx
  on public.video_analytics_snapshots(owner_id,product_id,source_snapshot_at desc)
  where product_id is not null;
create index if not exists winner_scores_owner_video_time_idx
  on public.winner_scores(owner_id,video_id,evaluated_at desc);

-- The recovery service scans only these nonterminal or failed states by id.
create index if not exists publishing_queue_recovery_scan_idx
  on public.publishing_queue(id)
  where status in ('UPLOADING','PROCESSING','WAITING_FOR_RECONCILIATION','RETRYING','FAILED');
create index if not exists auto_runs_recovery_scan_idx
  on public.auto_runs(id)
  where state in ('STARTING','RUNNING','RETRY_PENDING','FAILED');
create index if not exists generation_jobs_recovery_scan_idx
  on public.generation_jobs(id)
  where status in ('PROCESSING','RETRYING','FAILED');
