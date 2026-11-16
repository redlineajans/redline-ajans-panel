-- Admin-only employee payment register with a status-only view for linked employees.
create table if not exists public.employee_payees (
  id uuid primary key default gen_random_uuid(),
  platform_id uuid not null references public.platforms(id) on delete restrict,
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  employee_number text,
  phone text,
  iban text,
  monthly_amount numeric(14,2) not null default 0 check (monthly_amount >= 0),
  weekly_amount numeric(14,2) not null default 0 check (weekly_amount >= 0),
  minimum_wage boolean not null default false,
  debt_note text,
  binance_trc20 text,
  currency text not null default 'USD' check (currency in ('GBP','TRY','EUR','USD')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_payees add column if not exists employee_number text;

create table if not exists public.employee_payment_cycles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee_payees(id) on delete cascade,
  period_type text not null check (period_type in ('weekly','monthly')),
  period_start date not null,
  period_end date not null,
  amount_due numeric(14,2) not null check (amount_due > 0),
  currency text not null check (currency in ('GBP','TRY','EUR','USD')),
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique(employee_id, period_type, period_start, period_end)
);

create table if not exists public.employee_payments (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.employee_payment_cycles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_on date not null default current_date,
  financial_entry_id uuid references public.financial_entries(id) on delete set null,
  note text,
  entered_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists employee_payees_platform_idx on public.employee_payees(platform_id, status, full_name);
create index if not exists employee_payment_cycles_employee_idx on public.employee_payment_cycles(employee_id, period_end desc);
create index if not exists employee_payments_cycle_idx on public.employee_payments(cycle_id, paid_on);

alter table public.employee_payees enable row level security;
alter table public.employee_payment_cycles enable row level security;
alter table public.employee_payments enable row level security;
revoke all on public.employee_payees, public.employee_payment_cycles, public.employee_payments from anon, authenticated;
grant select, insert, update, delete on public.employee_payees, public.employee_payment_cycles, public.employee_payments to authenticated;

drop policy if exists employee_payees_admin_only on public.employee_payees;
create policy employee_payees_admin_only on public.employee_payees for all to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists employee_payment_cycles_admin_only on public.employee_payment_cycles;
create policy employee_payment_cycles_admin_only on public.employee_payment_cycles for all to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists employee_payments_admin_only on public.employee_payments;
create policy employee_payments_admin_only on public.employee_payments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create or replace function public.record_employee_payment(
  p_employee_id uuid,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_amount_due numeric,
  p_amount numeric,
  p_currency text,
  p_paid_on date,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee public.employee_payees%rowtype;
  v_cycle_id uuid;
  v_finance_id uuid;
  v_payment_id uuid;
  v_paid_total numeric(14,2);
begin
  if not public.is_admin() then raise exception 'Yalnızca yönetici ödeme girişi yapabilir.' using errcode='42501'; end if;
  if p_period_type not in ('weekly','monthly') or p_period_end < p_period_start then
    raise exception 'Ödeme dönemi bilgisi geçersiz.' using errcode='22023';
  end if;
  if p_amount <= 0 or p_amount_due <= 0 or p_currency not in ('GBP','TRY','EUR','USD') then
    raise exception 'Ödeme tutarı veya para birimi geçersiz.' using errcode='22023';
  end if;
  select * into v_employee from public.employee_payees where id=p_employee_id;
  if not found then raise exception 'Çalışan kaydı bulunamadı.' using errcode='P0002'; end if;

  insert into public.employee_payment_cycles(employee_id,period_type,period_start,period_end,amount_due,currency)
  values(p_employee_id,p_period_type,p_period_start,p_period_end,p_amount_due,p_currency)
  on conflict(employee_id,period_type,period_start,period_end)
  do update set amount_due=excluded.amount_due,currency=excluded.currency
  returning id into v_cycle_id;

  insert into public.financial_entries(entry_type,category,description,amount,currency,occurred_on,platform_id,entered_by)
  values('expense','Çalışan ödemesi',v_employee.full_name || ' · ' ||
    case when p_period_type='weekly' then 'Haftalık' else 'Aylık' end || ' ödeme (' ||
    p_period_start::text || ' – ' || p_period_end::text || ')',
    p_amount,p_currency,p_paid_on,v_employee.platform_id,auth.uid())
  returning id into v_finance_id;

  insert into public.employee_payments(cycle_id,amount,paid_on,financial_entry_id,note,entered_by)
  values(v_cycle_id,p_amount,p_paid_on,v_finance_id,nullif(btrim(p_note),''),auth.uid())
  returning id into v_payment_id;

  select coalesce(sum(amount),0) into v_paid_total from public.employee_payments where cycle_id=v_cycle_id;
  return jsonb_build_object('cycle_id',v_cycle_id,'payment_id',v_payment_id,
    'paid_total',v_paid_total,'amount_due',p_amount_due,'remaining',greatest(0,p_amount_due-v_paid_total),
    'is_paid',v_paid_total>=p_amount_due);
end;
$$;

create or replace function public.delete_employee_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_financial_entry_id uuid;
begin
  if not public.is_admin() then raise exception 'Yalnızca yönetici ödeme kaydını silebilir.' using errcode='42501'; end if;
  select financial_entry_id into v_financial_entry_id from public.employee_payments where id=p_payment_id;
  if not found then return; end if;
  delete from public.financial_entries where id=v_financial_entry_id;
  delete from public.employee_payments where id=p_payment_id;
end;
$$;

create or replace function public.my_employee_payment_status()
returns table(period_type text, period_start date, period_end date, is_paid boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.period_type,c.period_start,c.period_end,
    coalesce(sum(p.amount),0) >= c.amount_due as is_paid
  from public.employee_payees e
  join public.employee_payment_cycles c on c.employee_id=e.id
  left join public.employee_payments p on p.cycle_id=c.id
  where e.profile_id=auth.uid()
  group by c.id,c.period_type,c.period_start,c.period_end,c.amount_due
  order by c.period_end desc
  limit 100;
$$;

revoke all on function public.record_employee_payment(uuid,text,date,date,numeric,numeric,text,date,text) from public, anon;
revoke all on function public.delete_employee_payment(uuid) from public, anon;
revoke all on function public.my_employee_payment_status() from public, anon;
grant execute on function public.record_employee_payment(uuid,text,date,date,numeric,numeric,text,date,text) to authenticated;
grant execute on function public.delete_employee_payment(uuid) to authenticated;
grant execute on function public.my_employee_payment_status() to authenticated;
