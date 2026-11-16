-- Private Excel, PDF and image report archive with app/agency scoped visibility.
create table if not exists public.consultant_platforms (
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform_id uuid not null references public.platforms(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, platform_id)
);

alter table public.consultant_platforms enable row level security;
revoke all on public.consultant_platforms from anon, authenticated;
grant select, insert, delete on public.consultant_platforms to authenticated;
drop policy if exists consultant_platforms_read_scope on public.consultant_platforms;
create policy consultant_platforms_read_scope on public.consultant_platforms for select to authenticated
using (user_id = auth.uid() or public.is_admin());
drop policy if exists consultant_platforms_admin_write on public.consultant_platforms;
create policy consultant_platforms_admin_write on public.consultant_platforms for all to authenticated
using (public.is_admin()) with check (public.is_admin());

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

create index if not exists platform_reports_scope_idx on public.platform_reports(platform_id, agency_id, period_start desc);
alter table public.platform_reports enable row level security;
revoke all on public.platform_reports from anon, authenticated;
grant select, insert, delete on public.platform_reports to authenticated;
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
values (
  'platform-reports', 'platform-reports', false, 20971520,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel', 'text/csv', 'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists platform_report_files_read_scope on storage.objects;
create policy platform_report_files_read_scope on storage.objects for select to authenticated
using (
  bucket_id = 'platform-reports'
  and exists (select 1 from public.platform_reports r where r.storage_path = name)
);
drop policy if exists platform_report_files_insert_admin_only on storage.objects;
create policy platform_report_files_insert_admin_only on storage.objects for insert to authenticated
with check (bucket_id = 'platform-reports' and public.is_admin());
drop policy if exists platform_report_files_delete_admin_only on storage.objects;
create policy platform_report_files_delete_admin_only on storage.objects for delete to authenticated
using (bucket_id = 'platform-reports' and public.is_admin());
