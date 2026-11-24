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
  display_name text,
  phone text,
  role text not null check (role in ('admin','assistant','consultant','subagency_owner','host','room_assistant')),
  agency_id uuid references public.agencies(id) on delete set null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_uidx on public.profiles(lower(username));

alter table public.profiles add column if not exists display_name text;

alter table public.agencies add column if not exists owner_user_id uuid unique references auth.users(id) on delete set null;

create table if not exists public.platforms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'review' check (status in ('active','review','inactive')),
  created_at timestamptz not null default now()
);

insert into public.platforms(name,status) values
 ('Tanchat – Tanstar','active'), ('Linky AI','active'), ('Layla – Nivi','active'), ('Timo','active'), ('Sohbi','active'), ('Simi','active')
on conflict(name) do nothing;

create table if not exists public.consultant_platforms (
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform_id uuid not null references public.platforms(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, platform_id)
);

create table if not exists public.platform_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  platform_id uuid not null references public.platforms(id) on delete restrict,
  report_type text not null check (report_type in ('daily','weekly')),
  period_start date not null,
  period_end date not null,
  agency_id uuid references public.agencies(id) on delete cascade,
  original_filename text not null,
  storage_path text not null unique,
  content_type text not null,
  file_size bigint not null check (file_size > 0),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

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
  phone_numbers_count integer not null default 0 check (phone_numbers_count >= 0),
  registrations_count integer not null default 0 check (registrations_count >= 0),
  report_type text not null default 'assistant' check (report_type in ('assistant','consultant')),
  quota_completed integer not null default 0 check (quota_completed >= 0),
  background_quota integer not null default 0 check (background_quota >= 0),
  weekly_issues text,
  solution_suggestions text,
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
create index if not exists platform_reports_scope_idx on public.platform_reports(platform_id, agency_id, period_start desc);

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
alter table public.consultant_platforms enable row level security;
alter table public.platform_reports enable row level security;

-- Remove broad default grants; re-grant only operations the signed-in app needs.
revoke all on public.agencies, public.profiles, public.platforms, public.applications,
  public.creators, public.financial_entries, public.performance_entries from anon, authenticated;
revoke all on public.consultant_platforms, public.platform_reports from anon, authenticated;
grant select on public.profiles, public.platforms to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select, insert, update on public.applications to authenticated;
grant select, insert, update, delete on public.creators to authenticated;
grant select, insert, update, delete on public.financial_entries, public.performance_entries to authenticated;
grant select, insert, delete on public.consultant_platforms, public.platform_reports to authenticated;
grant select, insert, update on public.agencies to authenticated;

-- Edge Functions use the server-side secret key for login and account administration.
-- Grant only the table operations those functions need; never expose this key in the browser.
grant select, insert, update on public.profiles to service_role;
grant select, insert, delete on public.agencies to service_role;

drop policy if exists profiles_read_scope on public.profiles;
create policy profiles_read_scope on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin() or
  (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id()));
drop policy if exists profiles_update_display_name_admin on public.profiles;
create policy profiles_update_display_name_admin on public.profiles for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists platforms_read_signed_in on public.platforms;
create policy platforms_read_signed_in on public.platforms for select to authenticated using (true);

drop policy if exists consultant_platforms_read_scope on public.consultant_platforms;
create policy consultant_platforms_read_scope on public.consultant_platforms for select to authenticated
using (user_id = auth.uid() or public.is_admin());
drop policy if exists consultant_platforms_admin_write on public.consultant_platforms;
create policy consultant_platforms_admin_write on public.consultant_platforms for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists platform_reports_read_scope on public.platform_reports;
create policy platform_reports_read_scope on public.platform_reports for select to authenticated
using (
  public.is_admin()
  or (public.current_profile_role() = 'consultant' and exists (
    select 1 from public.consultant_platforms cp
    where cp.user_id = auth.uid() and cp.platform_id = platform_reports.platform_id
  ))
  or (public.current_profile_role() = 'subagency_owner' and agency_id = public.current_agency_id())
);
drop policy if exists platform_reports_insert_admin_only on public.platform_reports;
create policy platform_reports_insert_admin_only on public.platform_reports for insert to authenticated
with check (public.is_admin() and uploaded_by = auth.uid());
drop policy if exists platform_reports_delete_admin_only on public.platform_reports;
create policy platform_reports_delete_admin_only on public.platform_reports for delete to authenticated
using (public.is_admin());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('platform-reports', 'platform-reports', false, 20971520, array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv', 'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif'
]) on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists platform_report_files_read_scope on storage.objects;
create policy platform_report_files_read_scope on storage.objects for select to authenticated
using (bucket_id='platform-reports' and exists (
  select 1 from public.platform_reports r where r.storage_path = name
));
drop policy if exists platform_report_files_insert_admin_only on storage.objects;
create policy platform_report_files_insert_admin_only on storage.objects for insert to authenticated
with check (bucket_id='platform-reports' and public.is_admin());
drop policy if exists platform_report_files_delete_admin_only on storage.objects;
create policy platform_report_files_delete_admin_only on storage.objects for delete to authenticated
using (bucket_id='platform-reports' and public.is_admin());

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
drop policy if exists creators_delete_admin_only on public.creators;
create policy creators_delete_admin_only on public.creators for delete to authenticated using (public.is_admin());

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


-- Employee payment register schema and security functions
-- Admin-only employee payment register with a status-only view for linked employees.
create table if not exists public.employee_payees (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references public.platforms(id) on delete restrict,
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  employee_number text,
  phone text,
  iban text,
  monthly_amount numeric(14,2) not null default 0 check (monthly_amount >= 0),
  weekly_amount numeric(14,2) not null default 0 check (weekly_amount >= 0),
  minimum_wage boolean not null default false,
  debt_note text,
  binance_trc20 text,
  currency text not null default 'USD' check (currency in ('GBP','TRY','EUR','USD')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_payees add column if not exists employee_number text;

create table if not exists public.employee_payment_cycles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_payees(id) on delete cascade,
  period_type text not null check (period_type in ('weekly','monthly')),
  period_start date not null,
  period_end date not null,
  amount_due numeric(14,2) not null check (amount_due > 0),
  currency text not null check (currency in ('GBP','TRY','EUR','USD')),
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique(employee_id, period_type, period_start, period_end)
);

create table if not exists public.employee_payments (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.employee_payment_cycles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  note text,
  entered_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists employee_payees_platform_idx on public.employee_payees(platform_id, status, full_name);
create index if not exists employee_payment_cycles_employee_idx on public.employee_payment_cycles(employee_id, period_end desc);
create index if not exists employee_payments_cycle_idx on public.employee_payments(cycle_id, paid_on);

alter table public.employee_payees enable row level security;
alter table public.employee_payment_cycles enable row level security;
alter table public.employee_payments enable row level security;
revoke all on public.employee_payees, public.employee_payment_cycles, public.employee_payments from anon, authenticated;
grant select, insert, update, delete on public.employee_payees, public.employee_payment_cycles, public.employee_payments to authenticated;

drop policy if exists employee_payees_admin_only on public.employee_payees;
create policy employee_payees_admin_only on public.employee_payees for all to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists employee_payment_cycles_admin_only on public.employee_payment_cycles;
create policy employee_payment_cycles_admin_only on public.employee_payment_cycles for all to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists employee_payments_admin_only on public.employee_payments;
create policy employee_payments_admin_only on public.employee_payments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create or replace function public.record_employee_payment(
  p_employee_id uuid,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_amount_due numeric,
  p_amount numeric,
  p_currency text,
  p_paid_on date,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee public.employee_payees%rowtype;
  v_cycle_id uuid;
  v_finance_id uuid;
  v_payment_id uuid;
  v_paid_total numeric(14,2);
begin
  if not public.is_admin() then raise exception 'Yalnızca yönetici ödeme girişi yapabilir.' using errcode='42501'; end if;
  if p_period_type not in ('weekly','monthly') or p_period_end < p_period_start then
    raise exception 'Ödeme dönemi bilgisi geçersiz.' using errcode='22023';
  end if;
  if p_amount <= 0 or p_amount_due <= 0 or p_currency not in ('GBP','TRY','EUR','USD') then
    raise exception 'Ödeme tutarı veya para birimi geçersiz.' using errcode='22023';
  end if;
  select * into v_employee from public.employee_payees where id=p_employee_id;
  if not found then raise exception 'Çalışan kaydı bulunamadı.' using errcode='P0002'; end if;

  insert into public.employee_payment_cycles(employee_id,period_type,period_start,period_end,amount_due,currency)
  values(p_employee_id,p_period_type,p_period_start,p_period_end,p_amount_due,p_currency)
  on conflict(employee_id,period_type,period_start,period_end)
  do update set amount_due=excluded.amount_due,currency=excluded.currency
  returning id into v_cycle_id;

  insert into public.financial_entries(entry_type,category,description,amount,currency,occurred_on,platform_id,entered_by)
  values('expense','Çalışan ödemesi',v_employee.full_name || ' · ' ||
    case when p_period_type='weekly' then 'Haftalık' else 'Aylık' end || ' ödeme (' ||
    p_period_start::text || ' – ' || p_period_end::text || ')',
    p_amount,p_currency,p_paid_on,v_employee.platform_id,auth.uid())
  returning id into v_finance_id;

  insert into public.employee_payments(cycle_id,amount,paid_on,financial_entry_id,note,entered_by)
  values(v_cycle_id,p_amount,p_paid_on,v_finance_id,nullif(btrim(p_note),''),auth.uid())
  returning id into v_payment_id;

  select coalesce(sum(amount),0) into v_paid_total from public.employee_payments where cycle_id=v_cycle_id;
  return jsonb_build_object('cycle_id',v_cycle_id,'payment_id',v_payment_id,
    'paid_total',v_paid_total,'amount_due',p_amount_due,'remaining',greatest(0,p_amount_due-v_paid_total),
    'is_paid',v_paid_total>=p_amount_due);
end;
$$;

create or replace function public.delete_employee_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_financial_entry_id uuid;
begin
  if not public.is_admin() then raise exception 'Yalnızca yönetici ödeme kaydını silebilir.' using errcode='42501'; end if;
  select financial_entry_id into v_financial_entry_id from public.employee_payments where id=p_payment_id;
  if not found then return; end if;
  delete from public.financial_entries where id=v_financial_entry_id;
  delete from public.employee_payments where id=p_payment_id;
end;
$$;

create or replace function public.my_employee_payment_status()
returns table(period_type text, period_start date, period_end date, is_paid boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.period_type,c.period_start,c.period_end,
    coalesce(sum(p.amount),0) >= c.amount_due as is_paid
  from public.employee_payees e
  join public.employee_payment_cycles c on c.employee_id=e.id
  left join public.employee_payments p on p.cycle_id=c.id
  where e.profile_id=auth.uid()
  group by c.id,c.period_type,c.period_start,c.period_end,c.amount_due
  order by c.period_end desc
  limit 100;
$$;

revoke all on function public.record_employee_payment(uuid,text,date,date,numeric,numeric,text,date,text) from public, anon;
revoke all on function public.delete_employee_payment(uuid) from public, anon;
revoke all on function public.my_employee_payment_status() from public, anon;
grant execute on function public.record_employee_payment(uuid,text,date,date,numeric,numeric,text,date,text) to authenticated;
grant execute on function public.delete_employee_payment(uuid) to authenticated;
grant execute on function public.my_employee_payment_status() to authenticated;

-- Record assistants serve every platform and are grouped separately.
alter table public.employee_payees
  add column if not exists employee_type text not null default 'platform_worker';
alter table public.employee_payees
  drop constraint if exists employee_payees_employee_type_check;
alter table public.employee_payees
  add constraint employee_payees_employee_type_check
  check (employee_type in ('assistant', 'platform_worker'));
alter table public.employee_payees alter column platform_id drop not null;
update public.employee_payees e
set employee_type = 'assistant', platform_id = null, updated_at = now()
from public.profiles p
where e.profile_id = p.id and p.role = 'assistant';
create index if not exists employee_payees_type_idx
  on public.employee_payees(employee_type, status, full_name);

-- Weekly referral register and role-specific visibility.
create table if not exists public.referral_entries (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references public.platforms(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  referred_creator_id text not null,
  referred_creator_phone text not null,
  referrer_name text not null,
  referrer_phone text not null,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (length(trim(referred_creator_id)) > 0),
  check (length(trim(referred_creator_phone)) > 0),
  check (length(trim(referrer_name)) > 0),
  check (length(trim(referrer_phone)) > 0)
);
create index if not exists referral_entries_period_platform_idx on public.referral_entries(period_start desc, platform_id);
create index if not exists referral_entries_submitter_idx on public.referral_entries(submitted_by, period_start desc);
alter table public.referral_entries enable row level security;
revoke all on public.referral_entries from anon, authenticated;
grant select, insert, update, delete on public.referral_entries to authenticated;
drop policy if exists referral_entries_read_scope on public.referral_entries;
create policy referral_entries_read_scope on public.referral_entries for select to authenticated
using (public.is_admin() or public.current_profile_role() = 'assistant' or
  (public.current_profile_role() = 'consultant' and exists (
    select 1 from public.consultant_platforms cp
    where cp.user_id = auth.uid() and cp.platform_id = referral_entries.platform_id
  )));
drop policy if exists referral_entries_insert_scope on public.referral_entries;
create policy referral_entries_insert_scope on public.referral_entries for insert to authenticated
with check (public.is_admin() or (public.current_profile_role() = 'assistant' and submitted_by = auth.uid()));
drop policy if exists referral_entries_update_scope on public.referral_entries;
create policy referral_entries_update_scope on public.referral_entries for update to authenticated
using (public.is_admin() or (public.current_profile_role() = 'assistant' and submitted_by = auth.uid()))
with check (public.is_admin() or (public.current_profile_role() = 'assistant' and submitted_by = auth.uid()));
drop policy if exists referral_entries_delete_admin_only on public.referral_entries;
create policy referral_entries_delete_admin_only on public.referral_entries for delete to authenticated using (public.is_admin());

-- Add a dedicated host role and a private PK schedule/poster register.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','assistant','consultant','subagency_owner','host','room_assistant'));

create or replace function public.pk_can_manage_platform(p_platform_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_admin() or (
    public.current_profile_role() = 'consultant'
    and exists(select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=p_platform_id)
  );
$$;

create or replace function public.pk_hosts_for_platform(p_platform_id uuid)
returns table(profile_id uuid, display_label text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id, coalesce(nullif(btrim(p.display_name),''),p.full_name)
  from public.employee_payees ep
  join public.profiles p on p.id=ep.profile_id
  where public.pk_can_manage_platform(p_platform_id)
    and ep.platform_id=p_platform_id and ep.status='active'
    and p.role='host' and p.active
  order by coalesce(nullif(btrim(p.display_name),''),p.full_name);
$$;

create or replace function public.pk_host_ids_valid_for_platform(p_platform_id uuid, p_host_ids uuid[])
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    cardinality(p_host_ids)>0 and cardinality(p_host_ids) = (
      select count(distinct u.host_id)::integer
      from unnest(p_host_ids) as u(host_id)
      join public.employee_payees ep on ep.profile_id=u.host_id and ep.platform_id=p_platform_id and ep.status='active'
      join public.profiles p on p.id=ep.profile_id and p.role='host' and p.active
    ), false
  );
$$;

create table if not exists public.pk_events (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references public.platforms(id) on delete restrict,
  event_name text not null,
  event_date date not null,
  event_time time not null,
  tracking_code text,
  approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected','not_required')),
  poster_path text,
  host_profile_ids uuid[] not null,
  host_names text[] not null,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(event_name))>0),
  check (cardinality(host_profile_ids)>0),
  check (cardinality(host_profile_ids)=cardinality(host_names))
);

create index if not exists pk_events_platform_date_idx on public.pk_events(platform_id,event_date desc,event_time);
create index if not exists pk_events_hosts_idx on public.pk_events using gin(host_profile_ids);
alter table public.pk_events enable row level security;
revoke all on public.pk_events from anon, authenticated;
grant select, insert, update, delete on public.pk_events to authenticated;

create or replace function public.pk_can_view_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists(select 1 from public.pk_events e where e.id=p_event_id and (
    public.is_admin()
    or (public.current_profile_role()='host' and auth.uid()=any(e.host_profile_ids))
    or public.pk_can_manage_platform(e.platform_id)
  ));
$$;

create or replace function public.pk_can_manage_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists(select 1 from public.pk_events e where e.id=p_event_id and public.pk_can_manage_platform(e.platform_id));
$$;

drop policy if exists pk_events_read_scope on public.pk_events;
create policy pk_events_read_scope on public.pk_events for select to authenticated
using (public.pk_can_view_event(id));
drop policy if exists pk_events_insert_scope on public.pk_events;
create policy pk_events_insert_scope on public.pk_events for insert to authenticated
with check (public.pk_can_manage_platform(platform_id) and public.pk_host_ids_valid_for_platform(platform_id,host_profile_ids) and created_by=auth.uid());
drop policy if exists pk_events_update_scope on public.pk_events;
create policy pk_events_update_scope on public.pk_events for update to authenticated
using (public.pk_can_manage_platform(platform_id))
with check (public.pk_can_manage_platform(platform_id) and public.pk_host_ids_valid_for_platform(platform_id,host_profile_ids));
drop policy if exists pk_events_delete_admin_only on public.pk_events;
create policy pk_events_delete_admin_only on public.pk_events for delete to authenticated using (public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pk-posters','pk-posters',false,20971520,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists pk_posters_read_scope on storage.objects;
create policy pk_posters_read_scope on storage.objects for select to authenticated
using (bucket_id='pk-posters' and public.pk_can_view_event(((storage.foldername(name))[1])::uuid));
drop policy if exists pk_posters_insert_manager on storage.objects;
create policy pk_posters_insert_manager on storage.objects for insert to authenticated
with check (bucket_id='pk-posters' and public.pk_can_manage_event(((storage.foldername(name))[1])::uuid));
drop policy if exists pk_posters_update_manager on storage.objects;
create policy pk_posters_update_manager on storage.objects for update to authenticated
using (bucket_id='pk-posters' and public.pk_can_manage_event(((storage.foldername(name))[1])::uuid))
with check (bucket_id='pk-posters' and public.pk_can_manage_event(((storage.foldername(name))[1])::uuid));
drop policy if exists pk_posters_delete_manager on storage.objects;
create policy pk_posters_delete_manager on storage.objects for delete to authenticated
using (bucket_id='pk-posters' and public.pk_can_manage_event(((storage.foldername(name))[1])::uuid));

revoke all on function public.pk_can_manage_platform(uuid) from public, anon;
revoke all on function public.pk_hosts_for_platform(uuid) from public, anon;
revoke all on function public.pk_host_ids_valid_for_platform(uuid,uuid[]) from public, anon;
revoke all on function public.pk_can_view_event(uuid) from public, anon;
revoke all on function public.pk_can_manage_event(uuid) from public, anon;
grant execute on function public.pk_can_manage_platform(uuid) to authenticated;
grant execute on function public.pk_hosts_for_platform(uuid) to authenticated;
grant execute on function public.pk_host_ids_valid_for_platform(uuid,uuid[]) to authenticated;
grant execute on function public.pk_can_view_event(uuid) to authenticated;
grant execute on function public.pk_can_manage_event(uuid) to authenticated;



-- Let assigned hosts report whether their PK presentation took place.
alter table public.pk_events
  add column if not exists presentation_status text not null default 'not_started';

alter table public.pk_events
  drop constraint if exists pk_events_presentation_status_check;
alter table public.pk_events
  add constraint pk_events_presentation_status_check
  check (presentation_status in ('not_started','performed','not_performed'));

create or replace function public.pk_mark_presentation(p_event_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if p_status not in ('performed','not_performed') then
    raise exception 'Geçersiz sunum durumu.';
  end if;
  if not exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role='host' and p.active=true
  ) then
    raise exception 'Bu işlem yalnızca aktif sunucu hesabıyla yapılabilir.';
  end if;

  update public.pk_events e
    set presentation_status=p_status, updated_at=now()
    where e.id=p_event_id and auth.uid()=any(e.host_profile_ids);

  get diagnostics changed = row_count;
  if changed=0 then
    raise exception 'Bu PK kaydı hesabına atanmadığı için güncellenemedi.';
  end if;
  return true;
end;
$$;

revoke all on function public.pk_mark_presentation(uuid,text) from public, anon;
grant execute on function public.pk_mark_presentation(uuid,text) to authenticated;


-- Create PK events through a tightly scoped security-definer function.
-- This avoids PostgREST INSERT/RETURNING policy edge cases while retaining
-- the same admin/assigned-consultant and assigned-host checks.
create or replace function public.pk_create_event(
  p_platform_id uuid,
  p_event_name text,
  p_event_date date,
  p_event_time time,
  p_tracking_code text,
  p_approval_status text,
  p_host_profile_ids uuid[],
  p_host_names text[],
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_id uuid;
begin
  if auth.uid() is null or not public.pk_can_manage_platform(p_platform_id) then
    raise exception 'Bu uygulama için PK kaydı ekleme yetkin yok.';
  end if;
  if not public.pk_host_ids_valid_for_platform(p_platform_id,p_host_profile_ids) then
    raise exception 'Seçilen sunuculardan biri bu uygulamayla aktif olarak eşleştirilmemiş. Çalışan Ödeme Tablosu bağlantısını kontrol et.';
  end if;
  if p_event_name is null or length(btrim(p_event_name))=0 then
    raise exception 'PK adı boş bırakılamaz.';
  end if;
  if p_approval_status not in ('pending','approved','rejected','not_required') then
    raise exception 'Afiş onay durumu geçersiz.';
  end if;
  if coalesce(cardinality(p_host_names),0)<>cardinality(p_host_profile_ids) then
    raise exception 'Sunucu bilgileri eşleşmiyor. Sunucuları yeniden seç.';
  end if;

  insert into public.pk_events(
    platform_id,event_name,event_date,event_time,tracking_code,approval_status,
    host_profile_ids,host_names,notes,created_by
  ) values (
    p_platform_id,btrim(p_event_name),p_event_date,p_event_time,nullif(btrim(coalesce(p_tracking_code,'')),''),
    p_approval_status,p_host_profile_ids,p_host_names,nullif(btrim(coalesce(p_notes,'')),''),auth.uid()
  ) returning id into created_id;

  return created_id;
end;
$$;

revoke all on function public.pk_create_event(uuid,text,date,time,text,text,uuid[],text[],text) from public, anon;
grant execute on function public.pk_create_event(uuid,text,date,time,text,text,uuid[],text[],text) to authenticated;


-- Track whether each referred creator received a referral payment.
alter table public.referral_entries
  add column if not exists referral_payment_status text not null default 'unknown';
alter table public.referral_entries
  add column if not exists referral_payment_amount numeric(12,2);
alter table public.referral_entries
  add column if not exists referral_payment_currency text not null default 'TRY';

alter table public.referral_entries
  drop constraint if exists referral_entries_payment_status_check;
alter table public.referral_entries
  add constraint referral_entries_payment_status_check
  check (referral_payment_status in ('unknown','paid','not_paid'));
alter table public.referral_entries
  drop constraint if exists referral_entries_payment_amount_check;
alter table public.referral_entries
  add constraint referral_entries_payment_amount_check
  check (
    (referral_payment_status='paid' and referral_payment_amount is not null and referral_payment_amount>0)
    or (referral_payment_status<>'paid' and referral_payment_amount is null)
  );
alter table public.referral_entries
  drop constraint if exists referral_entries_payment_currency_check;
alter table public.referral_entries
  add constraint referral_entries_payment_currency_check
  check (referral_payment_currency in ('TRY','GBP','USD','EUR'));

create or replace function public.set_referral_payment(
  p_referral_id uuid,
  p_status text,
  p_amount numeric,
  p_currency text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  referral_row public.referral_entries%rowtype;
  allowed boolean := false;
begin
  select * into referral_row from public.referral_entries where id=p_referral_id;
  if not found then raise exception 'Referans kaydı bulunamadı.'; end if;

  if public.is_admin() then
    allowed := true;
  elsif public.current_profile_role()='assistant' and referral_row.submitted_by=auth.uid() then
    allowed := true;
  elsif public.current_profile_role()='consultant' and exists(
    select 1 from public.consultant_platforms cp
    where cp.user_id=auth.uid() and cp.platform_id=referral_row.platform_id
  ) then
    allowed := true;
  end if;
  if not allowed then raise exception 'Bu referans kaydının ödeme bilgisini değiştirme yetkin yok.'; end if;

  if p_status not in ('unknown','paid','not_paid') then
    raise exception 'Ödeme durumu geçersiz.';
  end if;
  if p_currency not in ('TRY','GBP','USD','EUR') then
    raise exception 'Para birimi geçersiz.';
  end if;
  if p_status='paid' and (p_amount is null or p_amount<=0) then
    raise exception 'Ödeme var seçildiğinde tutarı gir.';
  end if;
  if p_status<>'paid' then p_amount := null; end if;

  update public.referral_entries
    set referral_payment_status=p_status,
        referral_payment_amount=p_amount,
        referral_payment_currency=p_currency,
        updated_at=now()
    where id=p_referral_id;
  return true;
end;
$$;

revoke all on function public.set_referral_payment(uuid,text,numeric,text) from public, anon;
grant execute on function public.set_referral_payment(uuid,text,numeric,text) to authenticated;


-- Current setup additions: Oda Asistanı role and daily operations.
-- Add a dedicated room-assistant role and secure daily follow-up / escalation workflow.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','assistant','consultant','subagency_owner','host','room_assistant'));

create table if not exists public.room_assistant_followups (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references public.platforms(id) on delete restrict,
  source_report_id uuid references public.platform_reports(id) on delete set null,
  follow_up_date date not null default current_date,
  publisher_id text not null,
  publisher_name text not null,
  broadcast_status text not null default 'unknown'
    check (broadcast_status in ('streamed','not_streamed','unknown')),
  quota_status text not null default 'unknown'
    check (quota_status in ('on_track','short','unknown')),
  contact_status text not null default 'pending'
    check (contact_status in ('contacted','unreachable','pending')),
  activity_invitation text not null default 'none'
    check (activity_invitation in ('none','pk','event','room_activity')),
  motivation_status text not null default 'normal'
    check (motivation_status in ('normal','low')),
  action_notes text,
  issue_note text,
  escalation_status text not null default 'none'
    check (escalation_status in ('none','pending','resolved')),
  lead_resolution text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(publisher_id))>0),
  check (length(btrim(publisher_name))>0),
  check (escalation_status='none' or length(btrim(coalesce(issue_note,'')))>0)
);

create index if not exists room_assistant_followups_platform_date_idx
  on public.room_assistant_followups(platform_id,follow_up_date desc);
create index if not exists room_assistant_followups_author_date_idx
  on public.room_assistant_followups(created_by,follow_up_date desc);
alter table public.room_assistant_followups enable row level security;
alter table public.room_assistant_followups add column if not exists source_report_id uuid references public.platform_reports(id) on delete set null;
alter table public.room_assistant_followups add column if not exists created_by_name text not null default '';
revoke all on public.room_assistant_followups from anon,authenticated;
grant select,insert,update,delete on public.room_assistant_followups to authenticated;

drop policy if exists room_followups_read_scope on public.room_assistant_followups;
create policy room_followups_read_scope on public.room_assistant_followups for select to authenticated
using (
  public.is_admin()
  or (public.current_profile_role()='consultant' and exists(
    select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=room_assistant_followups.platform_id
  ))
  or (public.current_profile_role()='room_assistant' and created_by=auth.uid() and exists(
    select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=room_assistant_followups.platform_id
  ))
);

drop policy if exists room_followups_insert_scope on public.room_assistant_followups;
create policy room_followups_insert_scope on public.room_assistant_followups for insert to authenticated
with check (
  public.is_admin()
  or (public.current_profile_role()='room_assistant' and created_by=auth.uid() and exists(
    select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=room_assistant_followups.platform_id
  ))
);

drop policy if exists room_followups_update_scope on public.room_assistant_followups;
create policy room_followups_update_scope on public.room_assistant_followups for update to authenticated
using (
  public.is_admin()
  or (public.current_profile_role()='room_assistant' and created_by=auth.uid() and exists(
    select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=room_assistant_followups.platform_id
  ))
)
with check (
  public.is_admin()
  or (public.current_profile_role()='room_assistant' and created_by=auth.uid() and exists(
    select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=room_assistant_followups.platform_id
  ))
);

drop policy if exists room_followups_delete_admin_only on public.room_assistant_followups;
create policy room_followups_delete_admin_only on public.room_assistant_followups for delete to authenticated
using (public.is_admin());

create or replace function public.prepare_room_assistant_followup()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  author public.profiles%rowtype;
begin
  select * into author from public.profiles where id=new.created_by;
  if not found then raise exception 'Takip kaydının sahibi bulunamadı.'; end if;
  new.created_by_name:=coalesce(nullif(btrim(author.display_name),''),author.full_name);
  if new.source_report_id is not null and not exists (
    select 1 from public.platform_reports r where r.id=new.source_report_id and r.platform_id=new.platform_id
  ) then raise exception 'Seçilen rapor bu uygulamaya ait değil.'; end if;
  new.updated_at:=now();
  return new;
end;
$$;
drop trigger if exists room_followup_prepare on public.room_assistant_followups;
create trigger room_followup_prepare before insert or update on public.room_assistant_followups
for each row execute function public.prepare_room_assistant_followup();

create or replace function public.guard_room_followup_lead_fields()
returns trigger language plpgsql set search_path=public,pg_temp
as $$
begin
  if public.current_profile_role()='room_assistant' and new.lead_resolution is distinct from old.lead_resolution then
    raise exception 'Baş Asistanın değerlendirme alanlarını yalnızca yönetici veya danışman güncelleyebilir.';
  end if;
  if public.current_profile_role()='room_assistant' then
    if new.issue_note is distinct from old.issue_note then
      new.escalation_status:=case when length(btrim(coalesce(new.issue_note,'')))>0 then 'pending' else 'none' end;
      new.lead_resolution:=null;
    else
      new.escalation_status:=old.escalation_status;
      new.lead_resolution:=old.lead_resolution;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists room_followup_lead_fields_guard on public.room_assistant_followups;
create trigger room_followup_lead_fields_guard before update on public.room_assistant_followups
for each row execute function public.guard_room_followup_lead_fields();

create or replace function public.resolve_room_assistant_followup(p_followup_id uuid,p_resolution text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  followup public.room_assistant_followups%rowtype;
  changed integer;
begin
  select * into followup from public.room_assistant_followups where id=p_followup_id;
  if not found then raise exception 'Takip kaydı bulunamadı.'; end if;
  if not (
    public.is_admin()
    or (public.current_profile_role()='consultant' and exists(
      select 1 from public.consultant_platforms cp where cp.user_id=auth.uid() and cp.platform_id=followup.platform_id
    ))
  ) then raise exception 'Bu konuya müdahale yetkin yok.'; end if;
  if length(btrim(coalesce(p_resolution,'')))=0 then raise exception 'Çözüm veya yönlendirme notunu yaz.'; end if;

  update public.room_assistant_followups
    set escalation_status='resolved',lead_resolution=btrim(p_resolution),updated_at=now()
    where id=p_followup_id and escalation_status='pending';
  get diagnostics changed=row_count;
  if changed=0 then raise exception 'Bu konu artık beklemede değil.'; end if;
  return true;
end;
$$;
revoke all on function public.resolve_room_assistant_followup(uuid,text) from public,anon;
grant execute on function public.resolve_room_assistant_followup(uuid,text) to authenticated;

drop policy if exists platform_reports_read_scope on public.platform_reports;
create policy platform_reports_read_scope on public.platform_reports for select to authenticated
using (
  public.is_admin()
  or (public.current_profile_role() in ('consultant','room_assistant') and exists (
    select 1 from public.consultant_platforms cp
    where cp.user_id=auth.uid() and cp.platform_id=platform_reports.platform_id
  ))
  or (public.current_profile_role()='subagency_owner' and agency_id=public.current_agency_id())
);
