/**
 * One-off SharePoint cleanup for SYNTH_MEDIA1 probe artifacts only.
 * Requires: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET,
 * SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL (or SUPABASE_URL).
 * Deletes ONLY SYNTH_MEDIA1_probe.txt and empty SYNTH_MEDIA1* folders.
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ORG = process.env.SYNTH_ORG_ID || "dc47be30-6861-4874-b1ab-389e407544ff";
const FILE_NAME = "SYNTH_MEDIA1_probe.txt";
const FOLDER_PREFIX = "SYNTH_MEDIA1";
const GRAPH = "https://graph.microsoft.com/v1.0";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), ".env.local"));

function missingEnv(names) {
  return names.filter((n) => !process.env[n]);
}

async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Graph token failed: ${res.status}`);
  return data.access_token;
}

async function graph(token, path, init = {}) {
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = new Error(`Graph: ${data?.error?.message ?? res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listChildren(token, driveId, itemId) {
  const out = [];
  let next = `/drives/${driveId}/items/${itemId}/children?$select=id,name,folder,file,size`;
  while (next) {
    const page = await graph(token, next);
    out.push(...(page?.value ?? []));
    next = page?.["@odata.nextLink"] ?? null;
  }
  return out;
}

async function main() {
  const msMissing = missingEnv([
    "MICROSOFT_TENANT_ID",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
  ]);
  if (msMissing.length) {
    console.log(JSON.stringify({
      ok: false,
      reason: "manual_cleanup_needed",
      missingEnv: msMissing,
      exactFileName: FILE_NAME,
      folderPrefix: FOLDER_PREFIX,
      orgId: ORG,
      steps: [
        `In SharePoint MAGAZYN for org ${ORG}, under Galerie/, find folder starting with ${FOLDER_PREFIX}`,
        `Delete ONLY file named ${FILE_NAME}`,
        "If that folder is then empty, delete the empty folder",
        "Do not delete any other files or folders",
      ],
    }));
    process.exit(2);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.log(JSON.stringify({ ok: false, reason: "missing_supabase_env", exactFileName: FILE_NAME }));
    process.exit(2);
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const storageRes = await fetch(
    `${supabaseUrl}/rest/v1/org_storage_connections?org_id=eq.${ORG}&status=eq.active&select=drive_id,base_folder_id,base_folder_name`,
    { headers },
  );
  const storageRows = await storageRes.json();
  if (!Array.isArray(storageRows) || !storageRows[0]?.drive_id) {
    console.log(JSON.stringify({ ok: false, reason: "no_active_storage", orgId: ORG, exactFileName: FILE_NAME }));
    process.exit(2);
  }
  const { drive_id: driveId, base_folder_id: baseFolderId } = storageRows[0];
  const token = await getGraphToken();
  const deletedFiles = [];
  const deletedFolders = [];
  const skipped = [];

  const search = await graph(
    token,
    `/drives/${driveId}/root/search(q='${FILE_NAME}')?$select=id,name,parentReference,folder,file`,
  );
  for (const hit of (search?.value ?? []).filter((i) => i.name === FILE_NAME && i.file)) {
    await graph(token, `/drives/${driveId}/items/${hit.id}`, { method: "DELETE" });
    deletedFiles.push(hit.name);
  }

  let galerieId = null;
  try {
    const galerie = await graph(token, `/drives/${driveId}/items/${baseFolderId}:/${encodeURIComponent("Galerie")}`);
    galerieId = galerie?.id ?? null;
  } catch { galerieId = null; }

  if (galerieId) {
    const children = await listChildren(token, driveId, galerieId);
    for (const child of children) {
      if (!child.folder || !child.name?.startsWith(FOLDER_PREFIX)) continue;
      const kids = await listChildren(token, driveId, child.id);
      for (const k of kids) {
        if (k.name === FILE_NAME && k.file) {
          await graph(token, `/drives/${driveId}/items/${k.id}`, { method: "DELETE" });
          deletedFiles.push(k.name);
        }
      }
      const kidsAfter = await listChildren(token, driveId, child.id);
      if (kidsAfter.length === 0) {
        await graph(token, `/drives/${driveId}/items/${child.id}`, { method: "DELETE" });
        deletedFolders.push(child.name);
      } else {
        skipped.push({ folder: child.name, reason: "not_empty", childNames: kidsAfter.map((k) => k.name) });
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    orgId: ORG,
    deletedFiles,
    deletedFolders,
    skipped,
    note: deletedFiles.length === 0
      ? "No SYNTH_MEDIA1_probe.txt found (already clean or never created)"
      : "SYNTH probe artifacts removed",
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), exactFileName: FILE_NAME }));
  process.exit(1);
});
