#!/usr/bin/env node
/**
 * Statyczne kontrole repozytorium uruchamiane w CI (CI-01).
 *
 * Celem nie jest zastąpienie testów na żywej bazie, tylko zatrzymanie klas
 * błędów, które już raz wystąpiły w tym projekcie:
 *   1. funkcja SECURITY DEFINER bez REVOKE → domyślne EXECUTE dla PUBLIC
 *      (patrz migracja 0065: _chat_storage_* i ensure_app_admin_by_email),
 *   2. sekret lub ref projektu wpisany na sztywno w migracji (0002/0017),
 *   3. nowa tabela bez włączonego RLS,
 *   4. plik .env z wartościami w repozytorium.
 *
 * Historia migracji jest zamrożona — kontrole 1 i 2 obowiązują dopiero od
 * numeru FIRST_ENFORCED_MIGRATION. Stare pliki są raportowane jako dług, ale
 * nie blokują CI.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/** Migracje wdrożone przed wprowadzeniem tych reguł. */
const FIRST_ENFORCED_MIGRATION = 65;

const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

/** Usuwa komentarze SQL, żeby nie łapać reguł z opisów w nagłówkach plików. */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      return {
        file,
        number: Number.parseInt(file.slice(0, 4), 10),
        raw,
        sql: stripSqlComments(raw),
      };
    });
}

// ---------------------------------------------------------------------------
// 1. Funkcje SECURITY DEFINER muszą mieć jawny REVOKE w tej samej migracji
// ---------------------------------------------------------------------------
function checkSecurityDefinerRevokes(migrations) {
  // Dopasowuje ciało od "create ... function public.nazwa(" do końcowego "$$;"
  const fnRe =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)([\s\S]*?)\$\$\s*;/gi;

  for (const m of migrations) {
    const enforced = m.number >= FIRST_ENFORCED_MIGRATION;
    for (const match of m.sql.matchAll(fnRe)) {
      const [, name, , body] = match;
      if (!/security\s+definer/i.test(body)) continue;
      if (/returns\s+trigger/i.test(body)) continue;

      const revoked = new RegExp(
        `revoke\\s+(?:all|execute)[\\s\\S]*?on\\s+function\\s+(?:public\\.)?${name}\\s*\\(`,
        "i",
      ).test(m.sql);
      // Migracje utwardzające operują na katalogu (pg_proc) zamiast na listach
      // sygnatur — wykrywamy je po wywołaniu revoke w bloku DO.
      const catalogDriven = /pg_proc[\s\S]*?revoke/i.test(m.sql);
      if (revoked || catalogDriven) continue;

      const msg = `${m.file}: funkcja SECURITY DEFINER "${name}" bez REVOKE — domyślnie wywoływalna przez PUBLIC/anon`;
      if (enforced) fail(msg);
      else warn(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Brak placeholderów / sekretów w aktywnym SQL
// ---------------------------------------------------------------------------
function checkPlaceholders(migrations) {
  const placeholderRe = /<[A-Z][A-Z0-9_]{2,}>/g;
  for (const m of migrations) {
    const found = [...new Set(m.sql.match(placeholderRe) ?? [])];
    if (found.length === 0) continue;
    const msg = `${m.file}: aktywny placeholder w SQL (${found.join(", ")}) — konfiguracja musi pochodzić z Vault/skryptu bootstrap`;
    if (m.number >= FIRST_ENFORCED_MIGRATION) fail(msg);
    else warn(msg);
  }
}

// ---------------------------------------------------------------------------
// 3. Każda tabela w schemacie public ma włączony RLS
// ---------------------------------------------------------------------------
function checkRowLevelSecurity(migrations) {
  const created = new Map();
  const rlsEnabled = new Set();
  const dropped = new Set();

  for (const m of migrations) {
    for (const match of m.sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi,
    )) {
      if (!created.has(match[1])) created.set(match[1], m.file);
    }
    for (const match of m.sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi,
    )) {
      rlsEnabled.add(match[1]);
    }
    for (const match of m.sql.matchAll(
      /drop\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)/gi,
    )) {
      dropped.add(match[1]);
    }
  }

  for (const [table, file] of created) {
    if (dropped.has(table) || rlsEnabled.has(table)) continue;
    fail(`${file}: tabela public.${table} nie ma "enable row level security"`);
  }
}

// ---------------------------------------------------------------------------
// 4. Brak plików .env z wartościami
// ---------------------------------------------------------------------------
function checkEnvFiles() {
  // Liczą się wyłącznie pliki ŚLEDZONE przez git — lokalne .env są w .gitignore
  // i mają pełne prawo istnieć na dysku dewelopera.
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  } catch {
    warn("Nie udało się uruchomić `git ls-files` — pominięto kontrolę plików .env.");
    return;
  }

  for (const rel of tracked) {
    const base = rel.split("/").pop() ?? rel;
    if (!/^\.env($|\.)/.test(base)) continue;
    if (base.endsWith(".example") || base.endsWith(".sample")) continue;

    const full = join(ROOT, rel);
    if (!existsSync(full)) continue;

    for (const line of readFileSync(full, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      const [, name, rawValue] = m;
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (isLikelySecret(name, value)) {
        fail(
          `${rel}: śledzony plik zawiera sekret "${name}" — usuń z repozytorium i zrotuj wartość`,
        );
      }
    }
  }
}

/**
 * Pliki `.env.<mode>` z flagami builda (np. VITE_PROJECTS_PREVIEW=1) należą do
 * repozytorium — Vite ich potrzebuje. Blokujemy tylko realne poświadczenia.
 */
function isLikelySecret(name, value) {
  if (!value || value.length < 8) return false;
  const sensitiveName = /(SECRET|PASSWORD|PRIVATE|CREDENTIAL|SERVICE_ROLE|_TOKEN|_KEY)$/.test(name);
  const looksLikeJwt = /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(value);
  const looksHighEntropy = value.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(value);
  return looksLikeJwt || (sensitiveName && looksHighEntropy);
}

// ---------------------------------------------------------------------------

const migrations = listMigrations();
checkSecurityDefinerRevokes(migrations);
checkPlaceholders(migrations);
checkRowLevelSecurity(migrations);
checkEnvFiles();

if (warnings.length > 0) {
  const showAll = process.argv.includes("--verbose") || process.env.GUARDS_VERBOSE === "1";
  const shown = showAll ? warnings : warnings.slice(0, 5);
  console.log(
    `\nDług historyczny (${warnings.length}) — nie blokuje CI, migracje 0001-${String(
      FIRST_ENFORCED_MIGRATION - 1,
    ).padStart(4, "0")} są zamrożone:`,
  );
  for (const w of shown) console.log(`  - ${w}`);
  if (!showAll && warnings.length > shown.length) {
    console.log(
      `  … i ${warnings.length - shown.length} więcej (pełna lista: --verbose).`,
    );
    console.log(
      "  Ekspozycja EXECUTE jest zamykana zbiorczo migracją 0066_function_execute_hardening.sql.",
    );
  }
}

if (errors.length > 0) {
  console.error(`\nKontrole repozytorium NIE przeszły (${errors.length}):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log(
  `\nKontrole repozytorium OK (${migrations.length} migracji sprawdzonych).`,
);
