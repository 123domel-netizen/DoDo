#!/usr/bin/env node
/**
 * Przegląd poincydentowy po zamknięciu ekspozycji RPC (docs/SECURITY.md §1.7).
 *
 * Migracje 0065/0066 zamykają wektor, ale nie mówią, czy ktoś z niego skorzystał.
 * Skrypt szuka śladów nadużycia trzech funkcji, które były osiągalne dla anon:
 *   ensure_app_admin_by_email  → nieoczekiwane konta w app_admins
 *   _chat_storage_copy/_move   → załączniki o ścieżce niezgodnej z konwencją
 *   org_audit                  → wpisy audytu o nieznanej akcji
 *
 *   node scripts/audit-security-incident.mjs
 *
 * Wyłącznie odczyt. Wymaga SUPABASE_SERVICE_ROLE_KEY (omija RLS).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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
const url = (process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !key) {
  console.error("Brak VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

const findings = [];
const note = (msg) => findings.push(msg);

// ---------------------------------------------------------------------------
// 1. Administratorzy aplikacji
// ---------------------------------------------------------------------------
console.log("== Administratorzy aplikacji (app_admins) ==");
const admins = await rest("app_admins?select=user_id,created_at&order=created_at.asc");
for (const a of admins) {
  let email = "(nieznany)";
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${a.user_id}`, { headers });
    if (res.ok) email = (await res.json()).email ?? email;
  } catch {
    /* pomijamy */
  }
  console.log(`  ${a.created_at ?? "(brak daty)"}  ${email}  ${a.user_id}`);
}
console.log(`  Razem: ${admins.length}`);
if (admins.length > 1) {
  note(
    `app_admins zawiera ${admins.length} kont — potwierdź ręcznie, że każde jest zamierzone.`,
  );
}

// ---------------------------------------------------------------------------
// 2. Dziennik audytu organizacji
// ---------------------------------------------------------------------------
console.log("\n== Dziennik audytu (org_audit_log) ==");
// Lista wyprowadzona z wywołań public.org_audit(...) w migracjach 0028/0048/0049.
const ZNANE_AKCJE = new Set([
  "org_created",
  "plan_changed",
  "limit_changed",
  "admin_changed",
  "admin_transferred",
  "invites_locked",
  "invite_sent",
  "invite_cancelled",
  "member_joined",
  "member_removed",
  "member_display_name_set",
]);
const audit = await rest("org_audit_log?select=id,org_id,actor_user_id,action,created_at&order=created_at.desc&limit=1000");
const byAction = new Map();
for (const row of audit) byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);
for (const [action, count] of [...byAction].sort((a, b) => b[1] - a[1])) {
  const unknown = !ZNANE_AKCJE.has(action);
  console.log(`  ${String(count).padStart(5)}  ${action}${unknown ? "   <-- NIEZNANA AKCJA" : ""}`);
  if (unknown) note(`org_audit_log zawiera nieznaną akcję "${action}" (${count} wpisów).`);
}
const anonActor = audit.filter((r) => !r.actor_user_id);
if (anonActor.length > 0) {
  console.log(`  Wpisy bez actor_user_id: ${anonActor.length}`);
  note(
    `org_audit_log ma ${anonActor.length} wpisów bez actor_user_id — możliwy ślad wywołania org_audit jako anon.`,
  );
}
console.log(`  Przejrzano: ${audit.length} najnowszych wpisów`);

// ---------------------------------------------------------------------------
// 3. Integralność ścieżek załączników
// ---------------------------------------------------------------------------
console.log("\n== Ścieżki załączników (message_attachments) ==");
const attachments = await rest(
  "message_attachments?select=id,message_id,bucket_path,thumb_path,messages(conversation_id)&limit=5000",
);
/**
 * Załącznik może leżeć w jednym z trzech miejsc, każde z własną konwencją:
 *   Supabase Storage  {conversationId}/{messageId}/{plik}
 *   Cloudflare R2     hot/teams/{orgId}/attachments/{conversationId}/{messageId}/{plik}
 *   SharePoint        sp:{driveItemId}
 * Tylko dwie pierwsze da się zweryfikować względem rozmowy i wiadomości —
 * i tylko one były osiągalne dla _chat_storage_copy/_move.
 */
function classifyPath(path, conversationId, messageId) {
  if (typeof path !== "string" || path === "") return "pusta";
  if (path.startsWith("sp:")) return "sharepoint";
  const suffix = `${conversationId}/${messageId}/`;
  if (path.startsWith(suffix)) return "supabase";
  if (path.startsWith("hot/teams/") && path.includes(`/attachments/${suffix}`)) {
    return "r2";
  }
  return "anomalia";
}

let bad = 0;
let orphanMessage = 0;
const byBackend = new Map();
for (const a of attachments) {
  const conv = a.messages?.conversation_id;
  if (!conv) {
    orphanMessage += 1;
    continue;
  }
  const kind = classifyPath(a.bucket_path, conv, a.message_id);
  byBackend.set(kind, (byBackend.get(kind) ?? 0) + 1);

  const thumbKind =
    a.thumb_path == null ? "brak" : classifyPath(a.thumb_path, conv, a.message_id);

  if (kind === "anomalia" || thumbKind === "anomalia") {
    bad += 1;
    if (bad <= 15) {
      console.log(`  ANOMALIA  ${kind === "anomalia" ? a.bucket_path : a.thumb_path}`);
      console.log(`            rozmowa ${conv}, wiadomość ${a.message_id}`);
    }
  }
}
console.log(`  Sprawdzono: ${attachments.length} załączników`);
for (const [kind, count] of [...byBackend].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(count).padStart(5)}  ${kind}`);
}
console.log(`  Niezgodnych ścieżek: ${bad}`);
if (orphanMessage > 0) console.log(`  Bez powiązanej wiadomości: ${orphanMessage}`);
if (bad > 0) {
  note(
    `${bad} załączników ma ścieżkę niezgodną z {conversation_id}/{message_id}/ — sprawdź, czy to efekt przeniesienia wiadomości, czy nadużycia _chat_storage_move.`,
  );
}
if (orphanMessage > 0) {
  note(`${orphanMessage} załączników bez powiązanej wiadomości (osierocone metadane).`);
}

// ---------------------------------------------------------------------------

console.log("\n== Podsumowanie ==");
if (findings.length === 0) {
  console.log("  Brak sygnałów nadużycia w sprawdzonych obszarach.");
} else {
  for (const f of findings) console.log(`  ! ${f}`);
  console.log(
    "\n  Powyższe to sygnały do ręcznej oceny, nie dowody nadużycia.",
  );
}
console.log(
  "\n  Nie sprawdzono automatycznie: logi PostgREST/API (Supabase Dashboard ->",
);
console.log(
  "  Logs -> API), tam szukaj wywołań /rest/v1/rpc/ensure_app_admin_by_email,",
);
console.log("  /_chat_storage_copy i /_chat_storage_move sprzed wdrożenia 0065.");
