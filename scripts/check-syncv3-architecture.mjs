#!/usr/bin/env node
/**
 * Sync v3 architecture / import-graph guards.
 * Fails if production runtime reintroduces Sync v2 writer APIs.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

const FORBIDDEN_SYMBOLS = [
  "pushDirtyItems",
  "reconcileNeverPushed",
  "trackStoreDirty",
  "pushDirtyParticipants",
  "flushPendingPush",
  "registerLocalItemWriteHandler",
  "markItemDirty",
  "enqueueItem",
  "clearDirtyItems",
  "dirtyItemIds",
  "dirtyItemsCount",
  "getDirtyItemIds",
  "schedulePushRetry",
  "hasPendingPush",
  "SyncPendingBanner",
  "__dodoSyncInspect",
  "dodo-sync-debug",
];

const FORBIDDEN_UI_STRINGS = ["Wyślij teraz"];

/** Production paths allowed to mention legacy storage key names only. */
const LEGACY_ALLOWED = new Set([
  join(SRC, "lib", "syncv3", "legacyReader.ts").replace(/\\/g, "/"),
  join(SRC, "lib", "syncv3", "migrate.ts").replace(/\\/g, "/"),
  join(SRC, "lib", "syncv3", "fixtures", "v2StorageReal.ts").replace(/\\/g, "/"),
]);

const TEST_RE = /\.(test|spec)\.(ts|tsx)$/;
const GUARD_RE = /(guard|matrix30|architecture\.integration|ux\.guard|lifecycle\.e2e)\.test\.(ts|tsx)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function norm(p) {
  return p.replace(/\\/g, "/");
}

const errors = [];
const files = walk(SRC);

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const isTest = TEST_RE.test(file);
  const isGuardTest = GUARD_RE.test(file);
  const src = readFileSync(file, "utf8");
  const nfile = norm(file);

  if (!isTest) {
    for (const sym of FORBIDDEN_SYMBOLS) {
      // Allow identifier only as string in comments documenting removal? No — ban in code.
      const re = new RegExp(`\\b${sym}\\b`);
      if (!re.test(src)) continue;
      // legacyReader may mention dirtyItemIds as read-only field names
      if (
        (sym === "dirtyItemIds" || sym === "enqueueItem" || sym === "markItemDirty") &&
        LEGACY_ALLOWED.has(nfile)
      ) {
        continue;
      }
      // mutationInventory documents removed APIs
      if (rel.includes("mutationInventory.ts")) continue;
      errors.push(`${rel}: forbidden symbol ${sym}`);
    }
    for (const s of FORBIDDEN_UI_STRINGS) {
      if (src.includes(s) && !rel.includes("ux.guard")) {
        errors.push(`${rel}: forbidden UI string "${s}"`);
      }
    }
  }

  // Import graph: production must not import syncOutbox (v2 writer module)
  if (!isTest && !LEGACY_ALLOWED.has(nfile)) {
    if (/from\s+["']@\/lib\/syncOutbox["']/.test(src) || /from\s+["']\.\/syncOutbox["']/.test(src)) {
      errors.push(`${rel}: production import of syncOutbox (v2) forbidden`);
    }
  }

  // Worker must not import legacyReader
  if (rel.endsWith("lib/syncv3/worker.ts") && /legacyReader/.test(src)) {
    errors.push(`${rel}: worker must not import legacyReader`);
  }

  // syncState must not reintroduce dirty API
  if (rel.endsWith("lib/syncState.ts")) {
    for (const sym of [
      "dirtyItemIds",
      "enqueueItem",
      "markItemDirty",
      "clearDirtyItems",
      "getDirtyItemIds",
      "dirtyItemsCount",
      "restoreOutboxForUser",
      "schedulePersistOutbox",
    ]) {
      if (new RegExp(`\\b${sym}\\b`).test(src)) {
        errors.push(`${rel}: syncState must not expose ${sym}`);
      }
    }
  }
}

// Domain ownership doc must not use forbidden placeholder values
const ownership = join(ROOT, "docs", "SYNC-V3-DOMAIN-OWNERSHIP.md");
try {
  const doc = readFileSync(ownership, "utf8").toLowerCase();
  for (const bad of ["unknown", "mixed", "temporary dual path"]) {
    if (doc.includes(bad)) {
      errors.push(`docs/SYNC-V3-DOMAIN-OWNERSHIP.md: forbidden ownership value "${bad}"`);
    }
  }
  if (doc.includes("v2/v3")) {
    errors.push(`docs/SYNC-V3-DOMAIN-OWNERSHIP.md: forbidden ownership value "v2/v3"`);
  }
} catch {
  errors.push("docs/SYNC-V3-DOMAIN-OWNERSHIP.md missing");
}

if (errors.length) {
  console.error("check:syncv3-architecture FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("check:syncv3-architecture OK");
