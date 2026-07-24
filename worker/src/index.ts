import {
  jobStateAfterSyncError,
  normalizeQueueMessage,
  shouldCleanupR2Object,
  shouldCronEnqueueGalleryItem,
  shouldProcessArchiveJob,
  shouldReconcileJobWithoutUpload,
} from "./pipelinePolicy";

/**
 * dodo-media-sync — Cloudflare Worker
 * - Queue consumer: R2 → SharePoint (Microsoft Graph)
 * - HTTP /enqueue: główne źródło zadań (po r2_confirm → media_sync_jobs)
 * - Cron: cleanup R2 + rekoncyliacja backlogu
 * - R2 Event Notifications: NIE podłączać jako równorzędne źródło (przyszła rekoncyliacja)
 */

export interface Env {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_ARCHIVE_QUEUE: Queue;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MICROSOFT_TENANT_ID: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  MEDIA_SYNC_HOOK_SECRET?: string;
  GALLERY_FULL_RETENTION_DAYS: string;
  ATTACHMENT_RETENTION_DAYS: string;
}

export type ArchiveJob = {
  kind: "gallery_full" | "attachment" | "cleanup_r2";
  refId: string;
  galleryId?: string;
  orgId?: string;
  opId?: string;
  r2Key?: string;
  /** Optional media_sync_jobs.id from Edge insert. */
  jobId?: string;
};

type MediaSyncJobRow = {
  id: string;
  state: string;
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
};

async function findMediaSyncJob(
  env: Env,
  job: ArchiveJob,
): Promise<MediaSyncJobRow | null> {
  if (job.jobId) {
    return sbGet<MediaSyncJobRow>(
      env,
      `media_sync_jobs?id=eq.${job.jobId}&select=id,state,attempts,last_error,locked_at`,
    );
  }
  if (job.kind === "cleanup_r2") return null;
  return sbGet<MediaSyncJobRow>(
    env,
    `media_sync_jobs?ref_id=eq.${job.refId}&kind=eq.${job.kind}&order=created_at.desc&limit=1&select=id,state,attempts,last_error,locked_at`,
  );
}

async function markJobRunning(env: Env, jobRow: MediaSyncJobRow): Promise<MediaSyncJobRow> {
  const attempts = (jobRow.attempts ?? 0) + 1;
  const lockedAt = new Date().toISOString();
  await sbPatch(env, "media_sync_jobs", jobRow.id, {
    state: "running",
    attempts,
    locked_at: lockedAt,
    last_error: null,
    finished_at: null,
  });
  return { ...jobRow, state: "running", attempts, locked_at: lockedAt, last_error: null };
}

async function markJobDone(env: Env, jobId: string): Promise<void> {
  await sbPatch(env, "media_sync_jobs", jobId, {
    state: "done",
    last_error: null,
    locked_at: null,
    finished_at: new Date().toISOString(),
  });
}

async function markJobFailed(
  env: Env,
  jobRow: MediaSyncJobRow | null,
  error: string,
  permanent: boolean,
): Promise<void> {
  if (!jobRow) return;
  const next = jobStateAfterSyncError({
    permanent,
    attempts: jobRow.attempts ?? 0,
  });
  await sbPatch(env, "media_sync_jobs", jobRow.id, {
    state: next,
    last_error: error.slice(0, 500),
    locked_at: null,
    ...(next === "dead" ? { finished_at: new Date().toISOString() } : {}),
  });
}

const GRAPH = "https://graph.microsoft.com/v1.0";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.token;
  const url =
    `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID,
    client_secret: env.MICROSOFT_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) {
    throw new Error(`Graph token failed: ${res.status}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function graphFetch<T>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getGraphToken(env);
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    const err = new Error(`Graph: ${msg}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

async function createFolder(
  env: Env,
  driveId: string,
  parentId: string,
  name: string,
): Promise<{ id: string; webUrl?: string }> {
  try {
    const existing = await graphFetch<{ id: string; webUrl?: string }>(
      env,
      `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}`,
    );
    if (existing?.id) return existing;
  } catch {
    // create below
  }
  return graphFetch(env, `/drives/${driveId}/items/${parentId}/children`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
}

async function uploadSmallFile(
  env: Env,
  driveId: string,
  parentId: string,
  fileName: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ id: string; name: string; size?: number }> {
  const path =
    `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(fileName)}:/content`;
  return graphFetch(env, path, {
    method: "PUT",
    headers: { "content-type": contentType || "application/octet-stream" },
    body: bytes,
  });
}

async function deleteDriveItem(env: Env, driveId: string, itemId: string): Promise<void> {
  try {
    await graphFetch(env, `/drives/${driveId}/items/${itemId}`, { method: "DELETE" });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 404) return;
    throw e;
  }
}

async function moveDriveItem(
  env: Env,
  driveId: string,
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<{ id: string; name?: string }> {
  const body: Record<string, unknown> = {
    parentReference: { id: newParentId },
    "@microsoft.graph.conflictBehavior": "rename",
  };
  if (newName) body.name = newName;
  return graphFetch(env, `/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sbHeaders(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    Prefer: "return=representation",
  };
}

async function sbGet<T>(env: Env, path: string): Promise<T | null> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(env),
  });
  if (!res.ok) throw new Error(`Supabase GET ${path}: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return data as T;
}

async function sbPatch(env: Env, table: string, id: string, body: Record<string, unknown>) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase PATCH ${table}: ${res.status} ${t}`);
  }
}

function retentionDays(env: Env, kind: "gallery" | "attachment"): number {
  if (kind === "attachment") return Number(env.ATTACHMENT_RETENTION_DAYS || "180");
  return Number(env.GALLERY_FULL_RETENTION_DAYS || "45");
}

function slugify(title: string): string {
  const map: Record<string, string> = {
    ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  };
  return (
    title
      .split("")
      .map((c) => map[c] ?? c)
      .join("")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "galeria"
  );
}

async function syncGalleryFull(env: Env, job: ArchiveJob): Promise<void> {
  const item = await sbGet<{
    id: string;
    gallery_id: string;
    file_name: string;
    mime_type: string;
    r2_key_full: string | null;
    r2_status: string;
    sp_status: string;
    sync_operation_id: string | null;
    provider_item_id: string | null;
    sp_drive_item_id: string | null;
  }>(env, `gallery_items?id=eq.${job.refId}&select=*`);

  if (!item) return; // deleted — noop

  let jobRow = await findMediaSyncJob(env, job);

  // Idempotent reconcile: item verified + job not done → fix job only (no SP upload).
  if (
    jobRow &&
    shouldReconcileJobWithoutUpload({
      itemSpStatus: item.sp_status,
      itemHasSpDriveItem: Boolean(item.sp_drive_item_id),
      jobState: jobRow.state,
    })
  ) {
    await markJobDone(env, jobRow.id);
    return;
  }

  // Redelivery of already-done job → no upload.
  if (jobRow?.state === "done") {
    return;
  }

  const gate = shouldProcessArchiveJob({
    spStatus: item.sp_status,
    spDriveItemId: item.sp_drive_item_id,
    r2Status: item.r2_status,
    jobOpId: job.opId,
    rowOpId: item.sync_operation_id,
  });
  if (!gate.process) {
    if (gate.reason === "already_verified") {
      if (jobRow) await markJobDone(env, jobRow.id);
      return;
    }
    if (gate.reason === "not_r2_ready") throw new Error("Item not r2_ready");
    return;
  }
  if (!item.r2_key_full) throw new Error("Item not r2_ready");

  if (jobRow) {
    jobRow = await markJobRunning(env, jobRow);
  }

  await sbPatch(env, "gallery_items", item.id, {
    sp_status: "copying",
  });

  const attemptsRow = await sbGet<{ sync_attempts: number }>(
    env,
    `gallery_items?id=eq.${item.id}&select=sync_attempts`,
  );
  const attempts = (attemptsRow?.sync_attempts ?? 0) + 1;
  await sbPatch(env, "gallery_items", item.id, {
    sync_attempts: attempts,
    sync_last_error: null,
  });

  const gallery = await sbGet<{
    id: string;
    org_id: string;
    title: string;
    provider_folder_id: string | null;
    deleted_at: string | null;
  }>(env, `galleries?id=eq.${item.gallery_id}&select=*`);
  if (!gallery || gallery.deleted_at) {
    await sbPatch(env, "gallery_items", item.id, {
      sp_status: "none",
      sync_last_error: "gallery deleted",
    });
    if (jobRow) {
      await markJobFailed(env, jobRow, "gallery deleted", true);
    }
    return;
  }

  const storage = await sbGet<{
    drive_id: string;
    base_folder_id: string;
    status: string;
  }>(
    env,
    `org_storage_connections?org_id=eq.${gallery.org_id}&provider=eq.sharepoint&status=eq.active&select=*`,
  );
  if (!storage?.drive_id || !storage.base_folder_id) {
    await sbPatch(env, "gallery_items", item.id, {
      sp_status: "permanent_failure",
      sync_last_error: "Brak aktywnego magazynu SharePoint",
      retention_hold: true,
    });
    if (jobRow) {
      await markJobFailed(env, jobRow, "Brak magazynu SharePoint", true);
    }
    // retention_hold: never auto-delete R2 without verified archive
    return;
  }

  let folderId = gallery.provider_folder_id;
  if (!folderId) {
    const galerie = await createFolder(env, storage.drive_id, storage.base_folder_id, "Galerie");
    const folderName = `${slugify(gallery.title)}__${gallery.id.replace(/-/g, "")}`;
    const gf = await createFolder(env, storage.drive_id, galerie.id, folderName);
    folderId = gf.id;
    await sbPatch(env, "galleries", gallery.id, {
      provider_folder_id: folderId,
      provider_folder_path: gf.webUrl ?? null,
    });
  }

  const obj = await env.MEDIA_BUCKET.get(item.r2_key_full);
  if (!obj) throw new Error("R2 object missing");
  const bytes = await obj.arrayBuffer();
  const uploaded = await uploadSmallFile(
    env,
    storage.drive_id,
    folderId,
    item.file_name || `${item.id}.jpg`,
    bytes,
    item.mime_type || "image/jpeg",
  );

  if (uploaded.size != null && Math.abs(uploaded.size - bytes.byteLength) > 64) {
    throw new Error(`Size mismatch: graph=${uploaded.size} r2=${bytes.byteLength}`);
  }

  const days = retentionDays(env, "gallery");
  const deleteAfter = new Date(Date.now() + days * 86400_000).toISOString();

  // Preferred order: item verified first, then job done (safe if job patch fails).
  await sbPatch(env, "gallery_items", item.id, {
    sp_status: "verified",
    sp_drive_item_id: uploaded.id,
    sp_folder_id: folderId,
    provider_item_id: uploaded.id,
    status: "ready",
    r2_delete_after: deleteAfter,
    sync_last_error: null,
  });

  if (jobRow) {
    await markJobDone(env, jobRow.id);
  }
}

async function syncAttachment(env: Env, job: ArchiveJob): Promise<void> {
  const att = await sbGet<{
    id: string;
    message_id: string;
    file_name: string;
    mime_type: string;
    r2_key: string | null;
    r2_status: string;
    sp_status: string;
    org_id: string | null;
    sync_operation_id: string | null;
    sp_drive_item_id: string | null;
    retention_days: number;
  }>(env, `message_attachments?id=eq.${job.refId}&select=*`);

  if (!att) return;

  let jobRow = await findMediaSyncJob(env, job);

  if (
    jobRow &&
    shouldReconcileJobWithoutUpload({
      itemSpStatus: att.sp_status,
      itemHasSpDriveItem: Boolean(att.sp_drive_item_id),
      jobState: jobRow.state,
    })
  ) {
    await markJobDone(env, jobRow.id);
    return;
  }
  if (jobRow?.state === "done") return;

  const gate = shouldProcessArchiveJob({
    spStatus: att.sp_status,
    spDriveItemId: att.sp_drive_item_id,
    r2Status: att.r2_status,
    jobOpId: job.opId,
    rowOpId: att.sync_operation_id,
  });
  if (!gate.process) {
    if (gate.reason === "already_verified") {
      if (jobRow) await markJobDone(env, jobRow.id);
      return;
    }
    if (gate.reason === "not_r2_ready") throw new Error("Attachment not r2_ready");
    return;
  }
  if (!att.r2_key) throw new Error("Attachment not r2_ready");

  if (jobRow) {
    jobRow = await markJobRunning(env, jobRow);
  }

  const orgId = att.org_id || job.orgId;
  if (!orgId) throw new Error("Missing orgId");

  const msg = await sbGet<{ conversation_id: string; deleted_at: string | null }>(
    env,
    `messages?id=eq.${att.message_id}&select=conversation_id,deleted_at`,
  );
  if (!msg || msg.deleted_at) {
    await sbPatch(env, "message_attachments", att.id, {
      sp_status: "none",
      sync_last_error: "message deleted",
    });
    if (jobRow) await markJobFailed(env, jobRow, "message deleted", true);
    return;
  }

  await sbPatch(env, "message_attachments", att.id, { sp_status: "copying" });

  const storage = await sbGet<{
    drive_id: string;
    base_folder_id: string;
  }>(
    env,
    `org_storage_connections?org_id=eq.${orgId}&provider=eq.sharepoint&status=eq.active&select=*`,
  );
  if (!storage) {
    await sbPatch(env, "message_attachments", att.id, {
      sp_status: "permanent_failure",
      sync_last_error: "Brak magazynu SharePoint",
      retention_hold: true,
    });
    if (jobRow) await markJobFailed(env, jobRow, "Brak magazynu SharePoint", true);
    return;
  }

  const zal = await createFolder(env, storage.drive_id, storage.base_folder_id, "Zalaczniki");
  const convFolder = await createFolder(env, storage.drive_id, zal.id, msg.conversation_id);
  const msgFolder = await createFolder(env, storage.drive_id, convFolder.id, att.message_id);

  const obj = await env.MEDIA_BUCKET.get(att.r2_key);
  if (!obj) throw new Error("R2 object missing");
  const bytes = await obj.arrayBuffer();
  const uploaded = await uploadSmallFile(
    env,
    storage.drive_id,
    msgFolder.id,
    att.file_name,
    bytes,
    att.mime_type || "application/octet-stream",
  );

  const days = att.retention_days || retentionDays(env, "attachment");
  const deleteAfter = new Date(Date.now() + days * 86400_000).toISOString();

  await sbPatch(env, "message_attachments", att.id, {
    sp_status: "verified",
    sp_drive_item_id: uploaded.id,
    sp_folder_id: msgFolder.id,
    r2_delete_after: deleteAfter,
    sync_last_error: null,
  });

  if (jobRow) {
    await markJobDone(env, jobRow.id);
  }
}

async function handleJob(env: Env, job: ArchiveJob): Promise<void> {
  let jobRow: MediaSyncJobRow | null = null;
  try {
    if (job.kind !== "cleanup_r2") {
      jobRow = await findMediaSyncJob(env, job);
    }
    if (job.kind === "gallery_full") await syncGalleryFull(env, job);
    else if (job.kind === "attachment") await syncAttachment(env, job);
    else if (job.kind === "cleanup_r2") await cleanupDueR2(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number }).status;
    if (job.kind === "cleanup_r2") {
      console.error("[media-sync] cleanup failed", msg);
      return;
    }

    // If item/attachment was verified before job mark failed → reconcile to done.
    if (job.kind === "gallery_full" || job.kind === "attachment") {
      const table = job.kind === "attachment" ? "message_attachments" : "gallery_items";
      const item = await sbGet<{ sp_status: string; sp_drive_item_id: string | null }>(
        env,
        `${table}?id=eq.${job.refId}&select=sp_status,sp_drive_item_id`,
      ).catch(() => null);
      if (
        item &&
        jobRow &&
        shouldReconcileJobWithoutUpload({
          itemSpStatus: item.sp_status,
          itemHasSpDriveItem: Boolean(item.sp_drive_item_id),
          jobState: jobRow.state,
        })
      ) {
        await markJobDone(env, jobRow.id).catch(() => undefined);
        return;
      }
    }

    const table = job.kind === "attachment" ? "message_attachments" : "gallery_items";
    const permanent =
      status === 401 || status === 403 || /Brak magazynu|No active storage/i.test(msg);
    // Refresh job row for attempt count after possible markJobRunning.
    jobRow = (await findMediaSyncJob(env, job).catch(() => null)) ?? jobRow;
    await markJobFailed(env, jobRow, msg, permanent).catch(() => undefined);
    await sbPatch(env, table, job.refId, {
      sp_status: permanent ? "permanent_failure" : "failed",
      sync_last_error: msg.slice(0, 500),
      retention_hold: true,
      sync_next_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    }).catch(() => undefined);
    // Permanent failure never deletes R2 (retention_hold + no cleanup without verified+due).
    if (!permanent) throw e; // Queue retry
  }
}

async function cleanupDueR2(env: Env): Promise<void> {
  const nowIso = new Date().toISOString();
  const gRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/gallery_items?select=id,r2_key_full,sp_status,r2_status,r2_deleted_at,r2_delete_after,retention_hold&limit=40`,
    { headers: sbHeaders(env) },
  );
  if (gRes.ok) {
    const rows = (await gRes.json()) as Array<{
      id: string;
      r2_key_full: string | null;
      sp_status: string;
      r2_status: string;
      r2_deleted_at: string | null;
      r2_delete_after: string | null;
      retention_hold: boolean;
    }>;
    for (const row of rows) {
      if (
        !shouldCleanupR2Object({
          spStatus: row.sp_status,
          r2Status: row.r2_status,
          r2DeletedAt: row.r2_deleted_at,
          r2DeleteAfter: row.r2_delete_after,
          retentionHold: row.retention_hold,
          nowIso,
          objectKind: "gallery_full",
        })
      ) {
        continue;
      }
      if (!row.r2_key_full || row.r2_key_full.includes("/thumb/")) continue;
      await env.MEDIA_BUCKET.delete(row.r2_key_full);
      await sbPatch(env, "gallery_items", row.id, {
        r2_status: "deleted",
        r2_deleted_at: nowIso,
      });
    }
  }

  const aRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/message_attachments?select=id,r2_key,sp_status,r2_status,r2_deleted_at,r2_delete_after,retention_hold&limit=40`,
    { headers: sbHeaders(env) },
  );
  if (!aRes.ok) return;
  const atts = (await aRes.json()) as Array<{
    id: string;
    r2_key: string | null;
    sp_status: string;
    r2_status: string;
    r2_deleted_at: string | null;
    r2_delete_after: string | null;
    retention_hold: boolean;
  }>;
  for (const row of atts) {
    if (
      !shouldCleanupR2Object({
        spStatus: row.sp_status,
        r2Status: row.r2_status,
        r2DeletedAt: row.r2_deleted_at,
        r2DeleteAfter: row.r2_delete_after,
        retentionHold: row.retention_hold,
        nowIso,
        objectKind: "attachment",
      })
    ) {
      continue;
    }
    if (!row.r2_key) continue;
    await env.MEDIA_BUCKET.delete(row.r2_key);
    await sbPatch(env, "message_attachments", row.id, {
      r2_status: "deleted",
      r2_deleted_at: nowIso,
    });
  }
}

const SP_TRASH_DIR = "_Usuniete";

function spTrashLeafName(stableId: string): string {
  const d = new Date();
  const ymd =
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}`;
  return `Usuniete__${ymd}__${stableId.replace(/-/g, "").slice(0, 32)}`;
}

async function ensureSpTrashParent(
  env: Env,
  driveId: string,
  baseFolderId: string,
  rootName: "Zalaczniki" | "Galerie",
): Promise<string> {
  const root = await createFolder(env, driveId, baseFolderId, rootName);
  const trash = await createFolder(env, driveId, root.id, SP_TRASH_DIR);
  return trash.id;
}

/** Fizyczne usunięcie folderów SP po sp_purge_after. */
async function cleanupDueSp(env: Env): Promise<void> {
  const nowIso = new Date().toISOString();

  const aRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/message_attachments?sp_trash_marked_at=not.is.null&sp_purged_at=is.null&sp_purge_after=lt.${nowIso}&select=id,org_id,sp_folder_id,sp_drive_item_id&limit=20`,
    { headers: sbHeaders(env) },
  );
  if (aRes.ok) {
    const rows = (await aRes.json()) as Array<{
      id: string;
      org_id: string | null;
      sp_folder_id: string | null;
      sp_drive_item_id: string | null;
    }>;
    for (const row of rows) {
      try {
        const itemId = row.sp_folder_id || row.sp_drive_item_id;
        if (itemId && row.org_id) {
          const storage = await sbGet<{ drive_id: string }>(
            env,
            `org_storage_connections?org_id=eq.${row.org_id}&provider=eq.sharepoint&status=eq.active&select=drive_id`,
          );
          if (storage?.drive_id) {
            await deleteDriveItem(env, storage.drive_id, itemId);
          }
        }
        await sbPatch(env, "message_attachments", row.id, {
          sp_purged_at: nowIso,
          sp_drive_item_id: null,
          sp_folder_id: null,
        });
      } catch (e) {
        console.error("[media-sync] sp purge attachment failed", row.id, e);
      }
    }
  }

  const gRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/galleries?sp_trash_marked_at=not.is.null&sp_purged_at=is.null&sp_purge_after=lt.${nowIso}&select=id,org_id,provider_folder_id&limit=20`,
    { headers: sbHeaders(env) },
  );
  if (!gRes.ok) return;
  const galleries = (await gRes.json()) as Array<{
    id: string;
    org_id: string;
    provider_folder_id: string | null;
  }>;
  for (const row of galleries) {
    try {
      if (row.provider_folder_id) {
        const storage = await sbGet<{ drive_id: string }>(
          env,
          `org_storage_connections?org_id=eq.${row.org_id}&provider=eq.sharepoint&status=eq.active&select=drive_id`,
        );
        if (storage?.drive_id) {
          await deleteDriveItem(env, storage.drive_id, row.provider_folder_id);
        }
      }
      await sbPatch(env, "galleries", row.id, {
        sp_purged_at: nowIso,
        provider_folder_id: null,
      });
    } catch (e) {
      console.error("[media-sync] sp purge gallery failed", row.id, e);
    }
  }
}

/**
 * Reconcile: soft-deleted messages with verified SP attachments not yet in trash.
 */
async function reconcileSpTrashMarks(env: Env): Promise<void> {
  const attDays = retentionDays(env, "attachment");
  const galDays = retentionDays(env, "gallery");
  const now = Date.now();
  const purgeAtt = new Date(now + attDays * 86400_000).toISOString();
  const purgeGal = new Date(now + galDays * 86400_000).toISOString();
  const nowIso = new Date().toISOString();

  const aRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/message_attachments?sp_status=eq.verified&sp_trash_marked_at=is.null&or=(sp_folder_id.not.is.null,sp_drive_item_id.not.is.null)&select=id,org_id,message_id,sp_folder_id,sp_drive_item_id,messages!inner(deleted_at)&messages.deleted_at=not.is.null&limit=15`,
    { headers: sbHeaders(env) },
  );
  if (aRes.ok) {
    const rows = (await aRes.json()) as Array<{
      id: string;
      org_id: string | null;
      message_id: string;
      sp_folder_id: string | null;
      sp_drive_item_id: string | null;
    }>;
    const moved = new Set<string>();
    for (const row of rows) {
      if (!row.org_id) continue;
      try {
        const storage = await sbGet<{ drive_id: string; base_folder_id: string }>(
          env,
          `org_storage_connections?org_id=eq.${row.org_id}&provider=eq.sharepoint&status=eq.active&select=drive_id,base_folder_id`,
        );
        if (!storage?.drive_id || !storage.base_folder_id) continue;
        const itemId = row.sp_folder_id || row.sp_drive_item_id;
        if (!itemId) continue;
        if (!moved.has(itemId)) {
          const trashParent = await ensureSpTrashParent(
            env,
            storage.drive_id,
            storage.base_folder_id,
            "Zalaczniki",
          );
          await moveDriveItem(
            env,
            storage.drive_id,
            itemId,
            trashParent,
            spTrashLeafName(row.message_id),
          );
          moved.add(itemId);
        }
        await sbPatch(env, "message_attachments", row.id, {
          sp_trash_marked_at: nowIso,
          sp_purge_after: purgeAtt,
          retention_hold: false,
          sp_folder_id: itemId,
        });
      } catch (e) {
        console.error("[media-sync] reconcile att trash failed", row.id, e);
      }
    }
  }

  const gRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/galleries?deleted_at=not.is.null&sp_trash_marked_at=is.null&provider_folder_id=not.is.null&select=id,org_id,provider_folder_id&limit=10`,
    { headers: sbHeaders(env) },
  );
  if (!gRes.ok) return;
  const galleries = (await gRes.json()) as Array<{
    id: string;
    org_id: string;
    provider_folder_id: string;
  }>;
  for (const row of galleries) {
    try {
      const storage = await sbGet<{ drive_id: string; base_folder_id: string }>(
        env,
        `org_storage_connections?org_id=eq.${row.org_id}&provider=eq.sharepoint&status=eq.active&select=drive_id,base_folder_id`,
      );
      if (!storage?.drive_id || !storage.base_folder_id) continue;
      const trashParent = await ensureSpTrashParent(
        env,
        storage.drive_id,
        storage.base_folder_id,
        "Galerie",
      );
      await moveDriveItem(
        env,
        storage.drive_id,
        row.provider_folder_id,
        trashParent,
        spTrashLeafName(row.id),
      );
      await sbPatch(env, "galleries", row.id, {
        sp_trash_marked_at: nowIso,
        sp_purge_after: purgeGal,
      });
    } catch (e) {
      console.error("[media-sync] reconcile gallery trash failed", row.id, e);
    }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/enqueue") {
      const secret = env.MEDIA_SYNC_HOOK_SECRET;
      if (secret) {
        const auth = req.headers.get("authorization") ?? "";
        if (auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
      }
      const job = (await req.json()) as ArchiveJob;
      await env.MEDIA_ARCHIVE_QUEUE.send(job);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "dodo-media-sync" });
    }
    return new Response("Not found", { status: 404 });
  },

  async queue(batch: MessageBatch<ArchiveJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const body = msg.body as unknown as Record<string, unknown>;
        const normalized = normalizeQueueMessage(body);
        // R2 Event Notifications → ignore (przyszła rekoncyliacja / audyt)
        if (normalized.ignoreAsFutureReconciliation) {
          msg.ack();
          continue;
        }
        if (!normalized.kind || (normalized.kind !== "cleanup_r2" && !normalized.refId)) {
          msg.ack();
          continue;
        }
        const job = body as unknown as ArchiveJob;
        job.kind = normalized.kind;
        if (normalized.refId) job.refId = normalized.refId;
        await handleJob(env, job);
        msg.ack();
      } catch (e) {
        console.error("[media-sync] job failed", e);
        msg.retry();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    // 0) Reconcile: item verified but job stuck pending/running/failed → mark done (no upload).
    const stuckRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/media_sync_jobs?state=in.(pending,running,failed)&kind=eq.gallery_full&select=id,ref_id,state&limit=30`,
      { headers: sbHeaders(env) },
    );
    if (stuckRes.ok) {
      const stuck = (await stuckRes.json()) as Array<{
        id: string;
        ref_id: string;
        state: string;
      }>;
      for (const j of stuck) {
        const item = await sbGet<{ sp_status: string; sp_drive_item_id: string | null }>(
          env,
          `gallery_items?id=eq.${j.ref_id}&select=sp_status,sp_drive_item_id`,
        );
        if (
          item &&
          shouldReconcileJobWithoutUpload({
            itemSpStatus: item.sp_status,
            itemHasSpDriveItem: Boolean(item.sp_drive_item_id),
            jobState: j.state,
          })
        ) {
          await markJobDone(env, j.id).catch(() => undefined);
        }
      }
    }

    // 1) Re-enqueue gallery sync backlog (never verified items)
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/gallery_items?sp_status=in.(queued,failed,retry_scheduled)&r2_status=eq.ready&select=id,gallery_id,sync_operation_id,sp_status&limit=20`,
      { headers: sbHeaders(env) },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        id: string;
        gallery_id: string;
        sync_operation_id: string | null;
        sp_status: string;
      }>;
      for (const r of rows) {
        if (!shouldCronEnqueueGalleryItem(r.sp_status)) continue;
        await env.MEDIA_ARCHIVE_QUEUE.send({
          kind: "gallery_full",
          refId: r.id,
          galleryId: r.gallery_id,
          opId: r.sync_operation_id ?? undefined,
        });
      }
    }

    // 2) Re-enqueue attachment sync backlog
    const aRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/message_attachments?sp_status=in.(queued,failed,retry_scheduled)&r2_status=eq.ready&select=id,org_id,sync_operation_id&limit=20`,
      { headers: sbHeaders(env) },
    );
    if (aRes.ok) {
      const rows = (await aRes.json()) as Array<{
        id: string;
        org_id: string | null;
        sync_operation_id: string | null;
      }>;
      for (const r of rows) {
        await env.MEDIA_ARCHIVE_QUEUE.send({
          kind: "attachment",
          refId: r.id,
          orgId: r.org_id ?? undefined,
          opId: r.sync_operation_id ?? undefined,
        });
      }
    }

    // 3) Retention cleanup R2 (Stage 4)
    await env.MEDIA_ARCHIVE_QUEUE.send({
      kind: "cleanup_r2",
      refId: "00000000-0000-0000-0000-000000000000",
    });

    // 3b) SharePoint trash: mark missing + purge due
    await reconcileSpTrashMarks(env).catch((e) =>
      console.error("[media-sync] reconcileSpTrashMarks", e),
    );
    await cleanupDueSp(env).catch((e) =>
      console.error("[media-sync] cleanupDueSp", e),
    );

    // 4) Stale R2 uploads without confirm (>12h)
    const staleIso = new Date(Date.now() - 12 * 3600_000).toISOString();
    const staleRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/gallery_items?r2_status=eq.uploading&created_at=lt.${staleIso}&select=id,r2_key_full,r2_key_thumb&limit=30`,
      { headers: sbHeaders(env) },
    );
    if (staleRes.ok) {
      const stale = (await staleRes.json()) as Array<{
        id: string;
        r2_key_full: string | null;
        r2_key_thumb: string | null;
      }>;
      for (const row of stale) {
        if (row.r2_key_full) await env.MEDIA_BUCKET.delete(row.r2_key_full).catch(() => undefined);
        if (row.r2_key_thumb) await env.MEDIA_BUCKET.delete(row.r2_key_thumb).catch(() => undefined);
        await sbPatch(env, "gallery_items", row.id, {
          r2_status: "deleted",
          r2_deleted_at: new Date().toISOString(),
          status: "failed",
          error_message: "Upload R2 niedokończony (timeout)",
        }).catch(() => undefined);
      }
    }
  },
};
