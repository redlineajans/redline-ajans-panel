insert into public.platforms (name, status)
values ('Simi', 'active')
on conflict (name) do update
set status = excluded.status;
