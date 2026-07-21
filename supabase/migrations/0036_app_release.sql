-- Wersja klienta PWA — jeden wiersz; po deployu ustaw version (np. git short SHA).
create table if not exists public.app_release (
  id text primary key,
  version text not null,
  message text,
  updated_at timestamptz not null default now()
);

insert into public.app_release (id, version)
values ('client', 'dev')
on conflict (id) do nothing;

alter table public.app_release enable row level security;

drop policy if exists "authenticated read app_release" on public.app_release;
create policy "authenticated read app_release" on public.app_release
  for select to authenticated using (true);

drop policy if exists "app admins manage app_release" on public.app_release;
create policy "app admins manage app_release" on public.app_release
  for all using (public.is_app_admin()) with check (public.is_app_admin());

grant select on public.app_release to authenticated;
grant all on public.app_release to service_role;
