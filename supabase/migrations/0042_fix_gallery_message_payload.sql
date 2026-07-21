-- Napraw payload wiadomości galerii: wczesny bug zapisywał { "galleryId": "…" }
-- zamiast { "gallery": { "galleryId": "…" } }, przez co UI pokazywało sam tytuł.

update public.messages
set payload = jsonb_build_object(
  'gallery',
  jsonb_build_object('galleryId', payload ->> 'galleryId')
)
where kind = 'gallery'
  and payload ? 'galleryId'
  and not (payload ? 'gallery');
