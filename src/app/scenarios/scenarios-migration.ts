// src/app/scenarios/scenarios-migration.ts
// Keep migration SQL outside of "use server" modules so Next doesn't treat it as an exported value.

export const SCENARIOS_MIGRATION = `
-- Migration SQL included in code for reference
create table if not exists scenarios (
  id                uuid         primary key default gen_random_uuid(),
  organisation_id   uuid         not null references organisations(id) on delete cascade,
  name               text         not null,
  description        text,
  changes            jsonb        not null default '[]',
  created_by         uuid         references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- example index
create index if not exists idx_scenarios_org_id on scenarios(organisation_id);
`;