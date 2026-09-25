/**
 * Soft-delete empty item rows that share UUIDs with the user's groups.
 * Sync v3 IDB keys entities by UUID only — colliding items clobber groups on pull.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv(resolve(process.cwd(), ".env"));
loadEnv(resolve(process.cwd(), ".env.local"));

const url = process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_USER = "5911fa39-8864-4f6d-9930-4f9ec02c43cf";
const dryRun = process.argv.includes("--dry-run");
const targetUser =
  process.argv.slice(2).find((a) => a !== "--dry-run" && /^[0-9a-f-]{36}$/i.test(a)) ||
  TARGET_USER;

const sb = createClient(url, service, { auth: { persistSession: false } });

const { data: groups, error: gErr } = await sb
  .from("groups")
  .select("id,name")
  .eq("user_id", targetUser);
if (gErr) throw new Error(gErr.message);

const gids = (groups ?? []).map((g) => g.id);
const { data: items, error: iErr } = await sb
  .from("items")
  .select("id,title,type,deleted_at,user_id")
  .eq("user_id", targetUser)
  .in("id", gids);
if (iErr) throw new Error(iErr.message);

const phantoms = (items ?? []).filter(
  (it) => !it.deleted_at && (it.title == null || String(it.title).trim() === ""),
);

console.log(
  JSON.stringify(
    {
      user: targetUser,
      groups: groups?.map((g) => g.name),
      phantoms,
      dryRun,
    },
    null,
    2,
  ),
);

if (!phantoms.length) {
  console.log("No phantoms to soft-delete.");
  process.exit(0);
}

if (dryRun) {
  console.log("Dry run — no writes.");
  process.exit(0);
}

const now = new Date().toISOString();
const { data: updated, error: uErr } = await sb
  .from("items")
  .update({ deleted_at: now, updated_at: now })
  .in(
    "id",
    phantoms.map((p) => p.id),
  )
  .eq("user_id", targetUser)
  .select("id");

if (uErr) throw new Error(uErr.message);
console.log("Soft-deleted", updated?.length ?? 0, "phantom items.");
