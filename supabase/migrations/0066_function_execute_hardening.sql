-- Utwardzenie uprawnień EXECUTE dla funkcji SECURITY DEFINER (SEC-02).
--
-- Kontekst: migracja 0065 zamknęła pięć najgroźniejszych helperów. Ta migracja
-- porządkuje pozostałe funkcje i — co ważniejsze — usuwa przyczynę problemu,
-- czyli domyślne prawo EXECUTE dla roli PUBLIC.
--
-- Zasady docelowe:
--   * żadna funkcja w schemacie `public` nie jest wywoływalna przez PUBLIC,
--   * `anon` nie może wywołać żadnej funkcji SECURITY DEFINER (aplikacja wymaga
--     logowania; żadna polityka RLS w repozytorium nie jest adresowana do anon),
--   * `authenticated` dostaje jawny GRANT — jest to konieczne, ponieważ wyrażenia
--     polityk RLS (`is_conversation_member`, `can_access_item`, `is_org_member`,
--     `is_construction_crew_visible`, …) są wykonywane z prawami roli pytającej,
--     więc odebranie im EXECUTE zepsułoby każde zapytanie do chronionych tabel,
--   * `service_role` zachowuje EXECUTE (zaufana rola backendowa, i tak omija RLS),
--   * helpery wewnętrzne z listy `v_internal` nie dostają żadnego GRANT.
--
-- Migracja steruje się katalogiem systemowym (`pg_proc`), a nie ręczną listą
-- ~80 sygnatur. Dzięki temu nie rozjedzie się z rzeczywistym stanem bazy, gdy
-- funkcja zostanie przedefiniowana z inną listą argumentów.
--
-- Funkcje zwracające `trigger` są pominięte: PostgREST ich nie eksponuje, a
-- odpalenie triggera nie sprawdza EXECUTE wywołującego.

do $$
declare
  r record;
  v_role text;
  -- Helpery wewnętrzne — wywoływane wyłącznie z innych funkcji SECURITY DEFINER.
  v_internal constant text[] := array[
    'ensure_app_admin_by_email',
    '_chat_storage_copy',
    '_chat_storage_move',
    'org_expire_invites',
    'org_audit'
  ];
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke all on function %s from public', r.sig);

    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', r.sig);
    end if;

    if r.proname = any (v_internal) then
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute format('revoke all on function %s from authenticated', r.sig);
      end if;
      if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute format('revoke all on function %s from service_role', r.sig);
      end if;
      continue;
    end if;

    foreach v_role in array array['authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('grant execute on function %s to %I', r.sig, v_role);
      end if;
    end loop;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Przyczyna źródłowa: nowe funkcje nie mogą już dziedziczyć EXECUTE dla PUBLIC.
-- ---------------------------------------------------------------------------
-- ALTER DEFAULT PRIVILEGES działa per rola tworząca obiekt, dlatego ustawiamy je
-- dla właściciela bieżącej migracji ORAZ dla `postgres`, jeśli role są różne
-- (Supabase stosuje różnych właścicieli zależnie od sposobu wdrożenia migracji).
do $$
declare
  v_owner text := current_user;
begin
  execute format(
    'alter default privileges for role %I in schema public revoke execute on functions from public',
    v_owner
  );

  if v_owner <> 'postgres' and exists (select 1 from pg_roles where rolname = 'postgres') then
    begin
      alter default privileges for role postgres in schema public
        revoke execute on functions from public;
    exception
      when insufficient_privilege then
        raise notice
          'Brak uprawnień do ustawienia default privileges dla roli postgres — ustaw ręcznie.';
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Bramka weryfikacyjna: żadna funkcja SECURITY DEFINER nie może być wywoływalna
-- przez PUBLIC ani anon. Migracja zawodzi głośno, jeśli coś zostało pominięte.
-- ---------------------------------------------------------------------------
do $$
declare
  v_leaks int;
  v_sample text;
begin
  select count(*), min(sig)
  into v_leaks, v_sample
  from (
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and a.privilege_type = 'EXECUTE'
      and (
        a.grantee = 0 -- PUBLIC
        or a.grantee in (select oid from pg_roles where rolname = 'anon')
      )
  ) leaks;

  if v_leaks > 0 then
    raise exception
      'Utwardzenie 0066 nieskuteczne: % funkcji SECURITY DEFINER nadal dostępnych dla PUBLIC/anon (np. %)',
      v_leaks, v_sample;
  end if;
end
$$;
