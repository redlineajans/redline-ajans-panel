-- Red Line Ajans private operations panel (Supabase/Postgres)
-- Apply this file in Supabase SQL Editor before deploying the frontend.
create extension if not exists pgcrypto;

create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text not null,
  phone text,
  email text,
  owner_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  full_name text not null,
  phone text,
  role text not null check (role in ('admin','assistant','consultant','subagency_owner')),
  agency_id uuid references public.agencies(id) on delete set null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_uidx on public.profiles(lower(username));

alter table public.agencies add column if not exists owner_user_id uuid unique references auth.users(id) on delete set null;

create table if not exists public.platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'review' check (status in ('active','review','inactive')),
  created_at timestamptz not null default now()
);

insert into public.platforms(name,status) values
 ('Tanchat – Tanstar','active'), ('Linky AI','active'), ('Layla','active'), ('Timo','active'), ('Sohbi','review')
on conflict(name) do nothing;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  platform_id uuid references public.platforms(id) on delete set null,
  status text not null default 'new' check (status in ('new','contacted','reviewing','accepted','declined')),
  assigned_to uuid references public.profiles(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  notes text,
  follow_up_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creators (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phone text,
  email text,
  platform_id uuid references public.platforms(id) on delete set null,
  status text not null default 'active' check (status in ('active','paused','left')),
  consultant_id uuid references public.profiles(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  started_on date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income','expense')),
  category text not null,
  description text,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'GBP',
  occurred_on date not null default current_date,
  platform_id uuid references public.platforms(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.performance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  agency_id uuid references public.agencies(id) on delete set null,
  platform_id uuid references public.platforms(id) on delete set null,
  period_start date not null,
  period_end date not null,
  applications_count integer not null default 0 check (applications_count >= 0),
  registrations_count integer not null default 0 check (registrations_count >= 0),
  active_creators_count integer not null default 0 check (active_creators_count >= 0),
  revenue_contribution numeric(14,2) not null default 0 check (revenue_contribution >= 0),
  currency text not null default 'GBP',
  note text,
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists applications_assigned_idx on public.applications(assigned_to);
create index if not exists applications_agency_idx on public.applications(agency_id);
create index if not exists creators_consultant_idx on public.creators(consultant_id);
create index if not exists creators_agency_idx on public.creators(agency_id);
create index if not exists financial_agency_date_idx on public.financial_entries(agency_id, occurred_on);
create index if not exists performance_user_period_idx on public.performance_entries(user_id, period_start);

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public, pg_temp
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.current_agency_id()
returns uuid language sql stable security definer set search_path = public, pg_temp
as $$ select agency_id from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.current_profile_role() = 'admin', false) $$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_agency_id() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_agency_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.platforms enable row level security;
alter table public.applications enable row level security;
alter table public.creators enable row level security;
alter table public.financial_entries enable row level security;
alter table public.performance_entries enable row level security;

-- Remove broad default grants; re-grant only operations the signed-in app needs.
revoke all on public.agencies, public.profiles, public.platforms, public.applications,
  public.creators, public.financial_entries, public.performance_entries from anon, authenticated;
grant select on public.profiles, public.platforms to authenticated;
grant select, insert, update on public.applications, public.creators to authenticated;
grant select, insert, update, delete on public.financial_entries, public.performance_entries to authenticated;
grant select, insert, update on public.agencies to authenticated;

drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin() or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id()));

drop policy if exists platforms_read_signed_in on public.platforms;
create policy platforms_read_signed_in on public.platforms for select to authenticated using (true);

drop policy if exists agencies_read_scope on public.agencies;
create policy agencies_read_scope on public.agencies for select to authenticated
using (public.is_admin() or (id = public.current_agency_id() and public.current_profile_role() = 'subagency_owner'));
drop policy if exists agencies_admin_write on public.agencies;
create policy agencies_admin_write on public.agencies for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists applications_read_scope on public.applications;
create policy applications_read_scope on public.applications for select to authenticated
using (public.current_profile_role() is not null and (public.is_admin() or
  (assigned_to = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists applications_insert_scope on public.applications;
create policy applications_insert_scope on public.applications for insert to authenticated
with check (public.current_profile_role() is not null and (public.is_admin() or
  (assigned_to = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists applications_update_scope on public.applications;
create policy applications_update_scope on public.applications for update to authenticated
using (public.current_profile_role() is not null and (public.is_admin() or
  (assigned_to = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())))
with check (public.current_profile_role() is not null and (public.is_admin() or
  (assigned_to = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));

drop policy if exists creators_read_scope on public.creators;
create policy creators_read_scope on public.creators for select to authenticated
using (public.current_profile_role() is not null and (public.is_admin() or
  (consultant_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists creators_insert_scope on public.creators;
create policy creators_insert_scope on public.creators for insert to authenticated
with check (public.current_profile_role() is not null and (public.is_admin() or
  (consultant_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists creators_update_scope on public.creators;
create policy creators_update_scope on public.creators for update to authenticated
using (public.current_profile_role() is not null and (public.is_admin() or
  (consultant_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())))
with check (public.current_profile_role() is not null and (public.is_admin() or
  (consultant_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));

drop policy if exists finance_read_scope on public.financial_entries;
create policy finance_read_scope on public.financial_entries for select to authenticated
using (public.is_admin() or (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id()));
drop policy if exists finance_write_admin_or_agency on public.financial_entries;
create policy finance_write_admin_or_agency on public.financial_entries for insert to authenticated
with check (public.is_admin() or (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id()));
drop policy if exists finance_update_admin_or_agency on public.financial_entries;
create policy finance_update_admin_or_agency on public.financial_entries for update to authenticated
using (public.is_admin() or (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id()))
with check (public.is_admin() or (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id()));
drop policy if exists finance_delete_admin_only on public.financial_entries;
create policy finance_delete_admin_only on public.financial_entries for delete to authenticated using (public.is_admin());

drop policy if exists performance_read_scope on public.performance_entries;
create policy performance_read_scope on public.performance_entries for select to authenticated
using (public.current_profile_role() is not null and (public.is_admin() or
  (user_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists performance_insert_scope on public.performance_entries;
create policy performance_insert_scope on public.performance_entries for insert to authenticated
with check (public.current_profile_role() is not null and (public.is_admin() or
  (user_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists performance_update_scope on public.performance_entries;
create policy performance_update_scope on public.performance_entries for update to authenticated
using (public.current_profile_role() is not null and (public.is_admin() or
  (user_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())))
with check (public.current_profile_role() is not null and (public.is_admin() or
  (user_id = auth.uid() and agency_id is not distinct from public.current_agency_id()) or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())));
drop policy if exists performance_delete_admin_only on public.performance_entries;
create policy performance_delete_admin_only on public.performance_entries for delete to authenticated using (public.is_admin());

-- The first admin account must be created privately in Supabase Auth. Then promote that ID in SQL Editor:
-- update public.profiles set role='admin', must_change_password=false where id='AUTH_USER_UUID_HERE';
