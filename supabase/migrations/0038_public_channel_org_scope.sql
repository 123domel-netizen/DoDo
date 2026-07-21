-- Publiczne kanały: widoczne tylko dla osób dzielących org z członkiem lub twórcą kanału.

create or replace function public.shares_org_with_channel(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.left_at is null
      and public.shares_org_with(cm.user_id)
  ) or exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.created_by is not null
      and public.shares_org_with(c.created_by)
  );
$$;

grant execute on function public.shares_org_with_channel(uuid) to authenticated;

drop policy if exists "member or public channel read" on public.conversations;
create policy "member or public channel read" on public.conversations
  for select using (
    public.is_conversation_member(id)
    or (
      kind = 'channel'
      and is_public
      and archived_at is null
      and public.shares_org_with_channel(id)
    )
  );
