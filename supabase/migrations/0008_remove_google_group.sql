-- Usunięcie legacy grupy GOOGLE (integracja Kalendarz/Zadania wyłączona).

update public.items
set group_id = null
where group_id in (
  select id from public.groups
  where system = 'google' or lower(trim(name)) = 'google'
);

delete from public.groups
where system = 'google' or lower(trim(name)) = 'google';
