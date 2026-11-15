-- Add separate weekly report fields for registrar assistants and consultants.
-- Existing rows remain valid and are treated as assistant reports.
alter table public.performance_entries
  add column if not exists report_type text not null default 'assistant',
  add column if not exists quota_completed integer not null default 0,
  add column if not exists background_quota integer not null default 0,
  add column if not exists weekly_issues text,
  add column if not exists solution_suggestions text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.performance_entries'::regclass
      and conname = 'performance_entries_report_type_check'
  ) then
    alter table public.performance_entries
      add constraint performance_entries_report_type_check
      check (report_type in ('assistant', 'consultant'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.performance_entries'::regclass
      and conname = 'performance_entries_quota_completed_check'
  ) then
    alter table public.performance_entries
      add constraint performance_entries_quota_completed_check
      check (quota_completed >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.performance_entries'::regclass
      and conname = 'performance_entries_background_quota_check'
  ) then
    alter table public.performance_entries
      add constraint performance_entries_background_quota_check
      check (background_quota >= 0);
  end if;
end $$;
