/**
 * Prod smoke: 1 gallery item + 1 attachment on dodo-media / dodo-media-sync.
 * Does NOT print secrets. Cleans up synth rows afterward.
 *
 * Usage: node scripts/prod-media-smoke.mjs
 */
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const MARKER = "PROD_SMOKE";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "fd3dc60b3c5f1949adef60cc03400877";
const BUCKET = "dodo-media";
const WORKER =
  process.env.MEDIA_SYNC_WORKER_URL?.replace(/\/$/, "") ||
  "https://dodo-media-sync.123domel.workers.dev";
const ORG = "dc47be30-6861-4874-b1ab-389e407544ff"; // SAND
const CONV = "f5e57719-4bf0-474e-90fd-0d37b1aea750";

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

function step(name, data = {}) {
  const safe = { ...data };
  delete safe.token;
  delete safe.secret;
  delete safe.authorization;
  console.log(JSON.stringify({ step: name, ...safe }));
}

function wrangler(args) {
  return execFileSync("cmd.exe", ["/c", "npx", "wrangler", ...args], {
    cwd: resolve(process.cwd(), "worker"),
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readHookSecret() {
  const p = resolve(process.cwd(), "worker/.media-hook-secret.local");
  if (!existsSync(p)) throw new Error("Missing worker/.media-hook-secret.local");
  return readFileSync(p, "utf8").trim();
}

loadEnv();
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !service || !anon) {
  console.error("Missing SUPABASE env");
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const galleryId = randomUUID();
const itemId = randomUUID();
const opId = randomUUID();
const messageId = randomUUID();
const attMessageId = randomUUID();
const attId = randomUUID();
const synthEmail = `prod-smoke-${Date.now()}@dodo.invalid`;
const synthPass = randomBytes(24).toString("hex");
const fileBody = Buffer.from(`${MARKER} gallery ${new Date().toISOString()}\n`);
const attBody = Buffer.from(`${MARKER} attachment pdf-like ${new Date().toISOString()}\n`);
const r2KeyFull = `hot/teams/${ORG}/galleries/${galleryId}/full/${itemId}.jpg`;
const r2KeyThumb = `hot/teams/${ORG}/galleries/${galleryId}/thumb/${itemId}.webp`;
const r2KeyAtt = `hot/teams/${ORG}/attachments/${CONV}/${attMessageId}/${attId}`;

let synthUserId = null;
let accessToken = null;
const report = { gallery: {}, attachment: {}, retention: {} };

async function cleanup() {
  const notes = [];
  for (const key of [r2KeyFull, r2KeyThumb, r2KeyAtt]) {
    try {
      wrangler(["r2", "object", "delete", `${BUCKET}/${key}`, "--force"]);
      notes.push(`del:${key.split("/").slice(-2).join("/")}`);
    } catch {
      notes.push(`del_fail:${key.split("/").pop()}`);
    }
  }
  try {
    await admin.from("media_sync_jobs").delete().eq("ref_id", itemId);
    await admin.from("media_sync_jobs").delete().eq("ref_id", attId);
    await admin.from("gallery_items").delete().eq("id", itemId);
    await admin.from("galleries").delete().eq("id", galleryId);
    await admin.from("message_attachments").delete().eq("id", attId);
    await admin.from("messages").delete().in("id", [messageId, attMessageId]);
    notes.push("db_ok");
  } catch {
    notes.push("db_partial");
  }
  if (synthUserId) {
    try {
      await admin.from("conversation_members").delete().eq("user_id", synthUserId);
      await admin.from("org_members").delete().eq("user_id", synthUserId);
      await admin.auth.admin.deleteUser(synthUserId);
      notes.push("user_ok");
    } catch {
      notes.push("user_partial");
    }
  }
  return notes;
}

async function edge(action, body) {
  const res = await fetch(`${url}/functions/v1/gallery-api`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json();
  return { res, json };
}

async function waitSp(table, id, kindLabel) {
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data: row } = await admin
      .from(table)
      .select(
        table === "gallery_items"
          ? "r2_status, sp_status, sp_drive_item_id, r2_delete_after, sync_last_error, r2_key_full, r2_key_thumb, retention_hold"
          : "r2_status, sp_status, sp_drive_item_id, r2_delete_after, sync_last_error, r2_key, retention_hold",
      )
      .eq("id", id)
      .single();
    const { data: jobs } = await admin
      .from("media_sync_jobs")
      .select("state, finished_at")
      .eq("ref_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (row?.sp_status === "verified" && row.sp_drive_item_id) {
      return { row, job: jobs?.[0], ok: true };
    }
    if (row?.sp_status === "permanent_failure" || row?.sp_status === "failed") {
      return { row, job: jobs?.[0], ok: false, kindLabel };
    }
  }
  return { ok: false, timeout: true, kindLabel };
}

async function main() {
  step("0_config", { bucket: BUCKET, worker: WORKER, org: ORG });

  const health = await fetch(`${WORKER}/health`);
  step("health", { http: health.status, body: await health.json() });
  if (!health.ok) throw new Error("worker health failed");

  const { data: created, error: createUserErr } = await admin.auth.admin.createUser({
    email: synthEmail,
    password: synthPass,
    email_confirm: true,
  });
  if (createUserErr || !created.user) throw new Error(createUserErr?.message);
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

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signErr } = await userClient.auth.signInWithPassword({
    email: synthEmail,
    password: synthPass,
  });
  if (signErr || !signed.session) throw new Error(signErr?.message);
  accessToken = signed.session.access_token;

  // --- GALLERY ---
  await admin.from("messages").insert({
    id: messageId,
    conversation_id: CONV,
    author_user_id: synthUserId,
    kind: "gallery",
    body: `${MARKER} gallery`,
    payload: { gallery: { galleryId }, marker: MARKER },
    mentions: [],
  });
  await admin.from("galleries").insert({
    id: galleryId,
    org_id: ORG,
    conversation_id: CONV,
    message_id: messageId,
    created_by: synthUserId,
    title: `${MARKER} gallery`,
    description: "prod smoke — delete ok",
    provider: "sharepoint",
    status: "uploading",
    item_count: 1,
    failed_count: 0,
    pipeline: "r2_sp",
  });
  await admin.from("gallery_items").insert({
    id: itemId,
    gallery_id: galleryId,
    sort_order: 0,
    file_name: `${MARKER}.jpg`,
    mime_type: "image/jpeg",
    size_bytes: fileBody.length,
    status: "pending",
    r2_key_full: r2KeyFull,
    r2_key_thumb: r2KeyThumb,
    r2_status: "uploading",
    sp_status: "none",
    sync_operation_id: opId,
  });

  const { res: pRes, json: pJson } = await edge("r2_presign_gallery_items", {
    galleryId,
    itemIds: [itemId],
  });
  step("gallery_presign", {
    http: pRes.status,
    hasFull: Boolean(pJson?.items?.[0]?.putUrlFull),
    hasThumb: Boolean(pJson?.items?.[0]?.putUrlThumb),
    err: pJson?.error,
  });
  if (!pJson?.items?.[0]?.putUrlFull) throw new Error("gallery presign failed");

  const putFull = await fetch(pJson.items[0].putUrlFull, {
    method: "PUT",
    headers: pJson.items[0].headers?.full ?? { "content-type": "image/jpeg" },
    body: fileBody,
  });
  const thumbBytes = Buffer.from("RIFF....WEBP"); // tiny placeholder; Edge may accept
  // Prefer same body for thumb if thumb URL present
  let putThumb = { ok: true, status: 0 };
  if (pJson.items[0].putUrlThumb) {
    putThumb = await fetch(pJson.items[0].putUrlThumb, {
      method: "PUT",
      headers: pJson.items[0].headers?.thumb ?? { "content-type": "image/webp" },
      body: fileBody,
    });
  }
  step("gallery_put", { full: putFull.status, thumb: putThumb.status });
  if (!putFull.ok) throw new Error(`gallery PUT ${putFull.status}`);

  const { res: cRes, json: cJson } = await edge("r2_confirm_gallery_item", {
    galleryId,
    itemId,
    sizeBytes: fileBody.length,
    fileName: `${MARKER}.jpg`,
    mimeType: "image/jpeg",
    recompute: true,
  });
  step("gallery_confirm", {
    http: cRes.status,
    r2Ready: cJson?.r2Ready === true,
    err: cJson?.error,
  });
  if (!cRes.ok || cJson?.error) throw new Error(`confirm: ${cJson?.error}`);

  const { data: itemAfter } = await admin
    .from("gallery_items")
    .select("r2_status, r2_key_full, r2_key_thumb, sp_status, r2_delete_after")
    .eq("id", itemId)
    .single();
  report.gallery.r2_ready = itemAfter?.r2_status === "ready" || cJson?.r2Ready === true;
  report.gallery.full_key = Boolean(itemAfter?.r2_key_full);
  report.gallery.thumb_key = Boolean(itemAfter?.r2_key_thumb);
  step("gallery_r2_db", { item: itemAfter });

  // ensure job + enqueue to prod
  const hook = readHookSecret();
  await fetch(`${WORKER}/enqueue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hook}`,
    },
    body: JSON.stringify({
      kind: "gallery_full",
      refId: itemId,
      galleryId,
      orgId: ORG,
      opId,
    }),
  });

  const galSp = await waitSp("gallery_items", itemId, "gallery");
  report.gallery.sp_verified = galSp.ok === true;
  report.gallery.job_done = galSp.job?.state === "done";
  report.gallery.r2_delete_after = galSp.row?.r2_delete_after ?? itemAfter?.r2_delete_after;
  report.gallery.sp_status = galSp.row?.sp_status;
  report.gallery.sync_error = galSp.row?.sync_last_error?.slice?.(0, 120);
  step("gallery_sp", {
    ok: galSp.ok,
    sp: galSp.row?.sp_status,
    job: galSp.job?.state,
    err: report.gallery.sync_error,
    deleteAfter: report.gallery.r2_delete_after,
  });

  if (report.gallery.r2_delete_after) {
    const due = new Date(report.gallery.r2_delete_after).getTime();
    const days = Math.round((due - Date.now()) / 86400000);
    report.retention.gallery_days_approx = days;
  }

  // --- ATTACHMENT ---
  await admin.from("messages").insert({
    id: attMessageId,
    conversation_id: CONV,
    author_user_id: synthUserId,
    kind: "text",
    body: `${MARKER} attachment`,
    payload: { marker: MARKER },
    mentions: [],
  });

  const { res: apRes, json: apJson } = await edge("r2_presign_attachment", {
    conversationId: CONV,
    messageId: attMessageId,
    attachmentId: attId,
    fileName: `${MARKER}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: attBody.length,
    orgId: ORG,
  });
  step("att_presign", {
    http: apRes.status,
    hasPut: Boolean(apJson?.putUrl),
    key: apJson?.r2Key ? "present" : null,
    err: apJson?.error,
  });
  if (!apJson?.putUrl) throw new Error(`att presign: ${apJson?.error || apRes.status}`);

  const attPut = await fetch(apJson.putUrl, {
    method: "PUT",
    headers: apJson.headers ?? { "content-type": "application/pdf" },
    body: attBody,
  });
  step("att_put", { http: attPut.status });
  if (!attPut.ok) throw new Error(`att PUT ${attPut.status}`);

  const { res: acRes, json: acJson } = await edge("r2_confirm_attachment", {
    conversationId: CONV,
    messageId: attMessageId,
    attachmentId: attId,
    orgId: ORG,
    r2Key: apJson.r2Key,
    r2KeyThumb: apJson.r2KeyThumb ?? null,
    sizeBytes: attBody.length,
    fileName: `${MARKER}.pdf`,
    mimeType: "application/pdf",
  });
  step("att_confirm", {
    http: acRes.status,
    r2Ready: acJson?.r2Ready === true,
    err: acJson?.error,
  });
  if (!acRes.ok || acJson?.error) throw new Error(`att confirm: ${acJson?.error}`);

  const { data: attRow } = await admin
    .from("message_attachments")
    .select("r2_status, r2_key, sp_status, r2_delete_after")
    .eq("id", attId)
    .maybeSingle();
  report.attachment.r2_ready = attRow?.r2_status === "ready" || acJson?.r2Ready === true;
  report.attachment.r2_key = Boolean(attRow?.r2_key || apJson?.r2Key);
  step("att_r2_db", { att: attRow });

  await fetch(`${WORKER}/enqueue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${hook}`,
    },
    body: JSON.stringify({
      kind: "attachment",
      refId: attId,
      orgId: ORG,
      conversationId: CONV,
      messageId: attMessageId,
    }),
  });

  const attSp = await waitSp("message_attachments", attId, "attachment");
  report.attachment.sp_verified = attSp.ok === true;
  report.attachment.job_done = attSp.job?.state === "done";
  report.attachment.r2_delete_after =
    attSp.row?.r2_delete_after ?? attRow?.r2_delete_after;
  report.attachment.sp_status = attSp.row?.sp_status;
  report.attachment.sync_error = attSp.row?.sync_last_error?.slice?.(0, 120);
  step("att_sp", {
    ok: attSp.ok,
    sp: attSp.row?.sp_status,
    job: attSp.job?.state,
    err: report.attachment.sync_error,
    deleteAfter: report.attachment.r2_delete_after,
  });

  if (report.attachment.r2_delete_after) {
    const due = new Date(report.attachment.r2_delete_after).getTime();
    report.retention.attachment_days_approx = Math.round((due - Date.now()) / 86400000);
  }

  const notes = await cleanup();
  step("cleanup", { notes });

  const pass =
    report.gallery.r2_ready &&
    report.gallery.full_key &&
    report.attachment.r2_ready &&
    report.gallery.sp_verified &&
    report.attachment.sp_verified &&
    report.gallery.job_done &&
    report.attachment.job_done;

  console.log(JSON.stringify({ report, pass }, null, 2));
  process.exit(pass ? 0 : 3);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ fatal: e instanceof Error ? e.message : String(e) }));
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
