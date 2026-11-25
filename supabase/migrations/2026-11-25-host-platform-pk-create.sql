-- Let each host view their assigned applications and create PK records for themself.
create or replace function public.my_host_platforms()
returns table(platform_id uuid, platform_name text, platform_status text)
language sql stable security definer set search_path=public,pg_temp
as $$
  select distinct p.id,p.name,p.status
  from public.employee_payees ep
  join public.platforms p on p.id=ep.platform_id
  join public.profiles u on u.id=ep.profile_id
  where ep.profile_id=auth.uid() and ep.status='active'
    and p.status='active' and u.role='host' and u.active=true
  order by p.name;
$$;

create or replace function public.host_assigned_to_platform(p_platform_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.employee_payees ep
    join public.profiles u on u.id=ep.profile_id
    where ep.profile_id=auth.uid() and ep.platform_id=p_platform_id
      and ep.status='active' and u.role='host' and u.active=true
  );
$$;

create or replace function public.pk_host_can_add_poster(p_event_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select exists(
    select 1 from public.pk_events e
    where e.id=p_event_id and e.created_by=auth.uid()
      and public.current_profile_role()='host'
      and auth.uid()=any(e.host_profile_ids)
      and public.host_assigned_to_platform(e.platform_id)
  );
$$;

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
returns uuid language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  created_id uuid;
  can_manage boolean;
  is_host boolean;
  host_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Oturum gerekli.'; end if;
  can_manage:=public.pk_can_manage_platform(p_platform_id);
  is_host:=public.current_profile_role()='host';
  if not can_manage and not (is_host and public.host_assigned_to_platform(p_platform_id)) then
    raise exception 'Bu uygulama için PK kaydı ekleme yetkin yok.';
  end if;
  if is_host and not can_manage then
    select * into host_profile from public.profiles where id=auth.uid() and active=true;
    if not found then raise exception 'Sunucu hesabı etkin değil.'; end if;
    p_host_profile_ids:=array[auth.uid()];
    p_host_names:=array[coalesce(nullif(btrim(host_profile.display_name),''),host_profile.full_name)];
    p_approval_status:='pending';
  elsif not public.pk_host_ids_valid_for_platform(p_platform_id,p_host_profile_ids) then
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
    p_platform_id,btrim(p_event_name),p_event_date,p_event_time,
    nullif(btrim(coalesce(p_tracking_code,'')),''),p_approval_status,
    p_host_profile_ids,p_host_names,nullif(btrim(coalesce(p_notes,'')),''),auth.uid()
  ) returning id into created_id;
  return created_id;
end;
$$;

drop policy if exists pk_posters_insert_manager on storage.objects;
create policy pk_posters_insert_manager on storage.objects for insert to authenticated
with check (
  bucket_id='pk-posters' and (
    public.pk_can_manage_event(((storage.foldername(name))[1])::uuid)
    or public.pk_host_can_add_poster(((storage.foldername(name))[1])::uuid)
  )
);

create or replace function public.pk_attach_poster_path(p_event_id uuid,p_poster_path text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  event_row public.pk_events%rowtype;
  can_manage boolean;
  is_owner_host boolean;
begin
  select * into event_row from public.pk_events where id=p_event_id;
  if not found then raise exception 'PK kaydı bulunamadı.'; end if;
  can_manage:=public.pk_can_manage_platform(event_row.platform_id);
  is_owner_host:=public.pk_host_can_add_poster(p_event_id);
  if not can_manage and not is_owner_host then raise exception 'Bu PK afişini ekleme yetkin yok.'; end if;
  if p_poster_path is null or left(p_poster_path,length(p_event_id::text)+1)<>(p_event_id::text||'/') then
    raise exception 'Afiş yolu bu PK kaydıyla eşleşmiyor.';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='pk-posters' and name=p_poster_path) then
    raise exception 'Yüklenen afiş dosyası bulunamadı.';
  end if;
  update public.pk_events set poster_path=p_poster_path,updated_at=now() where id=p_event_id;
  return true;
end;
$$;

revoke all on function public.my_host_platforms() from public,anon;
revoke all on function public.host_assigned_to_platform(uuid) from public,anon;
revoke all on function public.pk_host_can_add_poster(uuid) from public,anon;
revoke all on function public.pk_create_event(uuid,text,date,time,text,text,uuid[],text[],text) from public,anon;
revoke all on function public.pk_attach_poster_path(uuid,text) from public,anon;
grant execute on function public.my_host_platforms() to authenticated;
grant execute on function public.pk_host_can_add_poster(uuid) to authenticated;
grant execute on function public.pk_create_event(uuid,text,date,time,text,text,uuid[],text[],text) to authenticated;
grant execute on function public.pk_attach_poster_path(uuid,text) to authenticated;
