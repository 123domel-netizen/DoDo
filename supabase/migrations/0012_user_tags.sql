-- Tagi użytkownika + prywatne przypisania tagów do itemów (w tym SHARE).

create table if not exists public.user_tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  color       text not null default '#857A9E',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists user_tags_user_name_idx
  on public.user_tags (user_id, lower(name));

create table if not exists public.user_item_tag_assignments (
  user_id     uuid not null references auth.users (id) on delete cascade,
  item_id     uuid not null references public.items (id) on delete cascade,
  tag_ids     uuid[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.user_tags enable row level security;
alter table public.user_item_tag_assignments enable row level security;

create policy "own user tags" on public.user_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own item tag assignments" on public.user_item_tag_assignments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
