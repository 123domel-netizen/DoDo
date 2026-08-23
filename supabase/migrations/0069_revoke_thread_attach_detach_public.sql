-- 0067/0068 mogły już wejść na żywe środowiska bez REVOKE FROM PUBLIC.
-- Idempotentne utwardzenie grantów (jak wzorzec 0063).

revoke all on function public.attach_message_to_thread(uuid, uuid) from public;
grant execute on function public.attach_message_to_thread(uuid, uuid) to authenticated;

revoke all on function public.detach_message_from_thread(uuid) from public;
grant execute on function public.detach_message_from_thread(uuid) to authenticated;
