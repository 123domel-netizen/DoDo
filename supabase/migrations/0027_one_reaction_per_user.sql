-- Jedna reakcja na użytkownika na wiadomość (zamiast wielu emotek naraz).

-- Zostaw najnowszą reakcję, gdy user ma kilka.
delete from public.message_reactions a
using public.message_reactions b
where a.message_id = b.message_id
  and a.user_id = b.user_id
  and a.emoji <> b.emoji
  and a.created_at < b.created_at;

-- Remisy created_at: zostaw leksykograficznie „większą” emoji.
delete from public.message_reactions a
using public.message_reactions b
where a.message_id = b.message_id
  and a.user_id = b.user_id
  and a.emoji < b.emoji;

alter table public.message_reactions
  drop constraint if exists message_reactions_pkey;

alter table public.message_reactions
  add primary key (message_id, user_id);
