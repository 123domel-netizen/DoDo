-- Notatki: tytuł + możliwość edycji przez autora.

alter table public.notes
  add column if not exists title text not null default '';

-- Backfill: pierwsza linia body → title (gdy pusty).
update public.notes
set title = left(
  coalesce(nullif(trim(split_part(body, E'\n', 1)), ''), 'Notatka'),
  120
)
where title = '';

drop policy if exists "author updates note" on public.notes;
create policy "author updates note" on public.notes
  for update using (created_by = auth.uid())
  with check (created_by = auth.uid());

grant select, insert, update, delete on public.notes to authenticated;
