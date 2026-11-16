-- Keep existing platform links and records while updating the displayed name.
update public.platforms
set name = 'Layla – Nivi', status = 'active'
where name = 'Layla';

update public.platforms
set status = 'active'
where lower(name) = 'sohbi';

insert into public.platforms (name, status)
values ('Simi', 'active')
on conflict (name) do update
set status = excluded.status;
