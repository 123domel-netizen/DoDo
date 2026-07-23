/**
 * Prod smoke: verify Edge R2 bucket name + r2Configured (no secret values).
 * Usage: node scripts/prod-media-pipeline-info.mjs
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
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !service || !anon) {
  console.error("Missing env");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 5 });
const u = users?.users?.[0];
if (!u?.email) {
  console.error("No user to mint JWT");
  process.exit(1);
}

// Prefer a known member of SAND if possible — use service to create ephemeral session via generateLink is heavy.
// Call via service role impersonation: use gallery-api with a real user's password is unavailable.
// Instead: use admin createUser ephemeral.
const email = `smoke-info-${Date.now()}@dodo.invalid`;
const pass = crypto.randomUUID() + "Aa1!";
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password: pass,
  email_confirm: true,
});
if (cErr || !created.user) {
  console.error(cErr?.message);
  process.exit(1);
}
const uid = created.user.id;
await admin.from("org_members").upsert({
  org_id: "dc47be30-6861-4874-b1ab-389e407544ff",
  user_id: uid,
  role: "member",
});

const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: signed, error: sErr } = await client.auth.signInWithPassword({
  email,
  password: pass,
});
if (sErr || !signed.session) {
  console.error(sErr?.message);
  process.exit(1);
}

const res = await fetch(`${url}/functions/v1/gallery-api`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${signed.session.access_token}`,
    apikey: anon,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "media_pipeline_info" }),
});
const body = await res.json();
console.log(
  JSON.stringify(
    {
      http: res.status,
      r2Configured: body.r2Configured,
      r2Bucket: body.r2Bucket,
      graphConfigured: body.graphConfigured,
      galleryFullRetentionDays: body.galleryFullRetentionDays,
      attachmentRetentionDays: body.attachmentRetentionDays,
      attachmentsR2Enabled: body.attachmentsR2Enabled,
    },
    null,
    2,
  ),
);

await admin.from("org_members").delete().eq("user_id", uid);
await admin.auth.admin.deleteUser(uid);

if (body.r2Bucket !== "dodo-media" || !body.r2Configured) {
  process.exit(2);
}
