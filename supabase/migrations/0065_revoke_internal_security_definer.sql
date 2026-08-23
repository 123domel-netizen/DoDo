-- HOTFIX BEZPIECZEŃSTWA (P0)
--
-- Problem: PostgreSQL nadaje roli PUBLIC domyślne prawo EXECUTE na każdej nowo
-- utworzonej funkcji. Rola PUBLIC obejmuje `anon` i `authenticated`, więc każda
-- funkcja w schemacie `public` jest wywoływalna przez PostgREST jako RPC,
-- niezależnie od tego, czy istnieje dla niej jawny GRANT. Nazwa zaczynająca się
-- od `_` niczego nie ukrywa.
--
-- Poniższe funkcje są SECURITY DEFINER (działają z prawami właściciela, omijając
-- RLS) i NIE weryfikują wywołującego. Do tej pory nie miały żadnego REVOKE.
--
--   1. ensure_app_admin_by_email(text)  — ESKALACJA UPRAWNIEŃ: wstawia dowolnego
--      użytkownika o podanym e-mailu do public.app_admins. Anonimowy klient mógł
--      wywołać RPC z własnym adresem i zostać administratorem aplikacji.
--   2. _chat_storage_copy(text, text)   — kopiuje dowolny obiekt bucketu
--      chat-attachments (z DELETE celu) z pominięciem RLS Storage.
--   3. _chat_storage_move(text, text)   — przenosi/zmienia nazwę dowolnego
--      obiektu bucketu chat-attachments z pominięciem RLS Storage.
--   4. org_expire_invites(uuid)         — modyfikuje zaproszenia dowolnej org.
--   5. org_audit(uuid, text, jsonb)     — dopisuje wpisy do dziennika audytu
--      dowolnej organizacji (zaśmiecanie / mylenie śladu audytowego).
--
-- Wszystkie pięć są wyłącznie helperami wewnętrznymi: jedyne wywołania pochodzą
-- z innych funkcji SECURITY DEFINER (forward_message_thread, move_message_thread,
-- org_get_detail, org_invite, app_* itd.) albo z samych migracji. Wewnątrz
-- funkcji SECURITY DEFINER kontrola uprawnień odbywa się względem właściciela
-- funkcji, który zachowuje EXECUTE — dlatego odebranie praw rolom klienckim nie
-- psuje żadnej ścieżki produkcyjnej.
--
-- Migracja jest idempotentna i nie zmienia ciał funkcji.

do $$
declare
  v_sig text;
  v_role text;
  -- Helpery wewnętrzne: żadna rola kliencka nie ma prawa ich wywołać.
  v_internal constant text[] := array[
    'public.ensure_app_admin_by_email(text)',
    'public._chat_storage_copy(text, text)',
    'public._chat_storage_move(text, text)',
    'public.org_expire_invites(uuid)',
    'public.org_audit(uuid, text, jsonb)'
  ];
  v_client_roles constant text[] := array['anon', 'authenticated'];
begin
  foreach v_sig in array v_internal loop
    -- to_regprocedure zwraca NULL zamiast błędu, gdy funkcji nie ma
    -- (np. środowisko odtworzone bez którejś migracji).
    if to_regprocedure(v_sig) is null then
      raise notice 'pomijam nieistniejącą funkcję %', v_sig;
      continue;
    end if;

    execute format('revoke all on function %s from public', v_sig);

    foreach v_role in array v_client_roles loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_sig, v_role);
      end if;
    end loop;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Weryfikacja: po tej migracji poniższe zapytanie musi zwrócić zero wierszy.
-- ---------------------------------------------------------------------------
-- select p.oid::regprocedure as fn, a.grantee
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
-- join pg_roles r on r.oid = a.grantee
-- where n.nspname = 'public'
--   and p.proname in ('ensure_app_admin_by_email', '_chat_storage_copy',
--                     '_chat_storage_move', 'org_expire_invites', 'org_audit')
--   and a.privilege_type = 'EXECUTE'
--   and r.rolname in ('anon', 'authenticated', 'public');

do $$
declare
  v_leaks int;
begin
  select count(*)
  into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public'
    and p.proname in (
      'ensure_app_admin_by_email', '_chat_storage_copy',
      '_chat_storage_move', 'org_expire_invites', 'org_audit'
    )
    and a.privilege_type = 'EXECUTE'
    and (
      a.grantee = 0 -- PUBLIC
      or a.grantee in (
        select oid from pg_roles where rolname in ('anon', 'authenticated')
      )
    );

  if v_leaks > 0 then
    raise exception
      'HOTFIX 0065 nieskuteczny: % pozostawionych uprawnień EXECUTE dla ról klienckich', v_leaks;
  end if;
end
$$;
