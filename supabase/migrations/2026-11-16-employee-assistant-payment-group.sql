-- Record assistants serve all platforms, so keep them in a dedicated group
-- and record their expenses as general agency expenses (platform_id = NULL).
alter table public.employee_payees
  add column if not exists employee_type text not null default 'platform_worker';

alter table public.employee_payees
  drop constraint if exists employee_payees_employee_type_check;
alter table public.employee_payees
  add constraint employee_payees_employee_type_check
  check (employee_type in ('assistant', 'platform_worker'));

alter table public.employee_payees
  alter column platform_id drop not null;

-- Existing linked assistant accounts are automatically moved to the new group.
update public.employee_payees e
set employee_type = 'assistant', platform_id = null, updated_at = now()
from public.profiles p
where e.profile_id = p.id
  and p.role = 'assistant';

create index if not exists employee_payees_type_idx
  on public.employee_payees(employee_type, status, full_name);
