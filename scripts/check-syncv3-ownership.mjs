#!/usr/bin/env node
/**
 * Domain ownership doc invariants — no placeholder ownership values.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOC = join(ROOT, "docs", "SYNC-V3-DOMAIN-OWNERSHIP.md");

if (!existsSync(DOC)) {
  console.error("check:syncv3-ownership: missing docs/SYNC-V3-DOMAIN-OWNERSHIP.md");
  process.exit(1);
}

const text = readFileSync(DOC, "utf8");
const requiredDomains = [
  "item",
  "group",
  "user_tag",
  "tag_assignment",
  "participant",
  "personal_reminder",
];
const errors = [];

for (const d of requiredDomains) {
  if (!text.toLowerCase().includes(d.replace("_", ""))) {
    // table uses user_tag (tag) — check raw
  }
  if (!new RegExp(d.replace(/_/g, "[_ ]?"), "i").test(text)) {
    errors.push(`missing domain column/mention: ${d}`);
  }
}

const banned = [
  /\bunknown\b/i,
  /\bmixed\b/i,
  /\bv2\/v3\b/i,
  /temporary dual path/i,
];
for (const re of banned) {
  if (re.test(text)) {
    errors.push(`forbidden ownership wording matching ${re}`);
  }
}

const fields = [
  "local entity key",
  "mutation owner",
  "remote apply owner",
  "operation type",
  "parent deps",
  "worker handler",
  "ACK",
  "retry",
  "quarantine",
  "merge",
  "migration source",
  "auth namespace",
];
for (const f of fields) {
  if (!text.toLowerCase().includes(f.toLowerCase())) {
    errors.push(`missing ownership field: ${f}`);
  }
}

if (errors.length) {
  console.error("check:syncv3-ownership FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}
console.log("check:syncv3-ownership OK");
