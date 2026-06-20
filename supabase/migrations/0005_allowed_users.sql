-- Whitelist kont Google (logowanie do aplikacji)
-- Admin dodaje maile ręcznie w SQL Editor, np.:
--   insert into public.allowed_users (email) values
--     ('ty@gmail.com'),
--     ('zona@gmail.com');

create table if not exists public.allowed_users (
  email       text primary key,
  invited_at  timestamptz not null default now()
);

alter table public.allowed_users enable row level security;
-- Brak policy dla authenticated/anon → odczyt tylko service role (Edge Functions).

grant all on public.allowed_users to service_role;
