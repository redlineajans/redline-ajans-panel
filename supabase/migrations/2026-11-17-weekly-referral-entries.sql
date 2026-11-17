-- Weekly referral register. Assistants can add/edit their own entries,
-- consultants can read entries for assigned platforms, and only admins delete.
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

create index if not exists referral_entries_period_platform_idx
  on public.referral_entries(period_start desc, platform_id);
create index if not exists referral_entries_submitter_idx
  on public.referral_entries(submitted_by, period_start desc);

alter table public.referral_entries enable row level security;
revoke all on public.referral_entries from anon, authenticated;
grant select, insert, update, delete on public.referral_entries to authenticated;

drop policy if exists referral_entries_read_scope on public.referral_entries;
create policy referral_entries_read_scope on public.referral_entries
  for select to authenticated
  using (
    public.is_admin()
    or public.current_profile_role() = 'assistant'
    or (public.current_profile_role() = 'consultant' and exists (
      select 1 from public.consultant_platforms cp
      where cp.user_id = auth.uid() and cp.platform_id = referral_entries.platform_id
    ))
  );

drop policy if exists referral_entries_insert_scope on public.referral_entries;
create policy referral_entries_insert_scope on public.referral_entries
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.current_profile_role() = 'assistant' and submitted_by = auth.uid())
  );

drop policy if exists referral_entries_update_scope on public.referral_entries;
create policy referral_entries_update_scope on public.referral_entries
  for update to authenticated
  using (public.is_admin() or (public.current_profile_role() = 'assistant' and submitted_by = auth.uid()))
  with check (public.is_admin() or (public.current_profile_role() = 'assistant' and submitted_by = auth.uid()));

drop policy if exists referral_entries_delete_admin_only on public.referral_entries;
create policy referral_entries_delete_admin_only on public.referral_entries
  for delete to authenticated using (public.is_admin());
