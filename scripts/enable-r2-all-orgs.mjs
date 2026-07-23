/**
 * Po tokenie dodo-media-rw: ustaw wszystkie orgs na media_pipeline=r2_sp
 * (jawny legacy_sp zostaje jako rollback — ten skrypt go nadpisuje tylko gdy --force-all).
 *
 * Usage: node scripts/enable-r2-all-orgs.mjs [--dry-run]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();
const dryRun = process.argv.includes("--dry-run");
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: orgs, error } = await admin.from("orgs").select("id, name, media_pipeline");
if (error) {
  console.error(error.message);
  process.exit(1);
}

const results = [];
for (const o of orgs ?? []) {
  if (o.media_pipeline === "r2_sp") {
    results.push({ id: o.id, name: o.name, action: "already_r2_sp" });
    continue;
  }
  if (dryRun) {
    results.push({ id: o.id, name: o.name, action: "would_enable", from: o.media_pipeline });
    continue;
  }
  const { error: upErr } = await admin
    .from("orgs")
    .update({ media_pipeline: "r2_sp" })
    .eq("id", o.id);
  results.push({
    id: o.id,
    name: o.name,
    action: upErr ? "error" : "enabled_r2_sp",
    reason: upErr?.message,
  });
}

console.log(JSON.stringify({ dryRun, results }, null, 2));
console.log(
  `enabled/already: ${results.filter((r) => r.action !== "error" && r.action !== "would_enable").length}/${results.length}`,
);
