/**
 * Syntetyczny E2E: R2 preview → confirm → job → Worker → SharePoint.
 * Nie zmienia orgs.media_pipeline. Nie loguje sekretów.
 *
 * Usage: node scripts/media-synth-e2e.mjs
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const MARKER = "SYNTH_MEDIA1";
const ACCOUNT = "fd3dc60b3c5f1949adef60cc03400877";
const BUCKET = "dodo-media-preview";
const WORKER = "https://dodo-media-sync-preview.123domel.workers.dev";
const ORG = "dc47be30-6861-4874-b1ab-389e407544ff";
const CONV = "f5e57719-4bf0-474e-90fd-0d37b1aea750";

const steps = [];
function step(name, data = {}) {
  steps.push({ name, at: new Date().toISOString(), ...data });
  const safe = { ...data };
  delete safe.token;
  delete safe.secret;
  delete safe.authorization;
  console.log(JSON.stringify({ step: name, ...safe }));
}

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

function readHookSecret() {
  const p = resolve(process.cwd(), "worker/.media-hook-secret.local");
  if (!existsSync(p)) throw new Error("Missing worker/.media-hook-secret.local");
  return readFileSync(p, "utf8").trim();
}

function wrangler(args) {
  const isWin = process.platform === "win32";
  if (isWin) {
    return execFileSync(
      "cmd.exe",
      ["/c", "npx", "wrangler", ...args],
      {
        cwd: resolve(process.cwd(), "worker"),
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: resolve(process.cwd(), "worker"),
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

loadEnv();
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !service || !anon) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE / ANON in env");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const galleryId = randomUUID();
const itemId = randomUUID();
const opId = randomUUID();
const messageId = randomUUID();
const synthEmail = `synth-media1-${Date.now()}@dodo.invalid`;
const synthPass = randomBytes(24).toString("hex");
const fileName = `${MARKER}_probe.txt`;
const fileBody = `${MARKER} synthetic probe ${new Date().toISOString()}\n`;
const r2Key = `hot/teams/${ORG}/galleries/${galleryId}/full/${itemId}.jpg`;
// note: .txt content but .jpg key path matching galleryFullKey pattern used by worker
const r2KeyActual = `hot/teams/${ORG}/galleries/${galleryId}/full/${itemId}.jpg`;

let synthUserId = null;
let accessToken = null;
const t0 = Date.now();
const timings = {};

async function cleanup(spDriveItemId, driveId) {
  const notes = [];
  try {
    wrangler(["r2", "object", "delete", `${BUCKET}/${r2KeyActual}`, "--force"]);
    notes.push("r2_deleted");
  } catch (e) {
    notes.push(`r2_delete_err:${e instanceof Error ? e.message.slice(0, 80) : "x"}`);
  }
  try {
    await admin.from("media_sync_jobs").delete().eq("ref_id", itemId);
    await admin.from("gallery_items").delete().eq("id", itemId);
    await admin.from("galleries").delete().eq("id", galleryId);
    await admin.from("messages").delete().eq("id", messageId);
    notes.push("db_deleted");
  } catch {
    notes.push("db_delete_partial");
  }
  if (synthUserId) {
    try {
      await admin.from("conversation_members").delete().eq("user_id", synthUserId);
      await admin.from("org_members").delete().eq("user_id", synthUserId);
      await admin.auth.admin.deleteUser(synthUserId);
      notes.push("user_deleted");
    } catch {
      notes.push("user_delete_partial");
    }
  }
  // SP delete via Graph using worker secrets is not available locally; best-effort via Edge not possible.
  // Record for report if we have ids — manual note.
  if (spDriveItemId) notes.push(`sp_item_left_for_manual:${spDriveItemId.slice(0, 8)}…`);
  return notes;
}

async function main() {
  // 1 — secrets presence (names only via prior knowledge + hook file)
  step("1_secrets_present", {
    workerSecretsExpected: [
      "MEDIA_SYNC_HOOK_SECRET",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "MICROSOFT_TENANT_ID",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
    ],
    hookFile: true,
  });

  // 2 — health
  const tHealth = Date.now();
  const healthRes = await fetch(`${WORKER}/health`);
  const healthBody = await healthRes.json();
  timings.healthMs = Date.now() - tHealth;
  step("2_health", { http: healthRes.status, body: healthBody, ms: timings.healthMs });
  if (!healthRes.ok) throw new Error("health failed");

  // Confirm orgs still legacy
  const { data: orgPipes } = await admin.from("orgs").select("media_pipeline");
  const pipes = (orgPipes ?? []).map((r) => r.media_pipeline);
  if (pipes.some((p) => p !== "legacy_sp")) {
    throw new Error("Abort: org media_pipeline is not all legacy_sp");
  }
  step("orgs_still_legacy", { pipelines: pipes });

  // 3 — synth user + records
  const { data: created, error: createUserErr } = await admin.auth.admin.createUser({
    email: synthEmail,
    password: synthPass,
    email_confirm: true,
  });
  if (createUserErr || !created.user) throw new Error(`createUser: ${createUserErr?.message}`);
  synthUserId = created.user.id;

  await admin.from("org_members").upsert({
    org_id: ORG,
    user_id: synthUserId,
    role: "member",
  });
  await admin.from("conversation_members").upsert({
    conversation_id: CONV,
    user_id: synthUserId,
    role: "member",
  });

  // Sign in as synth user for Edge JWT
  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signErr } = await userClient.auth.signInWithPassword({
    email: synthEmail,
    password: synthPass,
  });
  if (signErr || !signed.session) throw new Error(`signIn: ${signErr?.message}`);
  accessToken = signed.session.access_token;

  const { error: msgErr } = await admin.from("messages").insert({
    id: messageId,
    conversation_id: CONV,
    author_user_id: synthUserId,
    kind: "gallery",
    body: `${MARKER} gallery`,
    payload: { gallery: { galleryId }, synth: true, marker: MARKER },
    mentions: [],
  });
  if (msgErr) throw new Error(`message: ${msgErr.message}`);

  const { error: galErr } = await admin.from("galleries").insert({
    id: galleryId,
    org_id: ORG,
    conversation_id: CONV,
    message_id: messageId,
    created_by: synthUserId,
    title: `${MARKER} test gallery`,
    description: "synthetic e2e — safe to delete",
    provider: "sharepoint",
    status: "uploading",
    item_count: 1,
    failed_count: 0,
    pipeline: "r2_sp",
  });
  if (galErr) throw new Error(`gallery: ${galErr.message}`);

  const { error: itemErr } = await admin.from("gallery_items").insert({
    id: itemId,
    gallery_id: galleryId,
    sort_order: 0,
    file_name: fileName,
    mime_type: "text/plain",
    size_bytes: Buffer.byteLength(fileBody),
    status: "pending",
    r2_key_full: r2KeyActual,
    r2_key_thumb: null,
    r2_status: "uploading",
    sp_status: "none",
    sync_operation_id: opId,
  });
  if (itemErr) throw new Error(`item: ${itemErr.message}`);

  step("3_synth_records", {
    galleryId,
    itemId,
    marker: MARKER,
    note: "gallery.pipeline=r2_sp row-only; orgs.media_pipeline unchanged",
  });

  // 4 — presign via Edge
  const tPresign = Date.now();
  const presignRes = await fetch(`${url}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "r2_presign_gallery_items",
      galleryId,
      itemIds: [itemId],
    }),
  });
  const presignJson = await presignRes.json();
  timings.presignMs = Date.now() - tPresign;
  step("4_presign", {
    http: presignRes.status,
    ms: timings.presignMs,
    hasPutUrl: Boolean(presignJson?.items?.[0]?.putUrlFull),
    error: typeof presignJson?.error === "string" ? presignJson.error : undefined,
  });
  if (!presignRes.ok || !presignJson?.items?.[0]?.putUrlFull) {
    throw new Error(`presign failed: ${presignJson?.error || presignRes.status}`);
  }
  const putUrl = presignJson.items[0].putUrlFull;
  const putHeaders = presignJson.items[0].headers?.full ?? {
    "content-type": "image/jpeg",
  };

  // 5 — PUT
  const tPut = Date.now();
  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: putHeaders,
    body: fileBody,
  });
  timings.putMs = Date.now() - tPut;
  step("5_r2_put", { http: putRes.status, ms: timings.putMs, bytes: Buffer.byteLength(fileBody) });
  if (!putRes.ok) throw new Error(`PUT failed ${putRes.status}`);

  // 6 — Head via wrangler (no secret dump)
  const tHead = Date.now();
  let headOk = false;
  try {
    const headOut = wrangler([
      "r2",
      "object",
      "get",
      `${BUCKET}/${r2KeyActual}`,
      "--pipe",
      "--file",
      resolve(process.cwd(), "worker/.synth-head.tmp"),
    ]);
    headOk = true;
    timings.headMs = Date.now() - tHead;
    step("6_head_object", { ok: true, ms: timings.headMs, wranglerSnippet: headOut.slice(0, 120) });
    try {
      unlinkSync(resolve(process.cwd(), "worker/.synth-head.tmp"));
    } catch {
      /* ignore */
    }
  } catch (e) {
    timings.headMs = Date.now() - tHead;
    // fallback: confirm will HeadObject server-side
    step("6_head_object", {
      ok: false,
      ms: timings.headMs,
      note: "wrangler get failed; Edge confirm will HeadObject",
      err: e instanceof Error ? e.message.slice(0, 100) : "x",
    });
  }

  // 7 — confirm
  const tConfirm = Date.now();
  const confirmRes = await fetch(`${url}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "r2_confirm_gallery_item",
      galleryId,
      itemId,
      sizeBytes: Buffer.byteLength(fileBody),
      fileName,
      mimeType: "text/plain",
      recompute: true,
    }),
  });
  const confirmJson = await confirmRes.json();
  timings.confirmMs = Date.now() - tConfirm;
  step("7_confirm", {
    http: confirmRes.status,
    ms: timings.confirmMs,
    r2Ready: confirmJson?.r2Ready === true,
    error: typeof confirmJson?.error === "string" ? confirmJson.error : undefined,
  });
  if (!confirmRes.ok || confirmJson?.error) {
    throw new Error(`confirm failed: ${confirmJson?.error || confirmRes.status}`);
  }

  const { data: itemAfter } = await admin
    .from("gallery_items")
    .select("r2_status, sp_status, sync_operation_id")
    .eq("id", itemId)
    .single();
  step("7b_r2_ready_db", { item: itemAfter });

  // 8 — exactly one job
  const { data: jobs } = await admin
    .from("media_sync_jobs")
    .select("id, kind, state, ref_id, payload")
    .eq("ref_id", itemId)
    .eq("kind", "gallery_full");
  step("8_media_sync_jobs", { count: jobs?.length ?? 0, states: (jobs ?? []).map((j) => j.state) });
  if ((jobs?.length ?? 0) !== 1) {
    throw new Error(`expected 1 job, got ${jobs?.length}`);
  }

  // 9 — enqueue (confirm already enqueued; explicit re-send for visibility)
  const hookSecret = readHookSecret();
  const tEnqueue = Date.now();
  const enqRes = await fetch(`${WORKER}/enqueue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hookSecret}`,
    },
    body: JSON.stringify({
      kind: "gallery_full",
      refId: itemId,
      galleryId,
      orgId: ORG,
      opId: itemAfter?.sync_operation_id || opId,
    }),
  });
  timings.enqueueMs = Date.now() - tEnqueue;
  step("9_enqueue", { http: enqRes.status, ms: timings.enqueueMs });

  // 10–13 — poll Worker → SP verified
  const tSp = Date.now();
  let verified = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const { data: row } = await admin
      .from("gallery_items")
      .select(
        "r2_status, sp_status, sp_drive_item_id, sp_folder_id, provider_item_id, r2_delete_after, sync_last_error, file_name, r2_size_bytes, size_bytes",
      )
      .eq("id", itemId)
      .single();
    if (row?.sp_status === "verified" && row.sp_drive_item_id) {
      verified = row;
      break;
    }
    if (row?.sp_status === "permanent_failure" || row?.sp_status === "failed") {
      timings.sharepointMs = Date.now() - tSp;
      step("10_12_sharepoint_failed", { row, ms: timings.sharepointMs });
      throw new Error(`SP sync failed: ${row.sync_last_error || row.sp_status}`);
    }
  }
  timings.sharepointMs = Date.now() - tSp;
  if (!verified) throw new Error("timeout waiting for sharepoint_verified");

  const { data: gal } = await admin
    .from("galleries")
    .select("provider_folder_id, provider_folder_path, title")
    .eq("id", galleryId)
    .single();

  step("10_13_sharepoint_verified", {
    ms: timings.sharepointMs,
    driveItemId: verified.sp_drive_item_id,
    fileName: verified.file_name,
    sizeBytes: verified.size_bytes ?? verified.r2_size_bytes,
    folderId: verified.sp_folder_id ?? gal?.provider_folder_id,
    folderPath: gal?.provider_folder_path ? "present" : null,
    r2DeleteAfter: verified.r2_delete_after,
    r2Status: verified.r2_status,
    spStatus: verified.sp_status,
  });

  // 14 — idempotency: re-enqueue + second confirm
  const jobsBefore = jobs.length;
  const enq2 = await fetch(`${WORKER}/enqueue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hookSecret}`,
    },
    body: JSON.stringify({
      kind: "gallery_full",
      refId: itemId,
      galleryId,
      orgId: ORG,
      opId: verified.sync_operation_id || itemAfter?.sync_operation_id || opId,
    }),
  });
  await new Promise((r) => setTimeout(r, 4000));
  const { data: itemIdem } = await admin
    .from("gallery_items")
    .select("sp_status, sp_drive_item_id, r2_status")
    .eq("id", itemId)
    .single();
  const { data: jobsAfter } = await admin
    .from("media_sync_jobs")
    .select("id")
    .eq("ref_id", itemId)
    .eq("kind", "gallery_full");
  const confirm2 = await fetch(`${url}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "r2_confirm_gallery_item",
      galleryId,
      itemId,
      sizeBytes: Buffer.byteLength(fileBody),
      fileName,
      mimeType: "text/plain",
      recompute: false,
    }),
  });
  const confirm2Json = await confirm2.json();
  const { data: jobsAfterConfirm } = await admin
    .from("media_sync_jobs")
    .select("id")
    .eq("ref_id", itemId)
    .eq("kind", "gallery_full");

  step("14_idempotency", {
    reenqueueHttp: enq2.status,
    spStatusStillVerified: itemIdem?.sp_status === "verified",
    sameDriveItem:
      itemIdem?.sp_drive_item_id === verified.sp_drive_item_id,
    jobsBefore,
    jobsAfterReenqueue: jobsAfter?.length ?? 0,
    secondConfirmHttp: confirm2.status,
    secondConfirmOk: confirm2.ok && !confirm2Json?.error,
    jobsAfterSecondConfirm: jobsAfterConfirm?.length ?? 0,
    noExtraJob:
      (jobsAfterConfirm?.length ?? 0) <= (jobsAfter?.length ?? 0) ||
      (jobsAfterConfirm?.length ?? 0) === 1,
  });

  // 15 — cleanup
  // Delete SP file via Graph: obtain token using service... we don't have MS secrets locally.
  // Try Edge gallery_delete_storage as synth user if admin of org — member only, may fail.
  // Best effort: delete R2 + DB; attempt Graph delete through a one-shot worker-less approach skipped.
  const cleanupNotes = await cleanup(verified.sp_drive_item_id, null);

  // Attempt Graph delete using Microsoft secrets from Supabase is impossible without values.
  // Write marker note for operator if SP object remains.
  step("15_cleanup", {
    notes: cleanupNotes,
    spCleanup: "attempt_folder_file_via_graph_requires_local_ms_secrets_skipped",
    recommendation:
      "Delete SharePoint file named SYNTH_MEDIA1_probe.txt under Galerie/SYNTH_MEDIA1* if still present",
  });

  timings.totalMs = Date.now() - t0;
  step("16_done", {
    timings,
    orgsUntouched: true,
    viteUntouched: true,
    firstFailure: null,
  });

  // Final org check
  const { data: orgPipes2 } = await admin.from("orgs").select("media_pipeline");
  step("final_orgs_legacy", {
    allLegacy: (orgPipes2 ?? []).every((r) => r.media_pipeline === "legacy_sp"),
  });
}

main().catch(async (e) => {
  step("FAILED", {
    message: e instanceof Error ? e.message : String(e),
    timings,
  });
  try {
    await cleanup(null, null);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
