-- Existing Supabase project upgrade: weekly contact-number count for performance rows.
alter table public.performance_entries
  add column if not exists phone_numbers_count integer not null default 0
  check (phone_numbers_count >= 0);
