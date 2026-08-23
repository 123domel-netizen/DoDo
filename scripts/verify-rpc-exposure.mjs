#!/usr/bin/env node
/**
 * Test negatywny ekspozycji RPC (docs/SECURITY.md §1.4).
 *
 * Sprawdza, czy wewnętrzne funkcje SECURITY DEFINER są osiągalne dla roli
 * `anon` przez PostgREST. Uruchamiać PRZED i PO wdrożeniu migracji 0065/0066.
 *
 *   node scripts/verify-rpc-exposure.mjs
 *   node scripts/verify-rpc-exposure.mjs --url https://x.supabase.co --anon-key ...
 *
 * Interpretacja odpowiedzi PostgREST:
 *   404  → rola nie ma EXECUTE, funkcja niewidoczna w schema cache  = ZABEZPIECZONA
 *   200  → funkcja wykonana                                        = EKSPOZYCJA
 *   400/409 → funkcja wykonana, zawiodła walidacja/FK              = EKSPOZYCJA
 *   401/403 → odrzucone przez API gateway                          = zabezpieczona
 *
 * Skrypt nie wypisuje kluczy. Wszystkie ładunki są nieszkodliwe: e-mail w domenie
 * .invalid nie istnieje, ścieżki Storage są losowe, org_id jest losowe.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function readEnvFile(name) {
  try {
    const out = {};
    for (const line of readFileSync(join(ROOT, name), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const url = (argValue("--url") ?? process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const anonKey =
  argValue("--anon-key") ?? process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "";

if (!url || !anonKey) {
  console.error(
    "Brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env, .env.local, zmienne środowiskowe lub --url/--anon-key).",
  );
  process.exit(2);
}

const rand = () => Math.random().toString(36).slice(2, 10);

/** Funkcje, które NIE MOGĄ być osiągalne dla anon. */
const INTERNAL = [
  {
    fn: "ensure_app_admin_by_email",
    body: { p_email: `probe-${rand()}@nonexistent.invalid` },
    impact: "eskalacja do administratora aplikacji",
  },
  {
    fn: "_chat_storage_copy",
    body: { p_from: `probe/${rand()}/a`, p_to: `probe/${rand()}/b` },
    impact: "kopiowanie cudzych załączników",
  },
  {
    fn: "_chat_storage_move",
    body: { p_from: `probe/${rand()}/a`, p_to: `probe/${rand()}/b` },
    impact: "przenoszenie cudzych załączników",
  },
  {
    fn: "org_expire_invites",
    body: { p_org_id: crypto.randomUUID() },
    impact: "wygaszanie zaproszeń obcej organizacji",
  },
  {
    fn: "org_audit",
    body: { p_org_id: crypto.randomUUID(), p_action: "probe", p_meta: {} },
    impact: "zaśmiecanie dziennika audytu",
  },
];

/** Kontrola pozytywna: RPC dla zalogowanych też nie może działać dla anon. */
const AUTHENTICATED_ONLY = [
  { fn: "org_my_orgs", body: {} },
  { fn: "is_app_admin", body: {} },
];

/**
 * Helpery RLS i RPC, które MUSZĄ pozostać wywoływalne po utwardzeniu.
 * Wyrażenia polityk RLS wykonują się z prawami roli pytającej, więc utrata
 * EXECUTE na tych funkcjach zepsułaby każde zapytanie do chronionej tabeli.
 * Wszystkie są tylko do odczytu — losowe UUID nie mają skutków ubocznych.
 */
const MUST_STAY_CALLABLE = [
  { fn: "is_app_admin", body: {} },
  { fn: "org_my_orgs", body: {} },
  { fn: "is_org_member", body: { p_org_id: crypto.randomUUID() } },
  { fn: "is_org_admin", body: { p_org_id: crypto.randomUUID() } },
  { fn: "can_access_item", body: { p_item_id: crypto.randomUUID() } },
  { fn: "is_conversation_member", body: { p_conversation_id: crypto.randomUUID() } },
  { fn: "shares_org_with", body: { p_other: crypto.randomUUID() } },
  { fn: "get_conversation_overview", body: {} },
  { fn: "is_construction_crew_visible", body: { p_crew_id: crypto.randomUUID() } },
  { fn: "is_construction_project_member", body: { p_project_id: crypto.randomUUID() } },
  { fn: "org_seat_usage", body: { p_org_id: crypto.randomUUID() } },
];

async function callRpc(fn, body, key = anonKey) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let detail = "";
  try {
    const text = await res.text();
    detail = text.slice(0, 160).replace(/\s+/g, " ").trim();
  } catch {
    /* bez treści */
  }
  return { status: res.status, detail };
}

/** 404 = brak EXECUTE (PostgREST ukrywa funkcję). 401/403 = odrzucone. */
function isProtected(status) {
  return status === 404 || status === 401 || status === 403;
}

const results = [];
let exposed = 0;

console.log(`Cel: ${url}`);
console.log(`Rola: anon\n`);

console.log("Helpery wewnętrzne (muszą być niedostępne):");
for (const { fn, body, impact } of INTERNAL) {
  const { status, detail } = await callRpc(fn, body);
  const ok = isProtected(status);
  if (!ok) exposed += 1;
  results.push({ fn, status, ok });
  console.log(
    `  ${ok ? "OK  " : "EKSPOZYCJA"}  ${String(status).padEnd(4)} ${fn}${ok ? "" : `  <-- ${impact}`}`,
  );
  if (!ok) console.log(`        odpowiedź: ${detail}`);
}

console.log("\nRPC dla zalogowanych (anon też nie powinien ich wykonać):");
for (const { fn, body } of AUTHENTICATED_ONLY) {
  const { status, detail } = await callRpc(fn, body);
  // Te funkcje mają wewnętrzną kontrolę auth.uid(), więc 200 z pustym wynikiem
  // nie jest luką — raportujemy informacyjnie.
  console.log(`  ${String(status).padEnd(4)} ${fn}  ${detail.slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
// Kontrola regresji: utwardzenie nie mogło odciąć ról zaufanych od helperów RLS.
// 0066 nadaje EXECUTE rolom `authenticated` i `service_role` w tej samej pętli,
// więc pozytywny wynik dla service_role dowodzi, że pętla GRANT się wykonała.
// ---------------------------------------------------------------------------
const serviceKey =
  argValue("--service-role-key") ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  env.SUPABASE_SERVICE_ROLE_KEY ??
  "";

let broken = 0;
if (serviceKey) {
  console.log("\nHelpery RLS / RPC (muszą pozostać wywoływalne dla ról zaufanych):");
  for (const { fn, body } of MUST_STAY_CALLABLE) {
    const { status, detail } = await callRpc(fn, body, serviceKey);
    const ok = status >= 200 && status < 300;
    if (!ok) broken += 1;
    console.log(`  ${ok ? "OK  " : "REGRESJA"}  ${String(status).padEnd(4)} ${fn}`);
    if (!ok) console.log(`        odpowiedź: ${detail}`);
  }

  console.log("\nHelpery wewnętrzne widziane przez service_role (też mają być zamknięte):");
  for (const { fn, body } of INTERNAL) {
    const { status } = await callRpc(fn, body, serviceKey);
    const ok = isProtected(status);
    if (!ok) exposed += 1;
    console.log(`  ${ok ? "OK  " : "EKSPOZYCJA"}  ${String(status).padEnd(4)} ${fn}`);
  }
} else {
  console.log(
    "\n(Pominięto kontrolę regresji — brak SUPABASE_SERVICE_ROLE_KEY.)",
  );
}

console.log("");
if (broken > 0) {
  console.error(
    `WYNIK: ${broken} helperów RLS/RPC przestało być wywoływalnych — utwardzenie zepsuło aplikację.`,
  );
  process.exit(1);
}
if (exposed > 0) {
  console.error(
    `WYNIK: ${exposed} z ${INTERNAL.length} funkcji wewnętrznych jest osiągalnych dla anon.`,
  );
  console.error("Wdróż migracje 0065 i 0066 (supabase db push), potem powtórz test.");
  process.exit(1);
}

console.log(`WYNIK: wszystkie ${INTERNAL.length} funkcji wewnętrznych zabezpieczonych.`);
