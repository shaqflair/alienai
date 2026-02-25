-- 1) Ensure single active owner per org
create unique index if not exists organisation_single_owner_idx
on public.organisation_members (organisation_id)
where removed_at is null and lower(role) = 'owner';

-- 2) Prevent removing/demoting the last owner
create or replace function public.tg_prevent_last_org_owner()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
  v_is_owner boolean;
  v_owner_count integer;
begin
  v_org := coalesce(new.organisation_id, old.organisation_id);

  v_is_owner := (old.removed_at is null) and (lower(old.role) = 'owner');

  if not v_is_owner then
    return coalesce(new, old);
  end if;

  if (tg_op = 'DELETE')
     or (new.removed_at is not null)
     or (lower(new.role) <> 'owner') then

    select count(*) into v_owner_count
    from public.organisation_members
    where organisation_id = v_org
      and removed_at is null
      and lower(role) = 'owner';

    if v_owner_count <= 1 then
      raise exception 'Cannot remove or demote the last organisation owner';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists prevent_last_org_owner on public.organisation_members;

create trigger prevent_last_org_owner
before update or delete on public.organisation_members
for each row
execute function public.tg_prevent_last_org_owner();

-- 3) Invite expiry (recommended)
alter table public.organisation_invites
add column if not exists expires_at timestamptz
default (now() + interval '14 days');

-- 4) Transfer ownership (single-owner, atomic)
create or replace function public.transfer_org_ownership(p_org_id uuid, p_new_owner_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_actor_role text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Unauthorized';
  end if;

  select role into v_actor_role
  from public.organisation_members
  where organisation_id = p_org_id
    and user_id = v_actor
    and removed_at is null
  limit 1;

  if lower(coalesce(v_actor_role,'')) <> 'owner' then
    raise exception 'Only the owner can transfer ownership';
  end if;

  if not exists (
    select 1
    from public.organisation_members
    where organisation_id = p_org_id
      and user_id = p_new_owner_user_id
      and removed_at is null
  ) then
    raise exception 'New owner must already be a member of the organisation';
  end if;

  -- demote current owner -> admin
  update public.organisation_members
  set role = 'admin'
  where organisation_id = p_org_id
    and user_id = v_actor
    and removed_at is null;

  -- promote new owner -> owner
  update public.organisation_members
  set role = 'owner',
      removed_at = null
  where organisation_id = p_org_id
    and user_id = p_new_owner_user_id;
end;
$$;

revoke all on function public.transfer_org_ownership(uuid, uuid) from public;
grant execute on function public.transfer_org_ownership(uuid, uuid) to authenticated;

-- 5) Leave organisation (blocks owner)
create or replace function public.leave_organisation(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Unauthorized';
  end if;

  select role into v_role
  from public.organisation_members
  where organisation_id = p_org_id
    and user_id = v_uid
    and removed_at is null
  limit 1;

  if v_role is null then
    raise exception 'Not a member';
  end if;

  if lower(v_role) = 'owner' then
    raise exception 'Owner cannot leave. Transfer ownership first.';
  end if;

  update public.organisation_members
  set removed_at = now()
  where organisation_id = p_org_id
    and user_id = v_uid
    and removed_at is null;
end;
$$;

revoke all on function public.leave_organisation(uuid) from public;
grant execute on function public.leave_organisation(uuid) to authenticated;