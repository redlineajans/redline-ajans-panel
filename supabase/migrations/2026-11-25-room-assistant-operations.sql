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
