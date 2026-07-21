-- Galerie: własne miniatury w {folder}/_thumbnails/ (nie Graph thumbnails).
-- Miniatura powiązana z itemem przez provider_thumb_item_id; awaria miniatury
-- nie zmienia statusu głównego zdjęcia (status=ready).

alter table public.gallery_items
  add column if not exists provider_thumb_item_id text;

alter table public.gallery_items
  add column if not exists thumb_status text not null default 'pending';

-- pending | ready | failed | skipped (brak miniatury po stronie klienta)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gallery_items_thumb_status_check'
  ) then
    alter table public.gallery_items
      add constraint gallery_items_thumb_status_check
      check (thumb_status in ('pending', 'ready', 'failed', 'skipped'));
  end if;
end $$;

comment on column public.gallery_items.provider_thumb_item_id is
  'Microsoft Graph (lub inny provider) item id miniatury w podfolderze _thumbnails.';
comment on column public.gallery_items.thumb_status is
  'Stan miniatury niezależny od statusu głównego pliku.';
