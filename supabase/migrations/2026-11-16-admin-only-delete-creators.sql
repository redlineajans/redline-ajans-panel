grant delete on public.creators to authenticated;

drop policy if exists creators_delete_admin_only on public.creators;
create policy creators_delete_admin_only
on public.creators for delete to authenticated
using (public.is_admin());
