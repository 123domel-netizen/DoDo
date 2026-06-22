-- SHARE: osobiste przypomnienia uczestnika + rozszerzony RPC treści współdzielonej.

alter table public.item_participants
  add column if not exists personal_reminders jsonb not null default '[]'::jsonb;

-- Rozszerzenie RPC: opis, checklista, załączniki/linki (payload.attachments).
drop function if exists public.update_shared_item_content(uuid, text, jsonb);

create or replace function public.update_shared_item_content(
  p_item_id uuid,
  p_description text default null,
  p_checklist jsonb default null,
  p_attachments jsonb default null
)
returns public.items
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_uid uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  prev_payload jsonb;
  next_payload jsonb;
  rec public.items;
begin
  if caller_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.item_participants ip
    where ip.item_id = p_item_id
      and ip.status <> 'rejected'
      and (
        ip.participant_user_id = caller_uid
        or lower(ip.participant_email) = caller_email
      )
  ) then
    raise exception 'not a participant';
  end if;

  select payload into prev_payload
  from public.items
  where id = p_item_id
    and deleted_at is null;

  if not found then
    if exists (select 1 from public.items where id = p_item_id) then
      raise exception 'item deleted';
    end if;
    raise exception 'item not found';
  end if;

  next_payload := coalesce(prev_payload, '{}'::jsonb);

  if p_checklist is not null then
    next_payload := jsonb_set(next_payload, '{checklist}', p_checklist, true);
  end if;

  if p_attachments is not null then
    next_payload := jsonb_set(next_payload, '{attachments}', p_attachments, true);
  end if;

  update public.items
  set
    description = coalesce(p_description, description),
    payload = next_payload,
    updated_at = now()
  where id = p_item_id
    and deleted_at is null
  returning * into rec;

  return rec;
end;
$$;

grant execute on function public.update_shared_item_content(uuid, text, jsonb, jsonb) to authenticated;

-- Osobiste przypomnienia uczestnika (tylko jego wiersz w item_participants).
create or replace function public.update_own_participation_reminders(
  p_item_id uuid,
  p_reminders jsonb
)
returns public.item_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_uid uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  rec public.item_participants;
begin
  if caller_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_reminders is null then
    raise exception 'invalid reminders';
  end if;

  if not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'item not found';
  end if;

  if not exists (select 1 from public.items where id = p_item_id and deleted_at is null) then
    raise exception 'item deleted';
  end if;

  update public.item_participants
  set
    personal_reminders = p_reminders,
    updated_at = now()
  where item_id = p_item_id
    and status <> 'rejected'
    and (
      participant_user_id = caller_uid
      or lower(participant_email) = caller_email
    )
  returning * into rec;

  if not found then
    raise exception 'participation not found';
  end if;

  return rec;
end;
$$;

grant execute on function public.update_own_participation_reminders(uuid, jsonb) to authenticated;
