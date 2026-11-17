-- Admin-managed public-facing names, separate from employees' legal names.
alter table public.profiles
  add column if not exists display_name text;

grant update(display_name) on public.profiles to authenticated;
drop policy if exists profiles_update_display_name_admin on public.profiles;
create policy profiles_update_display_name_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
