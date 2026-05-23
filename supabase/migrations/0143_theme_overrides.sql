-- 0143 — per-company CSS token overrides for the platform UI.
-- super_admin can write; company members (and Opollo staff) can read.

create table if not exists platform_company_theme_overrides (
  company_id  uuid primary key references platform_companies(id) on delete cascade,
  overrides   jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

alter table platform_company_theme_overrides enable row level security;

create policy "super_admin can manage theme overrides"
  on platform_company_theme_overrides
  for all
  using (
    exists (
      select 1 from opollo_users
      where id = auth.uid() and role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from opollo_users
      where id = auth.uid() and role = 'super_admin'
    )
  );

create policy "company member can read theme overrides"
  on platform_company_theme_overrides
  for select
  using (
    exists (
      select 1 from platform_company_users
      where company_id = platform_company_theme_overrides.company_id
        and user_id = auth.uid()
    )
    or
    exists (
      select 1 from platform_users
      where id = auth.uid() and is_opollo_staff = true
    )
  );
