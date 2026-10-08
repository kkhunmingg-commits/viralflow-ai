-- Shared POST/LIVE compliance evidence. No grants let a member manufacture a
-- verdict, verify a claim, activate a policy, or turn one feedback event into a rule.
create table public.compliance_brain_policy_versions (
  version text primary key check(char_length(version) between 1 and 120),
  platform text not null check(char_length(platform) between 1 and 80),
  country text not null check(country ~ '^[A-Z]{2}$'),
  region text not null default '*' check(char_length(region) between 1 and 80),
  status text not null default 'DISCOVERED' check(status in ('DISCOVERED','PARSED','VALIDATED','ACTIVE','RETIRED')),
  effective_at timestamptz not null,
  source_refs_json jsonb not null default '[]' check(jsonb_typeof(source_refs_json)='array'),
  pack_json jsonb not null check(jsonb_typeof(pack_json)='object'),
  checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
  signature text not null check(char_length(signature) between 16 and 4096),
  validation_hash text check(validation_hash is null or validation_hash ~ '^[a-f0-9]{64}$'),
  validated_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  check(status <> 'ACTIVE' or (validated_at is not null and validation_hash is not null and activated_at is not null))
);
create unique index compliance_brain_one_active_policy_idx
  on public.compliance_brain_policy_versions(platform,country,region) where status='ACTIVE';

create table public.compliance_brain_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null,
  kind text not null check(kind in ('PDP','SELLER_DOCUMENT','PRODUCT_LABEL','CERTIFICATE','REGISTRATION','STUDY','PROMOTION','MEDIA_REVIEW')),
  source_url text not null check(char_length(source_url) between 1 and 2048),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  jurisdiction text not null check(jurisdiction ~ '^[A-Z]{2}$'),
  verified boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,product_id,id),
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade
);
create index compliance_brain_evidence_product_idx on public.compliance_brain_evidence(owner_id,product_id);

create table public.compliance_brain_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null,
  claim_text text not null check(char_length(claim_text) between 1 and 2000),
  claim_type text not null check(char_length(claim_type) between 1 and 80),
  source text not null check(char_length(source) between 1 and 2048),
  evidence_refs uuid[] not null default '{}',
  jurisdiction text not null check(jurisdiction ~ '^[A-Z]{2}$'),
  expires_at timestamptz,
  verified boolean not null default false,
  allowed_channels text[] not null default '{}' check(allowed_channels <@ array['POST','LIVE']::text[]),
  conditions text[] not null default '{}',
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  check(not verified or (cardinality(evidence_refs)>0 and cardinality(allowed_channels)>0))
);
create index compliance_brain_claims_product_idx on public.compliance_brain_claims(owner_id,product_id);

create table public.compliance_brain_media_reviews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null,
  account_id uuid,
  asset_hash text not null check(asset_hash ~ '^[a-f0-9]{64}$'),
  evidence_id uuid not null,
  transcript text not null default '' check(char_length(transcript)<=50000),
  on_screen_text text[] not null default '{}',
  cover_text text not null default '' check(char_length(cover_text)<=5000),
  visible_claims text[] not null default '{}',
  metadata text[] not null default '{}',
  ai_disclosed boolean not null default false,
  coverage_complete boolean not null default false,
  reviewed_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(owner_id,product_id,asset_hash),
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  foreign key(owner_id,account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id,evidence_id) references public.compliance_brain_evidence(owner_id,product_id,id)
);
create index compliance_brain_media_review_owner_asset_idx on public.compliance_brain_media_reviews(owner_id,product_id,asset_hash);

create table public.compliance_brain_decisions (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null,
  account_id uuid,
  channel text not null check(channel in ('POST','LIVE')),
  stage text not null check(stage in ('PRE_GENERATION','POST_GENERATION','FINAL_PUBLISH','LIVE_SPEECH')),
  platform text not null,
  country text not null check(country ~ '^[A-Z]{2}$'),
  region text not null,
  category text not null,
  category_risk text not null check(category_risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
  policy_version text references public.compliance_brain_policy_versions(version),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check(decision in ('PASS','PASS_WITH_WARNING','AUTO_REWRITE','REVIEW_REQUIRED','BLOCK')),
  risk_score numeric(6,3) not null check(risk_score between 0 and 100),
  policy_refs text[] not null default '{}',
  claim_refs uuid[] not null default '{}',
  evidence_refs uuid[] not null default '{}',
  reasons jsonb not null default '[]' check(jsonb_typeof(reasons)='array'),
  rewrites_json jsonb not null default '[]' check(jsonb_typeof(rewrites_json)='array'),
  rewritten boolean generated always as (decision in ('PASS','PASS_WITH_WARNING') and jsonb_array_length(rewrites_json)>0) stored,
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  foreign key(owner_id,account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  check(channel='LIVE' or stage <> 'LIVE_SPEECH')
);
create index compliance_brain_decisions_account_time_idx on public.compliance_brain_decisions(owner_id,account_id,checked_at desc);
create index compliance_brain_decisions_product_time_idx on public.compliance_brain_decisions(owner_id,product_id,checked_at desc);

create table private.compliance_brain_feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  decision_id uuid not null,
  event_key text not null check(char_length(event_key) between 1 and 160),
  event_type text not null check(event_type in ('content_generated','compliance_flag','human_edit','publish','platform_warning','violation','appeal_submitted','appeal_accepted','appeal_rejected','content_removed')),
  source text not null check(source in ('SYSTEM','HUMAN_CORRECTION','OFFICIAL_PLATFORM')),
  platform_reason_code text check(platform_reason_code is null or char_length(platform_reason_code)<=160),
  platform_reason_text text check(platform_reason_text is null or char_length(platform_reason_text)<=4000),
  platform_evidence_ref text check(platform_evidence_ref is null or char_length(platform_evidence_ref) between 1 and 2048),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(owner_id,event_key),
  foreign key(owner_id,decision_id) references public.compliance_brain_decisions(owner_id,id) on delete cascade,
  check((source='SYSTEM' and event_type in ('content_generated','compliance_flag','publish'))
    or (source='HUMAN_CORRECTION' and event_type='human_edit')
    or (source='OFFICIAL_PLATFORM' and event_type in ('platform_warning','violation','appeal_submitted','appeal_accepted','appeal_rejected','content_removed')
      and platform_evidence_ref is not null))
);
create index compliance_brain_feedback_owner_decision_idx on private.compliance_brain_feedback(owner_id,decision_id);

create table private.compliance_brain_audits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  decision_id uuid,
  policy_version text references public.compliance_brain_policy_versions(version),
  actor_id uuid not null,
  event_type text not null check(event_type in ('DECISION_RECORDED','EVIDENCE_VERIFIED','CLAIM_VERIFIED','POLICY_ACTIVATED','POLICY_RETIRED','POLICY_ROLLBACK','LEARNING_APPROVED')),
  detail_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key(owner_id,decision_id) references public.compliance_brain_decisions(owner_id,id) on delete cascade,
  check(decision_id is null or owner_id is not null)
);

-- Typed aggregate columns intentionally have no tenant/product/decision IDs,
-- scripts, snippets, sales, comments, free-text reasons, or arbitrary JSON.
create table private.compliance_brain_learning_patterns (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null references public.compliance_brain_policy_versions(version),
  semantic_category text not null check(semantic_category in ('MEDICAL_TREATMENT','DISEASE_PREVENTION','DIAGNOSIS','GUARANTEED_RESULT','ABSOLUTE_CLAIM','TIME_BOUND_RESULT','EXAGGERATED_FUNCTIONALITY','FAKE_CERTIFICATION','UNSUPPORTED_SUPERIORITY','MISLEADING_COMPARISON','FAKE_SCARCITY','MISLEADING_PRICE','FAKE_TESTIMONIAL','FALSE_BEFORE_AFTER','BODY_MANIPULATION','UNSUPPORTED_FEATURE','REPLACEMENT_FOR_MEDICAL_CARE','RESTRICTED_PRODUCT','UNKNOWN_FACT','AIGC_DISCLOSURE','VISUAL_MISMATCH')),
  category text not null check(category in ('SKINCARE','BEAUTY','HEALTH','GENERAL_COMMERCE','ELECTRONICS','FOOD','HOUSEHOLD','OTHER')),
  country text not null check(country ~ '^[A-Z]{2}$'),
  platform text not null check(platform in ('TIKTOK','TIKTOK_SHOP')),
  channel text not null check(channel in ('POST','LIVE')),
  lifecycle text not null default 'OBSERVED' check(lifecycle in ('OBSERVED','LEARNED_RISK','SHADOW','VERIFIED','ENFORCED')),
  evidence_source text not null check(evidence_source in ('OFFICIAL_POLICY','OFFICIAL_PLATFORM','HUMAN_CORRECTION','SHADOW_EVALUATION')),
  sample_count integer not null check(sample_count>=0),
  tenant_count integer not null check(tenant_count>=0 and tenant_count<=sample_count),
  violation_count integer not null default 0 check(violation_count>=0 and violation_count<=sample_count),
  appeal_accepted_count integer not null default 0 check(appeal_accepted_count>=0 and appeal_accepted_count<=sample_count),
  appeal_rejected_count integer not null default 0 check(appeal_rejected_count>=0 and appeal_rejected_count<=sample_count),
  false_positive_rate numeric(6,5) not null check(false_positive_rate between 0 and 1),
  confidence numeric(6,5) not null check(confidence between 0 and 1),
  risk_score numeric(6,3) not null check(risk_score between 0 and 100),
  shadow_would_block integer not null default 0 check(shadow_would_block>=0),
  shadow_would_rewrite integer not null default 0 check(shadow_would_rewrite>=0),
  shadow_evaluated_count integer not null default 0 check(shadow_evaluated_count>=0),
  shadow_unavailable_count integer not null default 0 check(shadow_unavailable_count>=0),
  approved boolean not null default false,
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(policy_version,semantic_category,category,country,platform,channel),
  check(shadow_would_block+shadow_would_rewrite<=shadow_evaluated_count),
  check(lifecycle not in ('VERIFIED','ENFORCED') or (sample_count>=20 and tenant_count>=5 and confidence>=0.9 and false_positive_rate<=0.05 and approved))
);

create function private.compliance_brain_validate_claim_refs()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from unnest(new.evidence_refs) as ref(id)
    where not exists(select 1 from public.compliance_brain_evidence e
      where e.id=ref.id and e.owner_id=new.owner_id and e.product_id=new.product_id
        and (not new.verified or (e.verified and e.jurisdiction=new.jurisdiction)))) then
    raise exception 'compliance_evidence_scope_or_verification_invalid';
  end if;
  return new;
end $$;
create trigger compliance_brain_claim_refs before insert or update on public.compliance_brain_claims
  for each row execute function private.compliance_brain_validate_claim_refs();

create function private.compliance_brain_validate_media_review()
returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.compliance_brain_evidence e where e.id=new.evidence_id and e.owner_id=new.owner_id
    and e.product_id=new.product_id and e.kind='MEDIA_REVIEW' and e.verified and e.source_hash=new.asset_hash) then
    raise exception 'compliance_media_review_evidence_invalid';
  end if;
  return new;
end $$;
create trigger compliance_brain_media_review_evidence before insert or update on public.compliance_brain_media_reviews
  for each row execute function private.compliance_brain_validate_media_review();

create function private.compliance_brain_validate_decision_refs()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.checked_at > clock_timestamp() then
    raise exception 'compliance_decision_checked_at_future';
  end if;
  if exists(select 1 from unnest(new.claim_refs) as ref(id)
    where not exists(select 1 from public.compliance_brain_claims c where c.id=ref.id and c.owner_id=new.owner_id and c.product_id=new.product_id))
    or exists(select 1 from unnest(new.evidence_refs) as ref(id)
    where not exists(select 1 from public.compliance_brain_evidence e where e.id=ref.id and e.owner_id=new.owner_id and e.product_id=new.product_id)) then
    raise exception 'compliance_decision_reference_scope_invalid';
  end if;
  return new;
end $$;
create trigger compliance_brain_decision_refs before insert on public.compliance_brain_decisions
  for each row execute function private.compliance_brain_validate_decision_refs();

create function private.compliance_brain_immutable_decision()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'compliance_decision_immutable';
end $$;
create trigger compliance_brain_decision_immutable before update on public.compliance_brain_decisions
  for each row execute function private.compliance_brain_immutable_decision();

create function private.compliance_brain_policy_immutable_payload()
returns trigger language plpgsql set search_path='' as $$
begin
  -- A version remains the same identity throughout its lifecycle. Once reviewed,
  -- it cannot return to a draft state and escape the immutable-payload guard.
  if new.version is distinct from old.version or
    (old.status in ('VALIDATED','ACTIVE','RETIRED') and new.status in ('DISCOVERED','PARSED')) then
    raise exception 'compliance_policy_version_immutable';
  end if;
  if old.status in ('VALIDATED','ACTIVE','RETIRED') and
    (new.pack_json is distinct from old.pack_json or new.checksum is distinct from old.checksum
      or new.signature is distinct from old.signature or new.source_refs_json is distinct from old.source_refs_json
      or new.platform is distinct from old.platform or new.country is distinct from old.country
      or new.region is distinct from old.region or new.effective_at is distinct from old.effective_at
      or new.validation_hash is distinct from old.validation_hash or new.validated_at is distinct from old.validated_at) then
    raise exception 'compliance_policy_version_immutable';
  end if;
  return new;
end $$;
create trigger compliance_brain_policy_payload before update on public.compliance_brain_policy_versions
  for each row execute function private.compliance_brain_policy_immutable_payload();

alter table public.compliance_brain_policy_versions enable row level security;
alter table public.compliance_brain_evidence enable row level security;
alter table public.compliance_brain_claims enable row level security;
alter table public.compliance_brain_media_reviews enable row level security;
alter table public.compliance_brain_decisions enable row level security;
alter table private.compliance_brain_feedback enable row level security;
alter table private.compliance_brain_audits enable row level security;
alter table private.compliance_brain_learning_patterns enable row level security;

revoke all on public.compliance_brain_policy_versions,public.compliance_brain_evidence,public.compliance_brain_claims,public.compliance_brain_media_reviews,public.compliance_brain_decisions from public,anon,authenticated,service_role;
revoke all on private.compliance_brain_feedback,private.compliance_brain_audits,private.compliance_brain_learning_patterns from public,anon,authenticated,service_role;
grant select on public.compliance_brain_policy_versions,public.compliance_brain_evidence,public.compliance_brain_claims,public.compliance_brain_media_reviews to authenticated;
-- Customer accounts receive only the fields needed for aggregate safety counts.
grant select(id,owner_id,account_id,channel,stage,content_hash,decision,rewritten,checked_at) on public.compliance_brain_decisions to authenticated;
grant select,insert,update on public.compliance_brain_policy_versions,public.compliance_brain_evidence,public.compliance_brain_claims,public.compliance_brain_media_reviews to service_role;
grant select,insert on public.compliance_brain_decisions to service_role;
grant usage on schema private to service_role;
grant select,insert on private.compliance_brain_feedback,private.compliance_brain_audits to service_role;
grant select,insert,update on private.compliance_brain_learning_patterns to service_role;

create policy compliance_brain_policy_read on public.compliance_brain_policy_versions for select to authenticated using(status in ('ACTIVE','RETIRED'));
create policy compliance_brain_evidence_read on public.compliance_brain_evidence for select to authenticated using((select auth.uid())=owner_id);
create policy compliance_brain_claims_read on public.compliance_brain_claims for select to authenticated using((select auth.uid())=owner_id);
create policy compliance_brain_media_reviews_read on public.compliance_brain_media_reviews for select to authenticated using((select auth.uid())=owner_id);
create policy compliance_brain_decisions_read on public.compliance_brain_decisions for select to authenticated using((select auth.uid())=owner_id);

revoke all on function private.compliance_brain_validate_claim_refs(),private.compliance_brain_validate_media_review(),private.compliance_brain_validate_decision_refs(),private.compliance_brain_immutable_decision(),private.compliance_brain_policy_immutable_payload() from public,anon,authenticated;

create function public.activate_compliance_brain_policy(p_version text,p_actor uuid,p_rollback boolean default false)
returns void language plpgsql set search_path='' as $$
declare selected public.compliance_brain_policy_versions%rowtype;
begin
  if p_actor is null then raise exception 'compliance_policy_actor_required'; end if;
  select * into selected from public.compliance_brain_policy_versions where version=p_version for update;
  if not found or selected.status not in ('VALIDATED','RETIRED') or selected.validated_at is null
    or selected.validation_hash is null or selected.effective_at>now() then
    raise exception 'compliance_policy_not_validated_or_effective';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(selected.platform||':'||selected.country||':'||selected.region,0));
  update public.compliance_brain_policy_versions set status='RETIRED',retired_at=now()
    where platform=selected.platform and country=selected.country and region=selected.region and status='ACTIVE';
  update public.compliance_brain_policy_versions set status='ACTIVE',activated_at=now(),retired_at=null where version=p_version;
  insert into private.compliance_brain_audits(actor_id,policy_version,event_type)
    values(p_actor,p_version,case when p_rollback then 'POLICY_ROLLBACK' else 'POLICY_ACTIVATED' end);
end $$;
revoke all on function public.activate_compliance_brain_policy(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.activate_compliance_brain_policy(text,uuid,boolean) to service_role;

create function public.deactivate_compliance_brain_policy(p_version text,p_actor uuid)
returns void language plpgsql set search_path='' as $$
begin
  if p_actor is null then raise exception 'compliance_policy_actor_required'; end if;
  update public.compliance_brain_policy_versions set status='RETIRED',retired_at=now()
    where version=p_version and status='ACTIVE';
  if not found then raise exception 'compliance_policy_not_active'; end if;
  insert into private.compliance_brain_audits(actor_id,policy_version,event_type)
    values(p_actor,p_version,'POLICY_RETIRED');
end $$;
revoke all on function public.deactivate_compliance_brain_policy(text,uuid) from public,anon,authenticated;
grant execute on function public.deactivate_compliance_brain_policy(text,uuid) to service_role;

comment on table public.compliance_brain_decisions is 'Immutable owner-isolated POST/LIVE decisions. Customer column grants expose aggregate inputs only; raw content is not persisted.';
comment on table private.compliance_brain_learning_patterns is 'Anonymized typed compliance aggregates only. No customer content or identifiers. A single feedback event cannot become an enforced global rule.';

-- Private data stays outside the exposed schemas. These explicit service-only
-- invoker RPCs provide transactional access without exposing private tables.
create function public.record_compliance_brain_decision(p_decision jsonb)
returns uuid language plpgsql set search_path='' as $$
declare input public.compliance_brain_decisions%rowtype;
  existing public.compliance_brain_decisions%rowtype;
  feedback private.compliance_brain_feedback%rowtype;
  feedback_event text;
  inserted integer;
begin
  select * into input from jsonb_populate_record(null::public.compliance_brain_decisions,p_decision);
  insert into public.compliance_brain_decisions(id,owner_id,product_id,account_id,channel,stage,platform,country,region,category,
    category_risk,policy_version,content_hash,decision,risk_score,policy_refs,claim_refs,evidence_refs,reasons,rewrites_json,checked_at)
  values(input.id,input.owner_id,input.product_id,input.account_id,input.channel,input.stage,input.platform,input.country,input.region,input.category,
    input.category_risk,input.policy_version,input.content_hash,input.decision,input.risk_score,input.policy_refs,input.claim_refs,input.evidence_refs,input.reasons,input.rewrites_json,input.checked_at)
  on conflict(id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then
    select * into existing from public.compliance_brain_decisions where id=input.id;
    if (to_jsonb(existing)-'created_at'-'rewritten') is distinct from (to_jsonb(input)-'created_at'-'rewritten') then
      raise exception 'compliance_decision_identity_conflict';
    end if;
  else
    insert into private.compliance_brain_audits(owner_id,decision_id,actor_id,event_type,policy_version)
      values(input.owner_id,input.id,input.owner_id,'DECISION_RECORDED',input.policy_version);
  end if;
  feedback_event := case when input.decision in ('PASS','PASS_WITH_WARNING') then 'content_generated' else 'compliance_flag' end;
  insert into private.compliance_brain_feedback(owner_id,decision_id,event_key,event_type,source,observed_at)
    values(input.owner_id,input.id,'decision:'||input.id::text,feedback_event,'SYSTEM',input.checked_at)
    on conflict(owner_id,event_key) do nothing;
  select * into feedback from private.compliance_brain_feedback
    where owner_id=input.owner_id and event_key='decision:'||input.id::text;
  if feedback.decision_id is distinct from input.id or feedback.event_type is distinct from feedback_event
    or feedback.source is distinct from 'SYSTEM' or feedback.observed_at is distinct from input.checked_at
    or feedback.platform_reason_code is not null or feedback.platform_reason_text is not null or feedback.platform_evidence_ref is not null then
    raise exception 'compliance_decision_feedback_identity_conflict';
  end if;
  return input.id;
end $$;
revoke all on function public.record_compliance_brain_decision(jsonb) from public,anon,authenticated;
grant execute on function public.record_compliance_brain_decision(jsonb) to service_role;

create function public.append_compliance_brain_feedback(p_feedback jsonb)
returns uuid language plpgsql set search_path='' as $$
declare input private.compliance_brain_feedback%rowtype;
  existing private.compliance_brain_feedback%rowtype;
  result uuid;
begin
  select * into input from jsonb_populate_record(null::private.compliance_brain_feedback,p_feedback);
  insert into private.compliance_brain_feedback(owner_id,decision_id,event_key,event_type,source,platform_reason_code,platform_reason_text,platform_evidence_ref,observed_at)
    values(input.owner_id,input.decision_id,input.event_key,input.event_type,input.source,input.platform_reason_code,input.platform_reason_text,input.platform_evidence_ref,coalesce(input.observed_at,now()))
    on conflict(owner_id,event_key) do nothing returning id into result;
  if result is null then
    select * into existing from private.compliance_brain_feedback where owner_id=input.owner_id and event_key=input.event_key;
    if existing.decision_id is distinct from input.decision_id or existing.event_type is distinct from input.event_type
      or existing.source is distinct from input.source or existing.platform_reason_code is distinct from input.platform_reason_code
      or existing.platform_reason_text is distinct from input.platform_reason_text
      or existing.platform_evidence_ref is distinct from input.platform_evidence_ref then
      raise exception 'compliance_feedback_identity_conflict';
    end if;
    result=existing.id;
  end if;
  return result;
end $$;
revoke all on function public.append_compliance_brain_feedback(jsonb) from public,anon,authenticated;
grant execute on function public.append_compliance_brain_feedback(jsonb) to service_role;

create function public.read_compliance_brain_learning_patterns()
returns setof private.compliance_brain_learning_patterns language sql stable set search_path='' as $$
  select * from private.compliance_brain_learning_patterns order by updated_at desc limit 200;
$$;
revoke all on function public.read_compliance_brain_learning_patterns() from public,anon,authenticated;
grant execute on function public.read_compliance_brain_learning_patterns() to service_role;

-- One statement gives the internal collector a consistent bounded snapshot.
-- Identifiers are transient cohort/deduplication inputs; customer text and
-- evidence links never enter this projection or global learned patterns.
create function public.read_compliance_brain_learning_observations(p_policy_version text,p_limit integer default 5000)
returns jsonb language sql stable set search_path='' as $$
  with bounds as (select greatest(1,least(coalesce(p_limit,5000),10000)) as cap),
  sample as materialized (
    select f.id as event_id,f.owner_id,f.decision_id,f.event_type,f.source,d.policy_version,
      array(select distinct reason.value->>'category' from jsonb_array_elements(d.reasons) as reason(value)
        where reason.value->>'category' in ('MEDICAL_TREATMENT','DISEASE_PREVENTION','DIAGNOSIS','GUARANTEED_RESULT','ABSOLUTE_CLAIM','TIME_BOUND_RESULT','EXAGGERATED_FUNCTIONALITY','FAKE_CERTIFICATION','UNSUPPORTED_SUPERIORITY','MISLEADING_COMPARISON','FAKE_SCARCITY','MISLEADING_PRICE','FAKE_TESTIMONIAL','FALSE_BEFORE_AFTER','BODY_MANIPULATION','UNSUPPORTED_FEATURE','REPLACEMENT_FOR_MEDICAL_CARE','RESTRICTED_PRODUCT','UNKNOWN_FACT','AIGC_DISCLOSURE','VISUAL_MISMATCH')
        order by 1) as semantic_categories,
      d.category,d.country,d.platform,d.channel,d.risk_score,d.decision,f.observed_at
    from private.compliance_brain_feedback f join public.compliance_brain_decisions d
      on d.owner_id=f.owner_id and d.id=f.decision_id
    where d.policy_version=p_policy_version and d.policy_version is not null
    order by f.id limit (select cap+1 from bounds)
  )
  select jsonb_build_object('snapshot_at',statement_timestamp(),'complete',(select count(*)<=(select cap from bounds) from sample),
    'observations',(select coalesce(jsonb_agg(to_jsonb(observation) order by observation.event_id),'[]'::jsonb)
      from (select * from sample order by event_id limit (select cap from bounds)) as observation));
$$;
revoke all on function public.read_compliance_brain_learning_observations(text,integer) from public,anon,authenticated;
grant execute on function public.read_compliance_brain_learning_observations(text,integer) to service_role;

create function public.upsert_compliance_brain_learning_pattern(p_pattern jsonb,p_actor uuid default null)
returns uuid language plpgsql set search_path='' as $$
declare input private.compliance_brain_learning_patterns%rowtype;
  result uuid;
  mutated boolean;
begin
  if exists(select 1 from jsonb_object_keys(p_pattern) as key(value)
    where key.value not in ('policy_version','semantic_category','category','country','platform','channel','lifecycle','evidence_source','sample_count','tenant_count','violation_count','appeal_accepted_count','appeal_rejected_count','false_positive_rate','confidence','risk_score','shadow_would_block','shadow_would_rewrite','shadow_evaluated_count','shadow_unavailable_count','approved','observed_at')) then
    raise exception 'compliance_learning_unexpected_field';
  end if;
  select * into input from jsonb_populate_record(null::private.compliance_brain_learning_patterns,p_pattern);
  if input.observed_at>clock_timestamp() then
    raise exception 'compliance_learning_snapshot_future';
  end if;
  if (input.approved or input.lifecycle in ('VERIFIED','ENFORCED')) and p_actor is null then
    raise exception 'compliance_learning_approval_actor_required';
  end if;
  insert into private.compliance_brain_learning_patterns as current_pattern(policy_version,semantic_category,category,country,platform,channel,lifecycle,evidence_source,
    sample_count,tenant_count,violation_count,appeal_accepted_count,appeal_rejected_count,false_positive_rate,confidence,risk_score,
    shadow_would_block,shadow_would_rewrite,shadow_evaluated_count,shadow_unavailable_count,approved,observed_at)
  values(input.policy_version,input.semantic_category,input.category,input.country,input.platform,input.channel,input.lifecycle,input.evidence_source,
    input.sample_count,input.tenant_count,input.violation_count,input.appeal_accepted_count,input.appeal_rejected_count,input.false_positive_rate,input.confidence,input.risk_score,
    input.shadow_would_block,input.shadow_would_rewrite,coalesce(input.shadow_evaluated_count,0),coalesce(input.shadow_unavailable_count,0),coalesce(input.approved,false),coalesce(input.observed_at,now()))
  on conflict(policy_version,semantic_category,category,country,platform,channel) do update set
    lifecycle=excluded.lifecycle,evidence_source=excluded.evidence_source,sample_count=excluded.sample_count,tenant_count=excluded.tenant_count,
    violation_count=excluded.violation_count,appeal_accepted_count=excluded.appeal_accepted_count,appeal_rejected_count=excluded.appeal_rejected_count,
    false_positive_rate=excluded.false_positive_rate,confidence=excluded.confidence,risk_score=excluded.risk_score,
    shadow_would_block=excluded.shadow_would_block,shadow_would_rewrite=excluded.shadow_would_rewrite,
    shadow_evaluated_count=excluded.shadow_evaluated_count,shadow_unavailable_count=excluded.shadow_unavailable_count,
    approved=excluded.approved,observed_at=excluded.observed_at,updated_at=now()
  where current_pattern.observed_at<=excluded.observed_at
    and (current_pattern.lifecycle not in ('VERIFIED','ENFORCED') or excluded.approved)
  returning id into result;
  mutated := result is not null;
  if result is null then
    select id into result from private.compliance_brain_learning_patterns
      where policy_version=input.policy_version and semantic_category=input.semantic_category and category=input.category
        and country=input.country and platform=input.platform and channel=input.channel;
  end if;
  if input.approved and mutated then
    insert into private.compliance_brain_audits(actor_id,policy_version,event_type,detail_codes)
      values(p_actor,input.policy_version,'LEARNING_APPROVED',array[input.lifecycle,input.semantic_category]);
  end if;
  return result;
end $$;
revoke all on function public.upsert_compliance_brain_learning_pattern(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.upsert_compliance_brain_learning_pattern(jsonb,uuid) to service_role;
