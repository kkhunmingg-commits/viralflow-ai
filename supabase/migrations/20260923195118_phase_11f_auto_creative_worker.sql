-- Phase 11F Auto worker: keep the user-session RPC unchanged while permitting a
-- server-only, owner-attested atomic creative save after START has returned.
create function public.save_auto_creative_generation(
  p_owner_id uuid, p_project_id uuid, p_generation jsonb, p_angles jsonb, p_scripts jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare generation_id uuid;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message='Service role required';
  end if;
  if p_owner_id is null or p_project_id is null
     or jsonb_typeof(p_generation) is distinct from 'object'
     or jsonb_typeof(p_angles) is distinct from 'array'
     or jsonb_typeof(p_scripts) is distinct from 'array'
     or jsonb_array_length(p_angles)=0
     or jsonb_array_length(p_angles)<>jsonb_array_length(p_scripts) then
    raise exception 'Invalid Auto creative payload';
  end if;
  if (p_generation->>'owner_id')::uuid is distinct from p_owner_id
     or (p_generation->>'creative_project_id')::uuid is distinct from p_project_id
     or exists(select 1 from jsonb_array_elements(p_angles) as angle(value)
       where (angle.value->>'owner_id')::uuid is distinct from p_owner_id
          or (angle.value->>'creative_project_id')::uuid is distinct from p_project_id)
     or exists(select 1 from jsonb_array_elements(p_scripts) as script(value)
       where (script.value->>'owner_id')::uuid is distinct from p_owner_id
          or (script.value->>'creative_project_id')::uuid is distinct from p_project_id
          or not exists(select 1 from jsonb_array_elements(p_angles) as angle(value)
            where angle.value->>'id'=script.value->>'creative_angle_id')) then
    raise insufficient_privilege using message='Auto creative owner mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||p_project_id::text,0));
  perform 1 from public.creative_projects where id=p_project_id and owner_id=p_owner_id for update;
  if not found then raise insufficient_privilege using message='Creative project not found'; end if;
  insert into public.creative_generations
    select * from jsonb_populate_record(null::public.creative_generations,p_generation)
    returning id into generation_id;
  insert into public.creative_angles
    select * from jsonb_populate_recordset(null::public.creative_angles,p_angles);
  insert into public.scripts
    select * from jsonb_populate_recordset(null::public.scripts,p_scripts);
  update public.creative_projects set status='READY' where id=p_project_id and owner_id=p_owner_id;
  return generation_id;
end $$;
revoke all on function public.save_auto_creative_generation(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_auto_creative_generation(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
