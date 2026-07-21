-- Widoczność grup w pasku bocznym i widokach (domyślnie włączone).
alter table public.groups add column if not exists show_in_sidebar boolean not null default true;
alter table public.groups add column if not exists show_in_tasks boolean not null default true;
alter table public.groups add column if not exists show_in_events boolean not null default true;
alter table public.groups add column if not exists show_in_dashboard boolean not null default true;
alter table public.groups add column if not exists show_in_all boolean not null default true;

-- Zgodność wsteczna z hide_from_all.
update public.groups
set show_in_all = not hide_from_all
where hide_from_all = true;
