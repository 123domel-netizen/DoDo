-- Dowód behawioralny modelu uprawnień, na którym opiera się migracja 0065.
--
-- UWAGA: skrypt TWORZY I USUWA tymczasowe funkcje. Uruchamiać wyłącznie na
-- bazie lokalnej / w CI, nigdy na produkcji.
--
--   supabase start
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/tests/nested_call_model.sql
--
-- Teza: odebranie roli `authenticated` prawa EXECUTE na helperze wewnętrznym
-- nie psuje funkcji opakowującej, bo wewnątrz SECURITY DEFINER uprawnienia
-- sprawdzane są względem właściciela funkcji, a nie roli wywołującej.
-- To dokładnie ta zależność, która utrzymuje przy życiu forward_message_thread
-- i move_message_thread po utwardzeniu.

\set ON_ERROR_STOP on

begin;

create function public._t_nested_helper()
returns text
language sql
security definer
set search_path = public
as $$ select 'helper-wykonany'::text $$;

-- Odtwarzamy stan po migracji 0065.
revoke all on function public._t_nested_helper() from public;
revoke all on function public._t_nested_helper() from anon, authenticated;

create function public._t_nested_wrapper()
returns text
language plpgsql
security definer
set search_path = public
as $$ begin return public._t_nested_helper(); end $$;

grant execute on function public._t_nested_wrapper() to authenticated;

do $$
declare
  v_result text;
begin
  set local role authenticated;

  -- 1. Wywołanie zagnieżdżone MUSI się udać.
  begin
    select public._t_nested_wrapper() into v_result;
  exception when insufficient_privilege then
    reset role;
    raise exception
      'REGRESJA: SECURITY DEFINER nie może wywołać własnego helpera — 0065 psuje forward/move';
  end;

  if v_result is distinct from 'helper-wykonany' then
    reset role;
    raise exception 'Nieoczekiwany wynik opakowania: %', v_result;
  end if;
  raise notice 'OK: opakowanie SECURITY DEFINER wywołało helper mimo braku praw roli klienckiej.';

  -- 2. Wywołanie bezpośrednie MUSI zostać odrzucone.
  begin
    select public._t_nested_helper() into v_result;
    reset role;
    raise exception
      'REGRESJA: rola authenticated wywołała helper bezpośrednio — REVOKE nieskuteczny';
  exception when insufficient_privilege then
    raise notice 'OK: bezpośrednie wywołanie helpera odrzucone dla roli authenticated.';
  end;

  reset role;
end
$$;

rollback;
