-- Tombstone (soft delete) dla itemów — zapobiega „zombie items” przy multi-device sync.

alter table public.items
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

create index if not exists items_deleted_at_idx on public.items (deleted_at);

create index if not exists items_active_user_idx on public.items (user_id)
  where deleted_at is null;

-- Upsert ze starego urządzenia nie może wyczyścić tombstone.
create or replace function public.items_preserve_tombstone()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' and OLD.deleted_at is not null and NEW.deleted_at is null then
    NEW.deleted_at := OLD.deleted_at;
    NEW.deleted_by := OLD.deleted_by;
  end if;
  return NEW;
end;
$$;

drop trigger if exists items_preserve_tombstone on public.items;
create trigger items_preserve_tombstone
  before update on public.items
  for each row execute function public.items_preserve_tombstone();
