-- KOMUNIKATOR (CHAT3): push natychmiast po nowej wiadomości.
-- Trigger pg_net → Edge Function notify-message (verify_jwt=false, sekret w nagłówku).
--
-- PRZED URUCHOMIENIEM podmień:
--   <PROJECT_REF>       — ref projektu Supabase
--   <CHAT_PUSH_SECRET>  — losowy sekret; ta sama wartość jako sekret funkcji:
--                         supabase secrets set CHAT_PUSH_SECRET=...
-- Wymaga rozszerzenia pg_net (włączone przy 0002_cron.sql).

create or replace function public.notify_message_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Wpisy systemowe nie generują push.
  if new.kind = 'system' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-chat-secret', '<CHAT_PUSH_SECRET>'
    ),
    body := jsonb_build_object('messageId', new.id)
  );
  return new;
end;
$$;

drop trigger if exists messages_notify_push on public.messages;
create trigger messages_notify_push
  after insert on public.messages
  for each row execute function public.notify_message_push();
