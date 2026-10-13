-- Przywrócenie kanału z archiwum: czyść też osobiste conversation_members.archived_at.
-- Inaczej overview (coalesce(cm.archived_at, channel_archived_at)) nadal pokazuje archiwum
-- po samym wyzerowaniu channel_archived_at (stare dane sprzed globalnego archiwum).

create or replace function public.set_conversation_archived(
  p_conversation_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conv_kind text;
  v_dm_key text;
  active_members integer;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select c.kind, c.dm_key into conv_kind, v_dm_key
  from public.conversations c
  where c.id = p_conversation_id;

  if conv_kind is null then
    raise exception 'conversation not found';
  end if;

  if conv_kind = 'channel' then
    if not public.is_conversation_admin(p_conversation_id) then
      raise exception 'not an admin';
    end if;
    update public.conversations
    set channel_archived_at = case when p_archived then now() else null end
    where id = p_conversation_id;
    -- Globalne przywrócenie: zdejmij też per-user archive (legacy / mieszane stany).
    if not p_archived then
      update public.conversation_members
      set archived_at = null
      where conversation_id = p_conversation_id
        and archived_at is not null;
    end if;
    return;
  end if;

  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a member';
  end if;

  if p_archived and conv_kind = 'dm' and v_dm_key = caller::text then
    raise exception 'cannot archive notebook';
  end if;

  select count(*)::integer into active_members
  from public.conversation_members m
  where m.conversation_id = p_conversation_id
    and m.left_at is null;

  if p_archived and conv_kind = 'dm' and active_members <= 1 then
    raise exception 'cannot archive notebook';
  end if;

  insert into public.conversation_members (conversation_id, user_id, archived_at)
  values (p_conversation_id, caller, case when p_archived then now() end)
  on conflict (conversation_id, user_id) do update
    set archived_at = case when p_archived then now() else null end,
        left_at = null;
end;
$$;

revoke all on function public.set_conversation_archived(uuid, boolean) from public;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;
