-- Add a dedicated host role and a private PK schedule/poster register.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','assistant','consultant','subagency_owner','host'));

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
