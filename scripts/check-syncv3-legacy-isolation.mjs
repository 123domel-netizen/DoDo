#!/usr/bin/env node
/**
 * Sync v3 legacy isolation: outbox v2 keys only in legacyReader (+ migrate/fixtures/tests).
 * App Zustand persist key may live in store.ts; sync worker/cloud must not touch outbox keys.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function isTestOrFixture(rel) {
  const n = rel.replace(/\\/g, "/");
  return (
    /\.(test|spec)\.(ts|tsx)$/.test(n) ||
    n.includes("fixtures/") ||
    n.includes("mutationInventory.ts")
  );
}

const OUTBOX_ALLOWED = new Set([
  "src/lib/syncv3/legacyReader.ts",
  "src/lib/syncv3/migrate.ts",
  "src/lib/syncv3/fixtures/v2StorageReal.ts",
  "src/lib/syncOutbox.ts",
]);

const PERSIST_ALLOWED = new Set([
  "src/lib/syncv3/legacyReader.ts",
  "src/lib/syncv3/migrate.ts",
  "src/lib/syncv3/fixtures/v2StorageReal.ts",
  "src/state/store.ts",
]);

const errors = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (isTestOrFixture(rel)) continue;
  const src = readFileSync(file, "utf8");

  if (/dodo-sync-outbox-v1/.test(src) && !OUTBOX_ALLOWED.has(rel)) {
    errors.push(`${rel}: dodo-sync-outbox-v1 outside isolation`);
  }
  if (/kalendarz-todo-v1/.test(src) && !PERSIST_ALLOWED.has(rel)) {
    errors.push(`${rel}: kalendarz-todo-v1 outside store/legacy isolation`);
  }
  if (
    /from\s+["']@\/lib\/syncv3\/legacyReader["']/.test(src) &&
    rel !== "src/lib/syncv3/migrate.ts"
  ) {
    errors.push(`${rel}: only migrate may import legacyReader`);
  }
}

if (errors.length) {
  console.error("check:syncv3-legacy-isolation FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("check:syncv3-legacy-isolation OK");
