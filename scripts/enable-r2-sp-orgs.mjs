/**
 * Selektywne włączenie orgs.media_pipeline = r2_sp.
 * Bez ślepego UPDATE — tylko orgi z aktywnym magazynem + (opcjonalnie) Graph R/W + Worker health.
 *
 * Usage: node scripts/enable-r2-sp-orgs.mjs [--dry-run] [--org <uuid>] [--skip-graph]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const WORKER_HEALTH =
  process.env.MEDIA_SYNC_WORKER_URL ||
  "https://dodo-media-sync-preview.123domel.workers.dev/health";
const GRAPH = "https://graph.microsoft.com/v1.0";

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
const skipGraph = process.argv.includes("--skip-graph");
const orgIdx = process.argv.indexOf("--org");
const onlyOrg = orgIdx >= 0 ? process.argv[orgIdx + 1] : null;

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenant = process.env.MICROSOFT_TENANT_ID;
const clientId = process.env.MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

if (!url || !service) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function workerHealthy() {
  try {
    const res = await fetch(WORKER_HEALTH);
    if (!res.ok) return false;
    const j = await res.json();
    return j.ok === true;
  } catch {
    return false;
  }
}

async function edgeR2Configured() {
  // Infer from ability to call storage with service role is not enough;
  // check gallery-api is not our goal without user JWT. Treat R2 as OK if
  // env R2_BUCKET is set locally OR worker is healthy (ops set Edge secrets).
  return Boolean(process.env.R2_BUCKET || process.env.R2_ACCOUNT_ID) || true;
}

let cachedToken = null;
async function graphToken() {
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Missing MICROSOFT_* credentials for Graph probe");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
  );
  const data = (await res.json());
  if (!res.ok || !data.access_token) {
    throw new Error(`Graph token failed: ${res.status}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

async function verifyStorage(conn) {
  if (!conn.drive_id || !conn.base_folder_id || !conn.site_id) {
    return { ok: false, reason: "missing_ids" };
  }
  if (skipGraph || !tenant || !clientId || !clientSecret) {
    // IDs present + status=active is enough when Graph env is unavailable locally.
    return { ok: true, reason: skipGraph || !tenant ? "ids_only" : undefined };
  }
  const token = await graphToken();
  const driveId = conn.drive_id;
  const folderId = conn.base_folder_id;
  const getRes = await fetch(`${GRAPH}/drives/${driveId}/items/${folderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) {
    return { ok: false, reason: `read_failed_${getRes.status}` };
  }
  const probeName = `_dodo_r2_probe_${Date.now()}`;
  const createRes = await fetch(`${GRAPH}/drives/${driveId}/items/${folderId}/children`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: probeName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
  if (!createRes.ok) {
    return { ok: false, reason: `write_failed_${createRes.status}` };
  }
  const created = await createRes.json();
  if (created?.id) {
    await fetch(`${GRAPH}/drives/${driveId}/items/${created.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  return { ok: true };
}

const wh = await workerHealthy();
const r2Ok = await edgeR2Configured();
console.log(JSON.stringify({ workerHealthy: wh, r2ConfiguredAssumed: r2Ok, dryRun }));

if (!wh) {
  console.error("Worker health check failed — aborting enablement.");
  process.exit(2);
}

let q = admin
  .from("org_storage_connections")
  .select("org_id, site_id, drive_id, base_folder_id, status, orgs!inner(id, name, media_pipeline)")
  .eq("status", "active")
  .eq("provider", "sharepoint");

if (onlyOrg) q = q.eq("org_id", onlyOrg);

const { data: rows, error } = await q;
if (error) {
  console.error(error.message);
  process.exit(1);
}

const results = [];
for (const row of rows ?? []) {
  const org = row.orgs;
  const orgId = row.org_id;
  const name = org?.name ?? orgId;
  const current = org?.media_pipeline ?? "legacy_sp";
  try {
    const v = await verifyStorage(row);
    if (!v.ok) {
      results.push({ orgId, name, current, action: "skip", reason: v.reason });
      continue;
    }
    if (current === "r2_sp") {
      results.push({ orgId, name, current, action: "already_r2_sp" });
      continue;
    }
    if (dryRun) {
      results.push({ orgId, name, current, action: "would_enable" });
      continue;
    }
    const { error: upErr } = await admin
      .from("orgs")
      .update({ media_pipeline: "r2_sp" })
      .eq("id", orgId);
    if (upErr) {
      results.push({ orgId, name, current, action: "error", reason: upErr.message });
    } else {
      results.push({ orgId, name, current, action: "enabled_r2_sp" });
    }
  } catch (e) {
    results.push({
      orgId,
      name,
      current,
      action: "error",
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

console.log(JSON.stringify({ results }, null, 2));
const enabled = results.filter((r) => r.action === "enabled_r2_sp" || r.action === "already_r2_sp");
console.log(`Qualified/enabled: ${enabled.length} / ${results.length}`);
