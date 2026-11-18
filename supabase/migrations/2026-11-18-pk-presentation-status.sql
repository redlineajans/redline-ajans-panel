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
