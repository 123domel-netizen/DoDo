-- Audyt uprawnień EXECUTE — uruchamialny na dowolnym środowisku.
--
-- Użycie (Supabase SQL Editor albo psql):
--   psql "$DATABASE_URL" -f supabase/tests/security_definer_grants.sql
--
-- Skrypt tylko czyta katalog systemowy. Kończy się błędem, jeśli którakolwiek
-- funkcja SECURITY DEFINER jest wywoływalna przez PUBLIC/anon albo jeśli helper
-- wewnętrzny jest osiągalny dla roli klienckiej.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. Raport: pełna inwentaryzacja funkcji SECURITY DEFINER i ich uprawnień
-- ---------------------------------------------------------------------------
select
  p.oid::regprocedure                              as funkcja,
  p.prorettype = 'pg_catalog.trigger'::regtype     as trigger_fn,
  coalesce(
    string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ', ' order by coalesce(r.rolname, 'PUBLIC')),
    '(brak)'
  )                                                as execute_dla,
  p.proconfig                                      as ustawienia
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  on a.privilege_type = 'EXECUTE'
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.prosecdef
group by p.oid, p.prorettype, p.proconfig
order by 1;

-- ---------------------------------------------------------------------------
-- 2. Asercja: brak ekspozycji dla PUBLIC / anon
-- ---------------------------------------------------------------------------
do $$
declare
  v_list text;
begin
  select string_agg(sig, e'\n  ' order by sig)
  into v_list
  from (
    select distinct p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and a.privilege_type = 'EXECUTE'
      and (
        a.grantee = 0
        or a.grantee in (select oid from pg_roles where rolname = 'anon')
      )
  ) t;

  if v_list is not null then
    raise exception e'Funkcje SECURITY DEFINER dostępne dla PUBLIC/anon:\n  %', v_list;
  end if;

  raise notice 'OK: brak funkcji SECURITY DEFINER dostępnych dla PUBLIC/anon.';
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Asercja: helpery wewnętrzne niedostępne dla żadnej roli klienckiej
-- ---------------------------------------------------------------------------
do $$
declare
  v_list text;
begin
  select string_agg(format('%s -> %s', sig, grantee), e'\n  ' order by sig)
  into v_list
  from (
    select
      p.oid::regprocedure::text as sig,
      coalesce(r.rolname, 'PUBLIC') as grantee
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public'
      and p.proname in (
        'ensure_app_admin_by_email', '_chat_storage_copy', '_chat_storage_move',
        'org_expire_invites', 'org_audit'
      )
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or coalesce(r.rolname, '') in ('anon', 'authenticated'))
  ) t;

  if v_list is not null then
    raise exception e'Helpery wewnętrzne osiągalne dla ról klienckich:\n  %', v_list;
  end if;

  raise notice 'OK: helpery wewnętrzne zamknięte.';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Asercja: każda funkcja SECURITY DEFINER ma ustawiony search_path
--    (ochrona przed przejęciem przez podmianę obiektów w search_path)
-- ---------------------------------------------------------------------------
do $$
declare
  v_list text;
begin
  select string_agg(p.oid::regprocedure::text, e'\n  ' order by p.oid::regprocedure::text)
  into v_list
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) c
      where c like 'search_path=%'
    );

  if v_list is not null then
    raise exception e'Funkcje SECURITY DEFINER bez jawnego search_path:\n  %', v_list;
  end if;

  raise notice 'OK: wszystkie funkcje SECURITY DEFINER mają search_path.';
end
$$;

-- ---------------------------------------------------------------------------
-- 4b. Asercja: wywołujący helpery wewnętrzne muszą być SECURITY DEFINER
--     o tym samym właścicielu.
--
--     To jest niezmiennik, dzięki któremu migracja 0065 jest bezpieczna.
--     Wewnątrz funkcji SECURITY DEFINER prawo EXECUTE sprawdzane jest względem
--     WŁAŚCICIELA funkcji, a nie wywołującego — dlatego forward/move działa
--     mimo odebrania praw rolom klienckim. Niezmiennik pęka, gdy ktoś zmieni
--     funkcję opakowującą na SECURITY INVOKER albo utworzy ją jako inna rola:
--     wtedy zagnieżdżone wywołanie zacznie zwracać "permission denied".
-- ---------------------------------------------------------------------------
do $$
declare
  v_list text;
begin
  select string_agg(
           format('%s (secdef=%s, właściciel=%s) wywołuje %s (właściciel=%s)',
                  caller, caller_secdef, caller_owner, helper, helper_owner),
           e'\n  ' order by caller)
  into v_list
  from (
    select
      caller.oid::regprocedure::text as caller,
      caller.prosecdef              as caller_secdef,
      co.rolname                    as caller_owner,
      helper.proname                as helper,
      ho.rolname                    as helper_owner
    from pg_proc helper
    join pg_namespace hn on hn.oid = helper.pronamespace
    join pg_roles ho on ho.oid = helper.proowner
    join pg_proc caller on caller.oid <> helper.oid
    join pg_namespace cn on cn.oid = caller.pronamespace
    join pg_roles co on co.oid = caller.proowner
    where hn.nspname = 'public'
      and cn.nspname = 'public'
      and helper.proname in (
        'ensure_app_admin_by_email', '_chat_storage_copy', '_chat_storage_move',
        'org_expire_invites', 'org_audit'
      )
      -- zawężamy do faktycznych wywołań w ciele funkcji
      and caller.prosrc ~ ('\m' || helper.proname || '\M')
      and (not caller.prosecdef or co.rolname <> ho.rolname)
  ) t;

  if v_list is not null then
    raise exception
      e'Helpery wewnętrzne wywoływane z niebezpiecznego kontekstu:\n  %', v_list;
  end if;

  raise notice 'OK: wszyscy wywołujący helpery wewnętrzne to SECURITY DEFINER o zgodnym właścicielu.';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Asercja: każda tabela w schemacie public ma włączony RLS
-- ---------------------------------------------------------------------------
do $$
declare
  v_list text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into v_list
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if v_list is not null then
    raise exception 'Tabele bez RLS: %', v_list;
  end if;

  raise notice 'OK: wszystkie tabele public mają RLS.';
end
$$;
