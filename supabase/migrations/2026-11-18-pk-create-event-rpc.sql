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
