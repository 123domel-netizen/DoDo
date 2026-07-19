-- Prywatne etykiety użytkownika (grupa + tagi) dla decyzji i notatek czatu.
-- Każdy użytkownik ma własne przypisania — filtr hubu działa lokalnych grup/tagów.

create table if not exists public.user_registry_labels (
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('decision', 'note')),
  entity_id   uuid not null,
  group_id    uuid references public.groups (id) on delete set null,
  tag_ids     uuid[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, entity_id)
);

create index if not exists user_registry_labels_user_kind_idx
  on public.user_registry_labels (user_id, kind);

alter table public.user_registry_labels enable row level security;

drop policy if exists "own registry labels" on public.user_registry_labels;
create policy "own registry labels" on public.user_registry_labels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_registry_labels to authenticated;
