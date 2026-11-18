-- Track whether each referred creator received a referral payment.
alter table public.referral_entries
  add column if not exists referral_payment_status text not null default 'unknown';
alter table public.referral_entries
  add column if not exists referral_payment_amount numeric(12,2);
alter table public.referral_entries
  add column if not exists referral_payment_currency text not null default 'TRY';

alter table public.referral_entries
  drop constraint if exists referral_entries_payment_status_check;
alter table public.referral_entries
  add constraint referral_entries_payment_status_check
  check (referral_payment_status in ('unknown','paid','not_paid'));
alter table public.referral_entries
  drop constraint if exists referral_entries_payment_amount_check;
alter table public.referral_entries
  add constraint referral_entries_payment_amount_check
  check (
    (referral_payment_status='paid' and referral_payment_amount is not null and referral_payment_amount>0)
    or (referral_payment_status<>'paid' and referral_payment_amount is null)
  );
alter table public.referral_entries
  drop constraint if exists referral_entries_payment_currency_check;
alter table public.referral_entries
  add constraint referral_entries_payment_currency_check
  check (referral_payment_currency in ('TRY','GBP','USD','EUR'));

create or replace function public.set_referral_payment(
  p_referral_id uuid,
  p_status text,
  p_amount numeric,
  p_currency text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  referral_row public.referral_entries%rowtype;
  allowed boolean := false;
begin
  select * into referral_row from public.referral_entries where id=p_referral_id;
  if not found then raise exception 'Referans kaydı bulunamadı.'; end if;

  if public.is_admin() then
    allowed := true;
  elsif public.current_profile_role()='assistant' and referral_row.submitted_by=auth.uid() then
    allowed := true;
  elsif public.current_profile_role()='consultant' and exists(
    select 1 from public.consultant_platforms cp
    where cp.user_id=auth.uid() and cp.platform_id=referral_row.platform_id
  ) then
    allowed := true;
  end if;
  if not allowed then raise exception 'Bu referans kaydının ödeme bilgisini değiştirme yetkin yok.'; end if;

  if p_status not in ('unknown','paid','not_paid') then
    raise exception 'Ödeme durumu geçersiz.';
  end if;
  if p_currency not in ('TRY','GBP','USD','EUR') then
    raise exception 'Para birimi geçersiz.';
  end if;
  if p_status='paid' and (p_amount is null or p_amount<=0) then
    raise exception 'Ödeme var seçildiğinde tutarı gir.';
  end if;
  if p_status<>'paid' then p_amount := null; end if;

  update public.referral_entries
    set referral_payment_status=p_status,
        referral_payment_amount=p_amount,
        referral_payment_currency=p_currency,
        updated_at=now()
    where id=p_referral_id;
  return true;
end;
$$;

revoke all on function public.set_referral_payment(uuid,text,numeric,text) from public, anon;
grant execute on function public.set_referral_payment(uuid,text,numeric,text) to authenticated;
