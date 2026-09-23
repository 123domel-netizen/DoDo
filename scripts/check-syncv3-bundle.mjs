#!/usr/bin/env node
/**
 * Scan production Vite bundle for Sync v2 writer symbols / manual sync UX.
 * Requires `dist/` from a prior `vite build`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");

const FORBIDDEN = [
  "pushDirtyItems",
  "reconcileNeverPushed",
  "trackStoreDirty",
  "pushDirtyParticipants",
  "flushPendingPush",
  "registerLocalItemWriteHandler",
  "markItemDirty",
  "enqueueItem",
  "SyncPendingBanner",
  "__dodoSyncInspect",
  "dodo-sync-debug",
  "Wyślij teraz",
];

if (!existsSync(DIST)) {
  console.error("check:syncv3-bundle: dist/ missing — run build first");
  process.exit(1);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

const errors = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, "utf8");
  for (const sym of FORBIDDEN) {
    if (text.includes(sym)) {
      errors.push(`${file.replace(ROOT, ".")}: contains ${JSON.stringify(sym)}`);
    }
  }
}

if (errors.length) {
  console.error("check:syncv3-bundle FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("check:syncv3-bundle OK");
