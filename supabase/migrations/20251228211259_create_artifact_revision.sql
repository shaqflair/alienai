create or replace function public.create_artifact_revision(
  p_project_id uuid,
  p_artifact_id uuid,
  p_title text,
  p_content text,
  p_content_json jsonb
) returns uuid
language plpgsql
security definer
as $$
declare
  a record;
  new_id uuid;
  next_version int;
  root_id uuid;
begin
  select * into a
  from public.artifacts
  where id = p_artifact_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'Artifact not found';
  end if;

  root_id := coalesce(a.root_artifact_id, a.id);
  next_version := coalesce(a.version, 1) + 1;

  update public.artifacts
    set is_current = false,
        updated_at = now()
  where id = a.id;

  insert into public.artifacts (
    project_id, user_id, type, title, content, content_json,
    is_locked, locked_at, locked_by,
    version, parent_artifact_id, root_artifact_id,
    approval_status, is_current, is_baseline, status,
    created_at, updated_at
  ) values (
    a.project_id,
    a.user_id,
    a.type,
    coalesce(p_title, a.title),
    coalesce(p_content, a.content, ''),
    p_content_json,
    false, null, null,
    next_version, a.id, root_id,
    'draft', true, false, 'draft',
    now(), now()
  )
  returning id into new_id;

  return new_id;
end;
$$;
