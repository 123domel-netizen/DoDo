-- 0067/0068/0069 odebrały PUBLIC, ale anon nadal miał EXECUTE (CI: security_definer_grants).

revoke all on function public.attach_message_to_thread(uuid, uuid) from anon;
revoke all on function public.detach_message_from_thread(uuid) from anon;

grant execute on function public.attach_message_to_thread(uuid, uuid) to authenticated;
grant execute on function public.detach_message_from_thread(uuid) to authenticated;
