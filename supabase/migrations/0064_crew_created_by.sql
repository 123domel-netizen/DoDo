-- Twórca brygady (ACL widoczności: twórca + admin org).

alter table public.construction_crews
  add column if not exists created_by uuid references auth.users (id) on delete set null;

comment on column public.construction_crews.created_by is
  'User who created the crew; may edit viewer_user_ids with org admins.';
