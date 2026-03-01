-- FILE: supabase/migrations/20260301_timeline_extensions.sql

create table if not exists project_milestones (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references projects(id) on delete cascade,
  label       text        not null,
  date        date        not null,
  type        text        not null default 'other'
                          check (type in ('kickoff','delivery','review','other')),
  created_at  timestamptz not null default now()
);

create index if not exists milestones_project_idx on project_milestones(project_id);
create index if not exists milestones_date_idx    on project_milestones(date);

alter table project_milestones enable row level security;

do $$ 
begin
  if not exists (select 1 from pg_policies where policyname = 'org members can manage milestones') then
    create policy "org members can manage milestones"
      on project_milestones for all
      using (
        project_id in (
          select id from projects where organisation_id in (
            select organisation_id from organisation_members
            where user_id = auth.uid() and removed_at is null
          )
        )
      );
  end if;
end $$;

create table if not exists project_dependencies (
  project_id            uuid not null references projects(id) on delete cascade,
  depends_on_project_id uuid not null references projects(id) on delete cascade,
  primary key (project_id, depends_on_project_id)
);

alter table project_dependencies enable row level security;

do $$ 
begin
  if not exists (select 1 from pg_policies where policyname = 'org members can manage dependencies') then
    create policy "org members can manage dependencies"
      on project_dependencies for all
      using (
        project_id in (
          select id from projects where organisation_id in (
            select organisation_id from organisation_members
            where user_id = auth.uid() and removed_at is null
          )
        )
      );
  end if;
end $$;
