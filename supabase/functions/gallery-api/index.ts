// Supabase Edge Function: gallery-api
// Galerie zdjęć w czacie, przechowywane na SharePoint (Microsoft Graph,
// app-only / client credentials). JEDNA funkcja, router akcji przez JSON
// body `{ action, ... }` — patrz src/lib/chat/galleryApi.ts (klient).
//
// Bezpieczeństwo:
//  - JWT wywołującego weryfikowany przez auth.getUser() (createUserClient);
//  - dalsze operacje na bazie przez SERVICE ROLE (obchodzi RLS) — dostęp
//    weryfikowany RĘCZNIE (membership / org admin) przed każdą operacją;
//  - tokeny Microsoft Graph NIGDY nie trafiają do klienta — tylko wyniki
//    (np. krótkotrwały URL pobrania) wracają w odpowiedzi JSON.
//
// Wdrożenie: supabase functions deploy gallery-api
// Sekrety: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//          MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsPreflight, json } from "../_shared/cors.ts";
import { AuthError, createServiceClient, createUserClient } from "../_shared/supabase.ts";
import {
  createFolder,
  deleteItem,
  getDownloadUrl,
  graphFetch,
  GraphError,
  graphConfigured,
  SHAREPOINT_NOT_CONFIGURED,
  uploadSmallFile,
} from "../_shared/graph.ts";
import {
  headR2Object,
  presignR2Url,
  r2Configured,
  deleteR2Object,
} from "../_shared/r2.ts";
import {
  resolveOrgGalleryPipeline,
  resolveAttachmentPipeline,
  galleryFullKey,
  galleryThumbKey,
  attachmentKey,
  attachmentThumbKey,
  assertGalleryFullKeyScope,
  validateConfirmHead,
  resolveThumbStatusAfterConfirm,
  resolveDualReadSource,
  shouldCleanupR2Object,
  shouldCreateSyncJob,
  normalizeOrgMediaPipeline,
  authorizeGalleryMediaAccess,
  legacyUploadItemRejectionForPipeline,
  orgIdFromHotKey,
  GLOBAL_DEFAULT_PIPELINE,
} from "../_shared/mediaPolicy.ts";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // ~12 MB po zdekodowaniu base64
const MAX_ITEMS_PER_CALL = 60;
const MAX_TITLE_LEN = 120;
const MAX_DESCRIPTION_LEN = 2000;
/** Globalny default to zawsze legacy_sp (GLOBAL_DEFAULT_PIPELINE).
 *  Env MEDIA_PIPELINE_DEFAULT nie włącza R2 — tylko org.media_pipeline=r2_sp. */
const GALLERY_FULL_RETENTION_DAYS = Number(
  Deno.env.get("GALLERY_FULL_RETENTION_DAYS") ?? "45",
);
const ATTACHMENT_RETENTION_DAYS = Number(
  Deno.env.get("ATTACHMENT_RETENTION_DAYS") ?? "180",
);
const PRESIGN_TTL_SEC = 600;
const MEDIA_SYNC_HOOK_URL = Deno.env.get("MEDIA_SYNC_HOOK_URL") ?? "";
const MEDIA_SYNC_HOOK_SECRET = Deno.env.get("MEDIA_SYNC_HOOK_SECRET") ?? "";

class ActionError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 200, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Slug — przyjazny dla polskich znaków, do nazw folderów SharePoint.
// ---------------------------------------------------------------------------

const PL_MAP: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "a", Ć: "c", Ę: "e", Ł: "l", Ń: "n", Ó: "o", Ś: "s", Ź: "z", Ż: "z",
};

function slugify(title: string, maxLen = 40): string {
  const transliterated = title
    .split("")
    .map((ch) => PL_MAP[ch] ?? ch)
    .join("");
  const slug = transliterated
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // pozostałe diakrytyki
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug || "galeria";
}

function shortId(uuid: string): string {
  return uuid.replace(/-/g, "");
}

function galleryFolderName(title: string, galleryId: string): string {
  return `${slugify(title)}__${shortId(galleryId)}`;
}

// ---------------------------------------------------------------------------
// Base64 (Deno global atob) — dla gallery_upload_item.
// ---------------------------------------------------------------------------

function decodeBase64(b64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new ActionError("Nieprawidłowe dane pliku (base64).", 400);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Row mapping (camelCase, zgodne z src/lib/chat/galleryApi.ts)
// ---------------------------------------------------------------------------

function rowToGallery(r: Row) {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    conversationId: r.conversation_id as string,
    messageId: (r.message_id as string | null) ?? null,
    createdBy: r.created_by as string,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    provider: r.provider as string,
    providerFolderId: (r.provider_folder_id as string | null) ?? null,
    providerFolderPath: (r.provider_folder_path as string | null) ?? null,
    status: r.status as string,
    itemCount: Number(r.item_count ?? 0),
    failedCount: Number(r.failed_count ?? 0),
    deletedAt: (r.deleted_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    pipeline: (r.pipeline as string | null) ?? "legacy_sp",
  };
}

function rowToGalleryItem(r: Row) {
  return {
    id: r.id as string,
    galleryId: r.gallery_id as string,
    sortOrder: Number(r.sort_order ?? 0),
    fileName: r.file_name as string,
    mimeType: r.mime_type as string,
    sizeBytes: Number(r.size_bytes ?? 0),
    width: (r.width as number | null) ?? null,
    height: (r.height as number | null) ?? null,
    providerItemId: (r.provider_item_id as string | null) ?? null,
    providerThumbItemId: (r.provider_thumb_item_id as string | null) ?? null,
    status: r.status as string,
    thumbStatus: (r.thumb_status as string | null) ?? "pending",
    errorCode: (r.error_code as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    r2KeyFull: (r.r2_key_full as string | null) ?? null,
    r2KeyThumb: (r.r2_key_thumb as string | null) ?? null,
    r2Status: (r.r2_status as string | null) ?? "none",
    spStatus: (r.sp_status as string | null) ?? "none",
    syncAttempts: Number(r.sync_attempts ?? 0),
    syncLastError: (r.sync_last_error as string | null) ?? null,
  };
}

/** Odczyt org.media_pipeline — przy błędzie odczytu → legacy_sp + failed. */
async function loadOrgMediaPipeline(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ pipeline: "legacy_sp" | "r2_sp"; failed: boolean }> {
  try {
    const { data, error } = await admin
      .from("orgs")
      .select("media_pipeline")
      .eq("id", orgId)
      .maybeSingle();
    if (error || !data) return { pipeline: "legacy_sp", failed: true };
    return {
      pipeline: normalizeOrgMediaPipeline(data.media_pipeline as string),
      failed: false,
    };
  } catch {
    return { pipeline: "legacy_sp", failed: true };
  }
}

/** Powiadom Worker o zadaniu sync (opcjonalny HTTP hook — Queue producer). */
async function enqueueMediaSync(job: {
  kind: string;
  refId: string;
  galleryId?: string;
  orgId?: string;
  opId?: string;
  jobId?: string;
}): Promise<void> {
  if (!MEDIA_SYNC_HOOK_URL) return;
  try {
    await fetch(MEDIA_SYNC_HOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(MEDIA_SYNC_HOOK_SECRET
          ? { authorization: `Bearer ${MEDIA_SYNC_HOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify(job),
    });
  } catch (e) {
    console.warn("[gallery-api] enqueueMediaSync failed", e);
  }
}

const THUMBNAILS_FOLDER = "_thumbnails";

/** Cache get-or-create `_thumbnails` w ramach izolatu (unika N× Graph GET). */
const thumbsFolderCache = new Map<string, Promise<string>>();

/** Get-or-create techniczny podfolder miniatur w folderze galerii. */
async function ensureThumbnailsFolder(
  driveId: string,
  galleryFolderId: string,
): Promise<string> {
  const cacheKey = `${driveId}:${galleryFolderId}`;
  let pending = thumbsFolderCache.get(cacheKey);
  if (!pending) {
    pending = createFolder(driveId, galleryFolderId, THUMBNAILS_FOLDER).then((f) => f.id);
    thumbsFolderCache.set(cacheKey, pending);
  }
  try {
    return await pending;
  } catch (e) {
    thumbsFolderCache.delete(cacheKey);
    throw e;
  }
}

function thumbFileName(itemId: string, mimeType: string): string {
  const ext = /png/i.test(mimeType) ? "png" : /jpeg|jpg/i.test(mimeType) ? "jpg" : "webp";
  return `${itemId}.${ext}`;
}

// ---------------------------------------------------------------------------
// Weryfikacja dostępu (SERVICE ROLE — sprawdzane ręcznie, bez RLS)
// ---------------------------------------------------------------------------

async function isConversationMember(
  admin: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  return Boolean(data);
}

async function isOrgMember(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function isOrgAdmin(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) === "admin";
}

interface StorageConnection {
  id: string;
  orgId: string;
  status: string;
  siteId: string | null;
  driveId: string | null;
  baseFolderId: string | null;
  baseFolderName: string | null;
}

function rowToConnection(r: Row): StorageConnection {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    status: r.status as string,
    siteId: (r.site_id as string | null) ?? null,
    driveId: (r.drive_id as string | null) ?? null,
    baseFolderId: (r.base_folder_id as string | null) ?? null,
    baseFolderName: (r.base_folder_name as string | null) ?? null,
  };
}

async function getActiveStorage(
  admin: SupabaseClient,
  orgId: string,
): Promise<StorageConnection | null> {
  const { data } = await admin
    .from("org_storage_connections")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider", "sharepoint")
    .eq("status", "active")
    .maybeSingle();
  if (!data || !data.drive_id || !data.base_folder_id) return null;
  return rowToConnection(data as Row);
}

async function requireActiveStorage(
  admin: SupabaseClient,
  orgId: string,
): Promise<StorageConnection> {
  const conn = await getActiveStorage(admin, orgId);
  if (!conn) {
    throw new ActionError("Organizacja nie ma aktywnego magazynu plików.", 200);
  }
  return conn;
}

async function loadGallery(admin: SupabaseClient, galleryId: string): Promise<Row> {
  const { data } = await admin
    .from("galleries")
    .select("*")
    .eq("id", galleryId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) throw new ActionError("Galeria nie istnieje.", 404);
  return data as Row;
}

function canManageGallery(gallery: Row, userId: string, isAdmin: boolean): boolean {
  return gallery.created_by === userId || isAdmin;
}

/** Przelicza item_count / failed_count / status galerii po zmianie itemu. */
async function recomputeGalleryCounts(
  admin: SupabaseClient,
  galleryId: string,
): Promise<Row> {
  const { data: items } = await admin
    .from("gallery_items")
    .select("status, r2_status")
    .eq("gallery_id", galleryId);
  const rows = (items as { status: string; r2_status?: string }[] | null) ?? [];
  const total = rows.length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const ready = rows.filter(
    (r) => r.status === "ready" || r.r2_status === "ready",
  ).length;
  const pending = rows.filter((r) => {
    if (r.status === "failed") return false;
    if (r.status === "ready" || r.r2_status === "ready") return false;
    return (
      r.status === "pending" ||
      r.status === "uploading" ||
      r.r2_status === "uploading"
    );
  }).length;

  let status: string;
  if (total === 0) status = "draft";
  else if (pending > 0) status = "uploading";
  else if (failed === total) status = "failed";
  else if (failed > 0) status = "partial";
  else if (ready === total) status = "ready";
  else status = "uploading";

  const { data } = await admin
    .from("galleries")
    .update({ item_count: total, failed_count: failed, status })
    .eq("id", galleryId)
    .select()
    .single();
  return data as Row;
}

// ---------------------------------------------------------------------------
// Walidacja wejścia
// ---------------------------------------------------------------------------

function requireString(body: Row, field: string, maxLen?: number): string {
  const v = body[field];
  if (typeof v !== "string" || !v.trim()) {
    throw new ActionError(`Pole "${field}" jest wymagane.`, 400);
  }
  const trimmed = v.trim();
  if (maxLen && trimmed.length > maxLen) {
    throw new ActionError(`Pole "${field}" jest za długie (max ${maxLen}).`, 400);
  }
  return trimmed;
}

interface IncomingItem {
  id?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
}

function parseItems(raw: unknown): IncomingItem[] {
  if (!Array.isArray(raw)) throw new ActionError('Pole "items" musi być listą.', 400);
  if (raw.length === 0) throw new ActionError("Lista zdjęć jest pusta.", 400);
  if (raw.length > MAX_ITEMS_PER_CALL) {
    throw new ActionError(`Maksymalnie ${MAX_ITEMS_PER_CALL} zdjęć na raz.`, 400);
  }
  return raw.map((it, idx) => {
    const r = it as Row;
    const fileName = typeof r.fileName === "string" && r.fileName.trim()
      ? r.fileName.trim().slice(0, 200)
      : `zdjecie-${idx + 1}`;
    return {
      id: typeof r.id === "string" && r.id ? r.id : undefined,
      fileName,
      mimeType: typeof r.mimeType === "string" && r.mimeType ? r.mimeType : "image/jpeg",
      sizeBytes: typeof r.sizeBytes === "number" && r.sizeBytes >= 0 ? r.sizeBytes : 0,
      width: typeof r.width === "number" ? r.width : undefined,
      height: typeof r.height === "number" ? r.height : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Akcje: magazyn (org_storage_connections)
// ---------------------------------------------------------------------------

async function actionStorageStatus(admin: SupabaseClient, callerId: string, body: Row) {
  const orgId = requireString(body, "orgId");
  if (!(await isOrgMember(admin, orgId, callerId))) {
    throw new ActionError("Nie należysz do tej organizacji.", 403);
  }
  const { data } = await admin
    .from("org_storage_connections")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider", "sharepoint")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return {
      connected: false,
      status: null,
      provider: null,
      siteId: null,
      driveId: null,
      baseFolderId: null,
      baseFolderName: null,
      connectedAt: null,
      updatedAt: null,
      graphConfigured: graphConfigured(),
    };
  }
  const r = data as Row;
  return {
    connected: r.status === "active" && Boolean(r.base_folder_id),
    status: r.status as string,
    provider: r.provider as string,
    siteId: (r.site_id as string | null) ?? null,
    driveId: (r.drive_id as string | null) ?? null,
    baseFolderId: (r.base_folder_id as string | null) ?? null,
    baseFolderName: (r.base_folder_name as string | null) ?? null,
    connectedAt: (r.connected_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
    graphConfigured: graphConfigured(),
  };
}

async function actionStorageSave(admin: SupabaseClient, callerId: string, body: Row) {
  const orgId = requireString(body, "orgId");
  const siteId = requireString(body, "siteId");
  const driveId = requireString(body, "driveId");
  const baseFolderId = requireString(body, "baseFolderId");
  const baseFolderName = requireString(body, "baseFolderName", 200);

  if (!(await isOrgAdmin(admin, orgId, callerId))) {
    throw new ActionError("Tylko administrator organizacji może to zrobić.", 403);
  }
  if (!graphConfigured()) {
    throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);
  }

  // Weryfikacja: czy podany folder istnieje i jest dostępny dla app-only.
  try {
    await graphFetch(`/drives/${driveId}/items/${baseFolderId}?$select=id,name`);
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "Nie udało się zweryfikować folderu.";
    throw new ActionError(
      `Nie udało się zweryfikować dostępu do SharePoint: ${msg}`,
      200,
    );
  }

  const { data, error } = await admin
    .from("org_storage_connections")
    .upsert(
      {
        org_id: orgId,
        provider: "sharepoint",
        status: "active",
        site_id: siteId,
        drive_id: driveId,
        base_folder_id: baseFolderId,
        base_folder_name: baseFolderName,
        connected_by: callerId,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "org_id,provider" },
    )
    .select()
    .single();
  if (error) throw new ActionError(`Nie udało się zapisać połączenia: ${error.message}`, 500);
  return { connection: rowToConnection(data as Row) };
}

async function actionStorageDisconnect(admin: SupabaseClient, callerId: string, body: Row) {
  const orgId = requireString(body, "orgId");
  if (!(await isOrgAdmin(admin, orgId, callerId))) {
    throw new ActionError("Tylko administrator organizacji może to zrobić.", 403);
  }
  const { error } = await admin
    .from("org_storage_connections")
    .update({ status: "disconnected" })
    .eq("org_id", orgId)
    .eq("provider", "sharepoint");
  if (error) throw new ActionError(`Nie udało się odłączyć magazynu: ${error.message}`, 500);
  return { ok: true };
}

/** Test odczytu + zapisu folderu bazowego SharePoint (admin). */
async function actionStorageProbe(admin: SupabaseClient, callerId: string, body: Row) {
  const orgId = requireString(body, "orgId");
  if (!(await isOrgAdmin(admin, orgId, callerId))) {
    throw new ActionError("Tylko administrator organizacji może to zrobić.", 403);
  }
  if (!graphConfigured()) {
    throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);
  }
  const storage = await getActiveStorage(admin, orgId);
  if (!storage?.driveId || !storage.baseFolderId) {
    throw new ActionError("Brak aktywnego magazynu SharePoint.", 200);
  }
  try {
    await graphFetch(
      `/drives/${storage.driveId}/items/${storage.baseFolderId}?$select=id,name`,
    );
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "Odczyt folderu nie powiódł się.";
    throw new ActionError(`Test odczytu: ${msg}`, 200);
  }
  const probeName = `_dodo_probe_${Date.now()}`;
  let createdId: string | null = null;
  try {
    const created = await createFolder(
      storage.driveId,
      storage.baseFolderId,
      probeName,
    );
    createdId = created.id;
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "Zapis do folderu nie powiódł się.";
    throw new ActionError(`Test zapisu: ${msg}`, 200);
  }
  if (createdId) {
    try {
      await deleteItem(storage.driveId, createdId);
    } catch {
      // best-effort cleanup
    }
  }
  return {
    ok: true,
    read: true,
    write: true,
    siteId: storage.siteId,
    driveId: storage.driveId,
    baseFolderId: storage.baseFolderId,
  };
}

async function actionStorageListOrgsForConversation(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  const conversationId = requireString(body, "conversationId");
  if (!(await isConversationMember(admin, conversationId, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }

  const { data: memberRows } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .is("left_at", null);
  const memberIds = ((memberRows as Row[] | null) ?? []).map((r) => r.user_id as string);
  if (!memberIds.length) return { orgs: [] };

  const { data: myOrgRows } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", callerId);
  const candidateOrgIds = ((myOrgRows as Row[] | null) ?? []).map((r) => r.org_id as string);
  if (!candidateOrgIds.length) return { orgs: [] };

  const { data: allMemberOrgRows } = await admin
    .from("org_members")
    .select("org_id, user_id")
    .in("org_id", candidateOrgIds)
    .in("user_id", memberIds);
  const membersByOrg = new Map<string, Set<string>>();
  for (const row of (allMemberOrgRows as Row[] | null) ?? []) {
    const orgId = row.org_id as string;
    const set = membersByOrg.get(orgId) ?? new Set<string>();
    set.add(row.user_id as string);
    membersByOrg.set(orgId, set);
  }

  // Org kwalifikuje się, gdy WSZYSCY aktywni członkowie rozmowy są też
  // członkami tej organizacji (spójny dostęp do folderu SharePoint).
  const qualifyingOrgIds = candidateOrgIds.filter((orgId) => {
    const set = membersByOrg.get(orgId);
    if (!set) return false;
    return memberIds.every((uid) => set.has(uid));
  });
  if (!qualifyingOrgIds.length) return { orgs: [] };

  // Tylko organizacje z AKTYWNYM magazynem — lista służy jako picker przy
  // tworzeniu galerii (brak wpisu = "brak magazynu" w UI kreatora).
  const { data: activeConns } = await admin
    .from("org_storage_connections")
    .select("org_id, base_folder_name")
    .in("org_id", qualifyingOrgIds)
    .eq("provider", "sharepoint")
    .eq("status", "active")
    .not("base_folder_id", "is", null);
  const activeRows = (activeConns as Row[] | null) ?? [];
  if (!activeRows.length) return { orgs: [] };

  const activeOrgIds = activeRows.map((r) => r.org_id as string);
  let orgById = new Map<string, { name: string; mediaPipeline: "legacy_sp" | "r2_sp" }>();
  {
    const { data: orgRows, error: orgErr } = await admin
      .from("orgs")
      .select("id, name, media_pipeline")
      .in("id", activeOrgIds);
    if (orgErr) {
      // Kolumna media_pipeline może jeszcze nie istnieć (przed migracją 0045).
      const { data: fallback } = await admin
        .from("orgs")
        .select("id, name")
        .in("id", activeOrgIds);
      for (const r of (fallback as Row[] | null) ?? []) {
        orgById.set(r.id as string, {
          name: (r.name as string) ?? "Organizacja",
          mediaPipeline: GLOBAL_DEFAULT_PIPELINE,
        });
      }
    } else {
      for (const r of (orgRows as Row[] | null) ?? []) {
        orgById.set(r.id as string, {
          name: (r.name as string) ?? "Organizacja",
          mediaPipeline: normalizeOrgMediaPipeline(r.media_pipeline as string),
        });
      }
    }
  }

  return {
    orgs: activeRows.map((r) => {
      const org = orgById.get(r.org_id as string);
      return {
        orgId: r.org_id as string,
        orgName: org?.name ?? "Organizacja",
        baseFolderName: (r.base_folder_name as string | null) ?? null,
        mediaPipeline: org?.mediaPipeline ?? GLOBAL_DEFAULT_PIPELINE,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Akcje: galerie
// ---------------------------------------------------------------------------

async function actionGalleryCreate(admin: SupabaseClient, callerId: string, body: Row) {
  const conversationId = requireString(body, "conversationId");
  const orgId = requireString(body, "orgId");
  const title = requireString(body, "title", MAX_TITLE_LEN);
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, MAX_DESCRIPTION_LEN)
      : null;
  const items = parseItems(body.items ?? []);
  const orgPipe = await loadOrgMediaPipeline(admin, orgId);
  const pipeline = resolveOrgGalleryPipeline({
    orgMediaPipeline: orgPipe.pipeline,
    orgReadFailed: orgPipe.failed,
    r2Configured: r2Configured(),
    clientRequestedPipeline: typeof body.pipeline === "string" ? body.pipeline : null,
  });

  if (!(await isConversationMember(admin, conversationId, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  if (!(await isOrgMember(admin, orgId, callerId))) {
    throw new ActionError("Nie należysz do tej organizacji.", 403);
  }

  // R2 pipeline: nie wymaga Graph ani SP na create (hot R2).
  // Legacy wymaga aktywnego SharePoint.
  if (pipeline === "legacy_sp") {
    if (!graphConfigured()) {
      throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);
    }
  } else if (!r2Configured()) {
    throw new ActionError("R2 nie jest skonfigurowany na serwerze.", 200);
  }

  const storage = await getActiveStorage(admin, orgId);
  if (pipeline === "legacy_sp" && !storage) {
    throw new ActionError("Organizacja nie ma aktywnego magazynu plików.", 200);
  }

  const galleryId = crypto.randomUUID();
  const folderName = galleryFolderName(title, galleryId);

  let folderId: string | null = null;
  let folderPath: string | null = null;

  if (pipeline === "legacy_sp") {
    try {
      const galerieFolder = await createFolder(
        storage!.driveId!,
        storage!.baseFolderId!,
        "Galerie",
      );
      const galleryFolder = await createFolder(storage!.driveId!, galerieFolder.id, folderName);
      folderId = galleryFolder.id;
      folderPath = galleryFolder.webUrl ?? null;
      try {
        await ensureThumbnailsFolder(storage!.driveId!, folderId);
      } catch (e) {
        console.warn("[gallery-api] ensure _thumbnails on create failed", e);
      }
    } catch (e) {
      const msg = e instanceof GraphError ? e.message : "Nie udało się utworzyć folderu.";
      throw new ActionError(`Nie udało się utworzyć folderu na SharePoint: ${msg}`, 200);
    }
  } else if (pipeline === "r2_sp" && storage?.driveId && storage.baseFolderId && graphConfigured()) {
    // Best-effort: utwórz folder SP od razu gdy magazyn jest aktywny.
    try {
      const galerieFolder = await createFolder(
        storage.driveId,
        storage.baseFolderId,
        "Galerie",
      );
      const galleryFolder = await createFolder(storage.driveId, galerieFolder.id, folderName);
      folderId = galleryFolder.id;
      folderPath = galleryFolder.webUrl ?? null;
    } catch (e) {
      console.warn("[gallery-api] deferred SP folder on r2_sp create", e);
    }
  }

  const status = items.length ? "uploading" : "draft";
  const { data: galleryRow, error: galleryErr } = await admin
    .from("galleries")
    .insert({
      id: galleryId,
      org_id: orgId,
      conversation_id: conversationId,
      created_by: callerId,
      title,
      description,
      provider: "sharepoint",
      provider_folder_id: folderId,
      provider_folder_path: folderPath,
      status,
      item_count: items.length,
      failed_count: 0,
      pipeline,
    })
    .select()
    .single();
  if (galleryErr || !galleryRow) {
    throw new ActionError(`Nie udało się utworzyć galerii: ${galleryErr?.message}`, 500);
  }

  const messageId = crypto.randomUUID();
  const { error: msgErr } = await admin.from("messages").insert({
    id: messageId,
    conversation_id: conversationId,
    author_user_id: callerId,
    kind: "gallery",
    body: title,
    payload: { gallery: { galleryId } },
    mentions: [],
  });
  if (msgErr) {
    throw new ActionError(`Nie udało się utworzyć wiadomości: ${msgErr.message}`, 500);
  }
  await admin.from("galleries").update({ message_id: messageId }).eq("id", galleryId);

  let insertedItems: Row[] = [];
  if (items.length) {
    const rows = items.map((it, idx) => {
      const id = it.id ?? crypto.randomUUID();
      const base: Record<string, unknown> = {
        id,
        gallery_id: galleryId,
        sort_order: idx,
        file_name: it.fileName,
        mime_type: it.mimeType ?? "image/jpeg",
        size_bytes: it.sizeBytes ?? 0,
        width: it.width ?? null,
        height: it.height ?? null,
        status: "pending",
      };
      if (pipeline === "r2_sp") {
        base.r2_key_full = galleryFullKey(orgId, galleryId, id);
        base.r2_key_thumb = galleryThumbKey(orgId, galleryId, id);
        base.r2_status = "uploading";
        base.sp_status = "none";
        base.sync_operation_id = crypto.randomUUID();
      }
      return base;
    });
    const { data: itemRows, error: itemsErr } = await admin
      .from("gallery_items")
      .insert(rows)
      .select();
    if (itemsErr) {
      throw new ActionError(`Nie udało się zapisać zdjęć: ${itemsErr.message}`, 500);
    }
    insertedItems = (itemRows as Row[]) ?? [];
  }

  return {
    galleryId,
    messageId,
    gallery: rowToGallery({ ...(galleryRow as Row), message_id: messageId, pipeline }),
    items: insertedItems.map(rowToGalleryItem),
    pipeline,
  };
}

async function actionGalleryAddItems(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const items = parseItems(body.items ?? []);

  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }

  const { data: maxRow } = await admin
    .from("gallery_items")
    .select("sort_order")
    .eq("gallery_id", galleryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const startOrder = ((maxRow as Row | null)?.sort_order as number | undefined ?? -1) + 1;

  const rows = items.map((it, idx) => {
    const id = it.id ?? crypto.randomUUID();
    const base: Record<string, unknown> = {
      id,
      gallery_id: galleryId,
      sort_order: startOrder + idx,
      file_name: it.fileName,
      mime_type: it.mimeType ?? "image/jpeg",
      size_bytes: it.sizeBytes ?? 0,
      width: it.width ?? null,
      height: it.height ?? null,
      status: "pending",
    };
    if ((gallery.pipeline as string) === "r2_sp" && r2Configured()) {
      base.r2_key_full = galleryFullKey(gallery.org_id as string, galleryId, id);
      base.r2_key_thumb = galleryThumbKey(gallery.org_id as string, galleryId, id);
      base.r2_status = "uploading";
      base.sp_status = "none";
      base.sync_operation_id = crypto.randomUUID();
    }
    return base;
  });
  const { data: itemRows, error } = await admin.from("gallery_items").insert(rows).select();
  if (error) throw new ActionError(`Nie udało się dodać zdjęć: ${error.message}`, 500);

  const updatedGallery = await recomputeGalleryCounts(admin, galleryId);
  return {
    items: ((itemRows as Row[]) ?? []).map(rowToGalleryItem),
    gallery: rowToGallery(updatedGallery),
  };
}

async function actionGalleryUploadItem(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const itemId = requireString(body, "itemId");

  let bytes: Uint8Array | null = null;
  if (body.contentBytes instanceof Uint8Array) {
    bytes = body.contentBytes;
  } else if (typeof body.contentBase64 === "string" && body.contentBase64) {
    try {
      bytes = decodeBase64(body.contentBase64);
    } catch {
      bytes = null;
    }
  }
  if (!bytes) {
    throw new ActionError('Pole "file" (multipart) lub "contentBase64" jest wymagane.', 400);
  }

  let thumbBytes: Uint8Array | null = null;
  const skipThumb =
    body.skipThumb === true ||
    body.skipThumb === "1" ||
    body.skipThumb === "true";
  if (!skipThumb) {
    if (body.thumbBytes instanceof Uint8Array) {
      thumbBytes = body.thumbBytes;
    } else if (typeof body.thumbBase64 === "string" && body.thumbBase64) {
      try {
        thumbBytes = decodeBase64(body.thumbBase64);
      } catch {
        thumbBytes = null;
      }
    }
  }
  const thumbMimeType =
    typeof body.thumbMimeType === "string" && body.thumbMimeType
      ? body.thumbMimeType
      : "image/webp";
  const doRecompute =
    body.recompute !== false &&
    body.recompute !== "0" &&
    body.recompute !== "false";

  const overrideFileName =
    typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim().slice(0, 200)
      : null;
  const overrideMime =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : null;
  const overrideWidth =
    typeof body.width === "number"
      ? body.width
      : typeof body.width === "string" && body.width
        ? Number(body.width)
        : null;
  const overrideHeight =
    typeof body.height === "number"
      ? body.height
      : typeof body.height === "string" && body.height
        ? Number(body.height)
        : null;

  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }

  const { data: itemRow } = await admin
    .from("gallery_items")
    .select("*")
    .eq("id", itemId)
    .eq("gallery_id", galleryId)
    .maybeSingle();
  if (!itemRow) throw new ActionError("Zdjęcie nie istnieje.", 404);
  const item = itemRow as Row;

  const markFailed = async (errorCode: string, errorMessage: string) => {
    await admin
      .from("gallery_items")
      .update({ status: "failed", error_code: errorCode, error_message: errorMessage })
      .eq("id", itemId);
    const updatedGallery = await recomputeGalleryCounts(admin, galleryId);
    return { gallery: rowToGallery(updatedGallery) };
  };

  // Soft reject: stary/niezgodny klient — NIE markFailed (409).
  const wrongPipe = legacyUploadItemRejectionForPipeline(gallery.pipeline as string);
  if (wrongPipe) {
    console.warn("[gallery-api] wrong_pipeline soft-reject", {
      galleryId,
      itemId,
      galleryPipeline: gallery.pipeline,
      errorCode: wrongPipe.errorCode,
    });
    try {
      await admin
        .from("gallery_items")
        .update({
          sync_last_error: "wrong_pipeline: legacy gallery_upload_item rejected (soft)",
        })
        .eq("id", itemId)
        .eq("gallery_id", galleryId);
    } catch (e) {
      console.warn("[gallery-api] wrong_pipeline diag write failed", e);
    }
    throw new ActionError(wrongPipe.errorMessage, wrongPipe.httpStatus, wrongPipe.errorCode);
  }

  const storage = await getActiveStorage(admin, gallery.org_id as string);
  if (!storage || !gallery.provider_folder_id) {
    const { gallery: g } = await markFailed("no_storage", "Magazyn plików niedostępny.");
    return { item: rowToGalleryItem({ ...item, status: "failed" }), gallery: g };
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    const { gallery: g } = await markFailed(
      "too_large",
      `Plik przekracza limit ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    );
    return { item: rowToGalleryItem({ ...item, status: "failed" }), gallery: g };
  }

  const fileName = overrideFileName || (item.file_name as string);
  const mimeType = overrideMime || (item.mime_type as string) || "image/jpeg";

  await admin
    .from("gallery_items")
    .update({
      status: "uploading",
      file_name: fileName,
      mime_type: mimeType,
      ...(Number.isFinite(overrideWidth) ? { width: overrideWidth } : {}),
      ...(Number.isFinite(overrideHeight) ? { height: overrideHeight } : {}),
    })
    .eq("id", itemId);

  try {
    // Miniatura: przygotuj folder raz, potem main+thumb równolegle do Graph.
    let thumbsFolderId: string | null = null;
    let thumbStatus: string = skipThumb || !thumbBytes ? "skipped" : "pending";
    if (thumbBytes && thumbBytes.byteLength > 0 && thumbBytes.byteLength <= MAX_UPLOAD_BYTES) {
      try {
        thumbsFolderId = await ensureThumbnailsFolder(
          storage.driveId!,
          gallery.provider_folder_id as string,
        );
      } catch {
        thumbStatus = "failed";
        thumbsFolderId = null;
      }
    } else if (!skipThumb) {
      thumbStatus = "failed";
    }

    const mainUpload = uploadSmallFile(
      storage.driveId!,
      gallery.provider_folder_id as string,
      fileName,
      bytes,
      mimeType,
    );

    const thumbUpload =
      thumbsFolderId && thumbBytes && thumbStatus !== "failed"
        ? uploadSmallFile(
          storage.driveId!,
          thumbsFolderId,
          thumbFileName(itemId, thumbMimeType),
          thumbBytes,
          thumbMimeType,
        ).then(
          (u) => ({ ok: true as const, id: u.id }),
          () => ({ ok: false as const }),
        )
        : Promise.resolve(null);

    const [uploaded, thumbResult] = await Promise.all([mainUpload, thumbUpload]);

    let providerThumbItemId: string | null = null;
    if (thumbResult?.ok) {
      providerThumbItemId = thumbResult.id;
      thumbStatus = "ready";
    } else if (thumbResult && !thumbResult.ok) {
      thumbStatus = "failed";
    }

    const { data: updatedRow } = await admin
      .from("gallery_items")
      .update({
        status: "ready",
        provider_item_id: uploaded.id,
        size_bytes: uploaded.size ?? bytes.byteLength,
        provider_thumb_item_id: providerThumbItemId,
        thumb_status: thumbStatus,
        error_code: null,
        error_message: null,
      })
      .eq("id", itemId)
      .select()
      .single();

    const updatedGallery = doRecompute
      ? await recomputeGalleryCounts(admin, galleryId)
      : gallery;
    return {
      item: rowToGalleryItem(updatedRow as Row),
      gallery: rowToGallery(updatedGallery),
    };
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "Nie udało się wysłać pliku.";
    const code = e instanceof GraphError ? String(e.status) : "upload_failed";
    const { gallery: g } = await markFailed(code, msg);
    return { item: rowToGalleryItem({ ...item, status: "failed", error_message: msg }), gallery: g };
  }
}

/** Ponowna wysyłka samej miniatury do `{folder}/_thumbnails/{itemId}.webp`. */
async function actionGalleryUploadThumb(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const itemId = requireString(body, "itemId");
  const thumbBase64Raw = typeof body.thumbBase64 === "string" ? body.thumbBase64 : "";
  const thumbMimeType =
    typeof body.thumbMimeType === "string" && body.thumbMimeType
      ? body.thumbMimeType
      : "image/webp";

  let thumbBytes: Uint8Array | null = null;
  if (body.thumbBytes instanceof Uint8Array) {
    thumbBytes = body.thumbBytes;
  } else if (thumbBase64Raw) {
    try {
      thumbBytes = decodeBase64(thumbBase64Raw);
    } catch {
      throw new ActionError("Nieprawidłowe dane miniatury.", 200);
    }
  }
  if (!thumbBytes) throw new ActionError("Brak danych miniatury.", 200);

  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  const { data: itemRow } = await admin
    .from("gallery_items")
    .select("*")
    .eq("id", itemId)
    .eq("gallery_id", galleryId)
    .maybeSingle();
  if (!itemRow) throw new ActionError("Zdjęcie nie istnieje.", 404);
  const item = itemRow as Row;
  if (item.status !== "ready" || !item.provider_item_id) {
    throw new ActionError("Najpierw musi być gotowe zdjęcie główne.", 200);
  }

  const storage = await getActiveStorage(admin, gallery.org_id as string);
  if (!storage || !gallery.provider_folder_id) {
    throw new ActionError("Magazyn plików niedostępny.", 200);
  }
  if (!graphConfigured()) throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);

  if (thumbBytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new ActionError("Miniatura przekracza limit rozmiaru.", 200);
  }

  try {
    const thumbsFolderId = await ensureThumbnailsFolder(
      storage.driveId!,
      gallery.provider_folder_id as string,
    );
    const thumbUploaded = await uploadSmallFile(
      storage.driveId!,
      thumbsFolderId,
      thumbFileName(itemId, thumbMimeType),
      thumbBytes,
      thumbMimeType,
    );
    const { data: updatedRow } = await admin
      .from("gallery_items")
      .update({
        provider_thumb_item_id: thumbUploaded.id,
        thumb_status: "ready",
      })
      .eq("id", itemId)
      .select()
      .single();
    const updatedGallery = await recomputeGalleryCounts(admin, galleryId);
    return {
      item: rowToGalleryItem(updatedRow as Row),
      gallery: rowToGallery(updatedGallery),
    };
  } catch (e) {
    await admin
      .from("gallery_items")
      .update({ thumb_status: "failed" })
      .eq("id", itemId);
    const msg = e instanceof GraphError ? e.message : "Nie udało się wysłać miniatury.";
    throw new ActionError(msg, 200);
  }
}

async function actionGalleryRecompute(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  const updated = await recomputeGalleryCounts(admin, galleryId);
  return { gallery: rowToGallery(updated) };
}

async function actionGalleryGet(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  const { data: items } = await admin
    .from("gallery_items")
    .select("*")
    .eq("gallery_id", galleryId)
    .order("sort_order", { ascending: true });
  return {
    gallery: rowToGallery(gallery),
    items: ((items as Row[]) ?? []).map(rowToGalleryItem),
  };
}

async function actionGalleryItemUrl(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const itemId = requireString(body, "itemId");
  const variantRaw = typeof body.variant === "string" ? body.variant : "thumb";
  const variant = variantRaw === "full" ? "full" : "thumb";

  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  const { data: itemRow } = await admin
    .from("gallery_items")
    .select("*")
    .eq("id", itemId)
    .eq("gallery_id", galleryId)
    .maybeSingle();
  if (!itemRow) throw new ActionError("Zdjęcie nie istnieje.", 404);
  const item = itemRow as Row;

  const r2Deleted = item.r2_status === "deleted" || Boolean(item.r2_deleted_at);
  const driveItemId =
    (item.sp_drive_item_id as string | null) ||
    (item.provider_item_id as string | null);

  const source = resolveDualReadSource({
    pipeline: gallery.pipeline as string | null,
    r2Status: item.r2_status as string | null,
    r2Deleted,
    r2Key: item.r2_key_full as string | null,
    providerItemId: driveItemId,
    variant,
    r2KeyThumb: item.r2_key_thumb as string | null,
  });

  if (source === "none") {
    throw new ActionError("Zdjęcie jeszcze nie jest gotowe.", 200);
  }

  if (source === "r2" && r2Configured()) {
    try {
      if (variant === "thumb") {
        const thumbKey = item.r2_key_thumb as string | null;
        if (thumbKey) {
          const url = await presignR2Url({
            key: thumbKey,
            method: "GET",
            expiresInSec: PRESIGN_TTL_SEC,
          });
          return { url, variant: "thumb", source: "r2" };
        }
      }
      if (!r2Deleted && item.r2_key_full) {
        const url = await presignR2Url({
          key: item.r2_key_full as string,
          method: "GET",
          expiresInSec: PRESIGN_TTL_SEC,
        });
        return { url, variant: "full", source: "r2" };
      }
    } catch (e) {
      console.warn("[gallery-api] R2 presign GET failed, fallback Graph", e);
      if (!driveItemId) {
        throw new ActionError("Nie udało się pobrać adresu pliku.", 200);
      }
      // fall through to SharePoint
    }
  }

  // Legacy / cold: SharePoint Graph
  const storage = await getActiveStorage(admin, gallery.org_id as string);
  if (!storage) {
    if (source === "r2" && item.r2_key_full && !r2Deleted && r2Configured()) {
      const url = await presignR2Url({
        key: item.r2_key_full as string,
        method: "GET",
        expiresInSec: PRESIGN_TTL_SEC,
      });
      return { url, variant: "full", source: "r2" };
    }
    throw new ActionError("Magazyn plików niedostępny.", 200);
  }

  if (!graphConfigured()) throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);

  const hasThumb =
    item.thumb_status === "ready" &&
    typeof item.provider_thumb_item_id === "string" &&
    item.provider_thumb_item_id;

  try {
    if (variant === "thumb") {
      if (hasThumb) {
        const url = await getDownloadUrl(storage.driveId!, item.provider_thumb_item_id as string);
        return { url, variant: "thumb", source: "sharepoint" };
      }
      const thumbStatus = (item.thumb_status as string | null) ?? "pending";
      if (thumbStatus === "failed" || thumbStatus === "skipped") {
        return { url: null, variant: "thumb", source: "sharepoint" };
      }
    }
    if (!driveItemId) throw new ActionError("Zdjęcie jeszcze nie jest gotowe.", 200);
    const url = await getDownloadUrl(storage.driveId!, driveItemId);
    return { url, variant: "full", source: "sharepoint" };
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "Nie udało się pobrać adresu pliku.";
    throw new ActionError(msg, 200);
  }
}

async function actionGallerySoftDelete(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  const isAdmin = await isOrgAdmin(admin, gallery.org_id as string, callerId);
  if (!canManageGallery(gallery, callerId, isAdmin)) {
    throw new ActionError("Tylko autor lub administrator może usunąć galerię.", 403);
  }
  const { error } = await admin
    .from("galleries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", galleryId);
  if (error) throw new ActionError(`Nie udało się usunąć galerii: ${error.message}`, 500);
  return { ok: true };
}

async function actionGalleryDeleteStorage(admin: SupabaseClient, callerId: string, body: Row) {
  const galleryId = requireString(body, "galleryId");
  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  const isAdmin = await isOrgAdmin(admin, gallery.org_id as string, callerId);
  if (!canManageGallery(gallery, callerId, isAdmin)) {
    throw new ActionError("Tylko autor lub administrator może usunąć galerię.", 403);
  }

  let warning: string | undefined;
  if (gallery.provider_folder_id) {
    const storage = await getActiveStorage(admin, gallery.org_id as string);
    if (storage && graphConfigured()) {
      try {
        await deleteItem(storage.driveId!, gallery.provider_folder_id as string);
      } catch (e) {
        warning = e instanceof GraphError ? e.message : "Nie udało się usunąć folderu na SharePoint.";
      }
    } else {
      warning = "Magazyn plików niedostępny — usunięto tylko wpis galerii.";
    }
  }

  const { error } = await admin
    .from("galleries")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", galleryId);
  if (error) throw new ActionError(`Nie udało się usunąć galerii: ${error.message}`, 500);
  return { ok: true, warning };
}

// ---------------------------------------------------------------------------
// Akcje: R2 presign / confirm (galerie + załączniki) + cleanup
// ---------------------------------------------------------------------------

async function actionMediaPipelineInfo(_admin: SupabaseClient, _callerId: string, _body: Row) {
  return {
    globalDefault: GLOBAL_DEFAULT_PIPELINE,
    attachmentsR2Enabled: r2Configured(),
    r2Configured: r2Configured(),
    graphConfigured: graphConfigured(),
    galleryFullRetentionDays: GALLERY_FULL_RETENTION_DAYS,
    attachmentRetentionDays: ATTACHMENT_RETENTION_DAYS,
  };
}

async function actionOrgMediaPipelineGet(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  const orgId = requireString(body, "orgId");
  if (!(await isOrgMember(admin, orgId, callerId))) {
    throw new ActionError("Nie należysz do tej organizacji.", 403);
  }
  const orgPipe = await loadOrgMediaPipeline(admin, orgId);
  return { mediaPipeline: orgPipe.pipeline };
}

async function actionOrgMediaPipelineSet(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  const orgId = requireString(body, "orgId");
  if (!(await isOrgAdmin(admin, orgId, callerId))) {
    throw new ActionError("Tylko administrator organizacji może to zrobić.", 403);
  }
  const raw = typeof body.mediaPipeline === "string" ? body.mediaPipeline : "";
  if (raw !== "legacy_sp" && raw !== "r2_sp") {
    throw new ActionError('Pole "mediaPipeline" musi być "legacy_sp" lub "r2_sp".', 400);
  }
  const mediaPipeline = normalizeOrgMediaPipeline(raw);
  const { data, error } = await admin
    .from("orgs")
    .update({ media_pipeline: mediaPipeline })
    .eq("id", orgId)
    .select("media_pipeline")
    .single();
  if (error) {
    throw new ActionError(`Nie udało się zapisać pipeline: ${error.message}`, 500);
  }
  return {
    mediaPipeline: normalizeOrgMediaPipeline(data?.media_pipeline as string),
  };
}

/** Po admin retry — od razu wrzuć job do kolejki Workera. */
async function actionMediaEnqueueGalleryItem(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  const itemId = requireString(body, "itemId");
  const { data: item } = await admin
    .from("gallery_items")
    .select("id, gallery_id, r2_status, sync_operation_id, galleries!inner(org_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) throw new ActionError("Pozycja nie istnieje.", 404);
  const orgId = (item.galleries as { org_id?: string } | null)?.org_id;
  if (!orgId || !(await isOrgAdmin(admin, orgId, callerId))) {
    throw new ActionError("Tylko administrator zespołu.", 403);
  }
  if (item.r2_status !== "ready") {
    throw new ActionError("Brak pliku w R2.", 200);
  }
  const { data: jobRow } = await admin
    .from("media_sync_jobs")
    .select("id")
    .eq("ref_id", itemId)
    .eq("kind", "gallery_full")
    .in("state", ["pending", "running", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await enqueueMediaSync({
    kind: "gallery_full",
    refId: itemId,
    galleryId: item.gallery_id as string,
    orgId,
    opId: (item.sync_operation_id as string) ?? undefined,
    ...(jobRow?.id ? { jobId: jobRow.id as string } : {}),
  });
  return { ok: true };
}

/** Krótkotrwały GET dla klucza R2 — po weryfikacji membership. */
async function actionR2SignedGet(admin: SupabaseClient, callerId: string, body: Row) {
  if (!r2Configured()) throw new ActionError("R2 nie jest skonfigurowany.", 200);
  const key = requireString(body, "key", 512);
  if (!key.startsWith("hot/teams/")) {
    throw new ActionError("Nieprawidłowy klucz.", 400);
  }
  // hot/teams/{orgId}/galleries/{galleryId}/...
  // hot/teams/{orgId}/attachments/{conversationId}/...
  const parts = key.split("/");
  const orgId = parts[2];
  if (!orgId) throw new ActionError("Nieprawidłowy klucz.", 400);

  if (parts[3] === "galleries") {
    const galleryId = parts[4];
    if (!galleryId) throw new ActionError("Nieprawidłowy klucz.", 400);
    const gallery = await loadGallery(admin, galleryId);
    if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
      throw new ActionError("Brak dostępu.", 403);
    }
  } else if (parts[3] === "attachments") {
    const conversationId = parts[4];
    if (!conversationId) throw new ActionError("Nieprawidłowy klucz.", 400);
    if (!(await isConversationMember(admin, conversationId, callerId))) {
      throw new ActionError("Brak dostępu.", 403);
    }
  } else {
    throw new ActionError("Nieprawidłowy klucz.", 400);
  }

  const url = await presignR2Url({ key, method: "GET", expiresInSec: PRESIGN_TTL_SEC });
  return { url, expiresInSec: PRESIGN_TTL_SEC };
}

async function actionR2PresignGalleryItems(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  if (!r2Configured()) throw new ActionError("R2 nie jest skonfigurowany na serwerze.", 200);
  const galleryId = requireString(body, "galleryId");
  const gallery = await loadGallery(admin, galleryId);
  if (!(await isConversationMember(admin, gallery.conversation_id as string, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  if ((gallery.pipeline as string) !== "r2_sp") {
    throw new ActionError("Ta galeria nie używa pipeline R2.", 200);
  }

  const itemIds = Array.isArray(body.itemIds)
    ? (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;

  let q = admin.from("gallery_items").select("*").eq("gallery_id", galleryId);
  if (itemIds?.length) q = q.in("id", itemIds);
  const { data: items } = await q;
  const rows = (items as Row[]) ?? [];

  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SEC * 1000).toISOString();
  const out = [];
  const orgId = gallery.org_id as string;
  for (const it of rows) {
    // Klucze zawsze z org/gallery z DB — nigdy z body.orgId.
    const fullKey = galleryFullKey(orgId, galleryId, it.id as string);
    const thumbKey = galleryThumbKey(orgId, galleryId, it.id as string);

    if (!it.r2_key_full || it.r2_key_full !== fullKey || it.r2_key_thumb !== thumbKey) {
      await admin
        .from("gallery_items")
        .update({
          r2_key_full: fullKey,
          r2_key_thumb: thumbKey,
          r2_status: (it.r2_status as string) === "ready" ? "ready" : "uploading",
          sync_operation_id: it.sync_operation_id ?? crypto.randomUUID(),
        })
        .eq("id", it.id);
    }

    const putUrlFull = await presignR2Url({
      key: fullKey,
      method: "PUT",
      expiresInSec: PRESIGN_TTL_SEC,
      contentType: "image/jpeg",
    });
    const putUrlThumb = await presignR2Url({
      key: thumbKey,
      method: "PUT",
      expiresInSec: PRESIGN_TTL_SEC,
      contentType: "image/webp",
    });
    out.push({
      itemId: it.id,
      putUrlFull,
      putUrlThumb,
      r2KeyFull: fullKey,
      r2KeyThumb: thumbKey,
      headers: { full: { "content-type": "image/jpeg" }, thumb: { "content-type": "image/webp" } },
      expiresAt,
    });
  }
  return { items: out, expiresAt };
}

async function actionR2ConfirmGalleryItem(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  if (!r2Configured()) throw new ActionError("R2 nie jest skonfigurowany na serwerze.", 200);
  const galleryId = requireString(body, "galleryId");
  const itemId = requireString(body, "itemId");
  const gallery = await loadGallery(admin, galleryId);
  const isMember = await isConversationMember(
    admin,
    gallery.conversation_id as string,
    callerId,
  );
  if (!isMember) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }

  const { data: itemRow } = await admin
    .from("gallery_items")
    .select("*")
    .eq("id", itemId)
    .eq("gallery_id", galleryId)
    .maybeSingle();
  if (!itemRow) throw new ActionError("Zdjęcie nie istnieje.", 404);
  const item = itemRow as Row;

  const fullKey = item.r2_key_full as string | null;
  if (!fullKey) throw new ActionError("Brak klucza R2 — najpierw presign.", 400);

  try {
    assertGalleryFullKeyScope(fullKey, {
      orgId: gallery.org_id as string,
      galleryId,
      itemId,
    });
  } catch {
    throw new ActionError("Klucz R2 poza zakresem galerii / zespołu.", 403);
  }

  const keyOrgId = orgIdFromHotKey(fullKey);
  const authz = authorizeGalleryMediaAccess({
    isConversationMember: isMember,
    galleryOrgId: gallery.org_id as string,
    keyOrgIdFromPath: keyOrgId ?? "",
  });
  if (!authz.ok) {
    throw new ActionError("Brak dostępu do mediów galerii.", 403);
  }

  const head = await headR2Object(fullKey);
  const expectedSize =
    typeof body.sizeBytes === "number" ? (body.sizeBytes as number) : null;
  const headCheck = validateConfirmHead({
    objectExists: head.exists,
    actualSize: head.size,
    expectedSize,
  });
  if (!headCheck.ok) {
    if (headCheck.reason === "missing_object") {
      throw new ActionError("Plik nie znaleziony w R2 — dokończ upload.", 200);
    }
    if (headCheck.reason === "size_mismatch") {
      throw new ActionError("Niezgodny rozmiar pliku w R2.", 200);
    }
    throw new ActionError("Nieprawidłowy klucz R2.", 400);
  }

  const thumbKey = item.r2_key_thumb as string | null;
  let thumbExists = false;
  if (thumbKey) {
    const thumbHead = await headR2Object(thumbKey);
    thumbExists = thumbHead.exists;
  }
  const thumbStatus = resolveThumbStatusAfterConfirm({
    thumbKey,
    thumbExists,
  });

  const alreadyReady = item.r2_status === "ready";
  const spAlreadyQueuedOrVerified =
    item.sp_status === "queued" || item.sp_status === "verified";

  const opId = (item.sync_operation_id as string) || crypto.randomUUID();
  const fileName =
    typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim()
      : (item.file_name as string);
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : (item.mime_type as string) || "image/jpeg";

  const { data: updatedRow } = await admin
    .from("gallery_items")
    .update({
      status: "ready",
      r2_status: "ready",
      r2_etag: head.etag,
      r2_size_bytes: head.size,
      size_bytes: head.size ?? item.size_bytes,
      file_name: fileName,
      mime_type: mimeType,
      thumb_status: thumbStatus,
      sp_status: spAlreadyQueuedOrVerified
        ? (item.sp_status as string)
        : "queued",
      sync_operation_id: opId,
      sync_next_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      ...(Number.isFinite(body.width as number) ? { width: body.width } : {}),
      ...(Number.isFinite(body.height as number) ? { height: body.height } : {}),
    })
    .eq("id", itemId)
    .select()
    .single();

  const { data: existingJobRows } = await admin
    .from("media_sync_jobs")
    .select("id, kind, ref_id, state, payload")
    .eq("ref_id", itemId)
    .eq("kind", "gallery_full");

  const existingJobs = ((existingJobRows as Row[] | null) ?? []).map((j) => {
    const payload = (j.payload as Row | null) ?? null;
    return {
      kind: j.kind as string,
      refId: j.ref_id as string,
      opId: typeof payload?.opId === "string" ? (payload.opId as string) : null,
      state: j.state as string,
    };
  });

  const createJob = shouldCreateSyncJob({
    existingJobs,
    kind: "gallery_full",
    refId: itemId,
    opId,
  });

  let enqueuedJobId: string | undefined;
  // Re-confirm gdy already ready + SP queued/verified → sukces, bez duplikatu joba.
  if (createJob && !(alreadyReady && spAlreadyQueuedOrVerified)) {
    const { data: insertedJob } = await admin
      .from("media_sync_jobs")
      .insert({
        kind: "gallery_full",
        ref_id: itemId,
        state: "pending",
        payload: {
          galleryId,
          orgId: gallery.org_id,
          opId,
          r2Key: fullKey,
        },
      })
      .select("id")
      .single();
    enqueuedJobId =
      insertedJob && typeof (insertedJob as Row).id === "string"
        ? ((insertedJob as Row).id as string)
        : undefined;
  } else {
    const pending = ((existingJobRows as Row[] | null) ?? []).find(
      (j) => j.state === "pending" || j.state === "running" || j.state === "failed",
    );
    if (pending && typeof pending.id === "string") {
      enqueuedJobId = pending.id as string;
    }
  }

  // Zawsze enqueue — idempotentny consumer obsłuży duplikaty.
  await enqueueMediaSync({
    kind: "gallery_full",
    refId: itemId,
    galleryId,
    orgId: gallery.org_id as string,
    opId,
    ...(enqueuedJobId ? { jobId: enqueuedJobId } : {}),
  });

  const doRecompute = body.recompute !== false;
  const g = doRecompute
    ? await recomputeGalleryCounts(admin, galleryId)
    : gallery;

  return {
    item: rowToGalleryItem((updatedRow as Row) ?? item),
    gallery: rowToGallery(g),
    r2Ready: true,
  };
}

async function actionR2PresignAttachment(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  if (!r2Configured()) throw new ActionError("R2 nie jest skonfigurowany na serwerze.", 200);
  const conversationId = requireString(body, "conversationId");
  const messageId = requireString(body, "messageId");
  const orgId = requireString(body, "orgId");
  const attachmentId = requireString(body, "attachmentId");
  const fileName = requireString(body, "fileName", 200);
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim().slice(0, 120)
      : "application/octet-stream";
  const withThumb = body.withThumb === true;

  if (!(await isConversationMember(admin, conversationId, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  if (!(await isOrgMember(admin, orgId, callerId))) {
    throw new ActionError("Nie należysz do tej organizacji.", 403);
  }

  const orgPipe = await loadOrgMediaPipeline(admin, orgId);
  const pipe = resolveAttachmentPipeline({
    orgMediaPipeline: orgPipe.pipeline,
    r2Configured: r2Configured(),
  });
  if (pipe !== "r2_sp") {
    throw new ActionError(
      "Pipeline R2 dla załączników jest wyłączony dla tego zespołu — użyj legacy Storage.",
      200,
    );
  }

  const r2Key = attachmentKey(orgId, conversationId, messageId, attachmentId, fileName);
  const r2KeyThumb = withThumb
    ? attachmentThumbKey(orgId, conversationId, messageId, attachmentId)
    : null;

  const putUrl = await presignR2Url({
    key: r2Key,
    method: "PUT",
    contentType: mimeType,
    expiresInSec: PRESIGN_TTL_SEC,
  });
  let putUrlThumb: string | null = null;
  if (r2KeyThumb) {
    putUrlThumb = await presignR2Url({
      key: r2KeyThumb,
      method: "PUT",
      contentType: "image/webp",
      expiresInSec: PRESIGN_TTL_SEC,
    });
  }

  return {
    putUrl,
    putUrlThumb,
    r2Key,
    r2KeyThumb,
    headers: { "content-type": mimeType },
    thumbHeaders: r2KeyThumb ? { "content-type": "image/webp" } : null,
    expiresInSec: PRESIGN_TTL_SEC,
  };
}

async function actionR2ConfirmAttachment(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  if (!r2Configured()) throw new ActionError("R2 nie jest skonfigurowany na serwerze.", 200);
  const conversationId = requireString(body, "conversationId");
  const messageId = requireString(body, "messageId");
  const orgId = requireString(body, "orgId");
  const attachmentId = requireString(body, "attachmentId");
  const r2Key = requireString(body, "r2Key", 512);
  const fileName = requireString(body, "fileName", 200);
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim().slice(0, 120)
      : "application/octet-stream";
  const r2KeyThumb =
    typeof body.r2KeyThumb === "string" && body.r2KeyThumb.trim()
      ? body.r2KeyThumb.trim()
      : null;
  const sizeBytes =
    typeof body.sizeBytes === "number" && Number.isFinite(body.sizeBytes)
      ? (body.sizeBytes as number)
      : null;
  const width =
    typeof body.width === "number" && Number.isFinite(body.width) ? (body.width as number) : null;
  const height =
    typeof body.height === "number" && Number.isFinite(body.height)
      ? (body.height as number)
      : null;

  if (!(await isConversationMember(admin, conversationId, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }

  const orgPipe = await loadOrgMediaPipeline(admin, orgId);
  const pipe = resolveAttachmentPipeline({
    orgMediaPipeline: orgPipe.pipeline,
    r2Configured: r2Configured(),
  });
  if (pipe !== "r2_sp") {
    throw new ActionError("Pipeline R2 dla załączników jest wyłączony dla tego zespołu.", 200);
  }

  const expectedKey = attachmentKey(orgId, conversationId, messageId, attachmentId, fileName);
  if (r2Key !== expectedKey) {
    throw new ActionError("Klucz R2 poza zakresem załącznika.", 403);
  }

  const head = await headR2Object(r2Key);
  const headCheck = validateConfirmHead({
    objectExists: head.exists,
    actualSize: head.size,
    expectedSize: sizeBytes,
  });
  if (!headCheck.ok) {
    if (headCheck.reason === "missing_object") {
      throw new ActionError("Plik nie znaleziony w R2 — dokończ upload.", 200);
    }
    if (headCheck.reason === "size_mismatch") {
      throw new ActionError("Niezgodny rozmiar pliku w R2.", 200);
    }
    throw new ActionError("Nieprawidłowy klucz R2.", 400);
  }

  let thumbExists = false;
  if (r2KeyThumb) {
    const th = await headR2Object(r2KeyThumb);
    thumbExists = th.exists;
  }

  const opId = crypto.randomUUID();
  const { data: existing } = await admin
    .from("message_attachments")
    .select("id, r2_status, sp_status, sync_operation_id")
    .eq("id", attachmentId)
    .maybeSingle();

  const rowPayload = {
    id: attachmentId,
    message_id: messageId,
    bucket_path: r2Key,
    thumb_path: thumbExists && r2KeyThumb ? r2KeyThumb : null,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes ?? head.size ?? 0,
    width,
    height,
    pipeline: "r2_sp",
    org_id: orgId,
    r2_key: r2Key,
    r2_key_thumb: thumbExists && r2KeyThumb ? r2KeyThumb : null,
    r2_etag: head.etag ?? null,
    r2_size_bytes: head.size ?? sizeBytes,
    r2_status: "ready",
    sp_status: "queued",
    sync_operation_id: opId,
    sync_next_at: new Date().toISOString(),
    retention_days: ATTACHMENT_RETENTION_DAYS,
  };

  if (existing) {
    const { error } = await admin
      .from("message_attachments")
      .update(rowPayload)
      .eq("id", attachmentId);
    if (error) throw new ActionError(`Confirm failed: ${error.message}`, 500);
  } else {
    const { error } = await admin.from("message_attachments").insert(rowPayload);
    if (error) throw new ActionError(`Confirm failed: ${error.message}`, 500);
  }

  const { data: existingJobRows } = await admin
    .from("media_sync_jobs")
    .select("id, kind, ref_id, state, payload")
    .eq("ref_id", attachmentId)
    .eq("kind", "attachment");

  const existingJobs = ((existingJobRows as Row[] | null) ?? []).map((j) => {
    const payload = (j.payload as Row | null) ?? null;
    return {
      kind: j.kind as string,
      refId: j.ref_id as string,
      opId: typeof payload?.opId === "string" ? (payload.opId as string) : null,
      state: j.state as string,
    };
  });

  let jobId: string | undefined;
  if (
    shouldCreateSyncJob({
      existingJobs,
      kind: "attachment",
      refId: attachmentId,
      opId,
    })
  ) {
    const { data: insertedJob } = await admin
      .from("media_sync_jobs")
      .insert({
        kind: "attachment",
        ref_id: attachmentId,
        state: "pending",
        payload: { orgId, conversationId, messageId, opId, r2Key },
      })
      .select("id")
      .single();
    jobId =
      insertedJob && typeof (insertedJob as Row).id === "string"
        ? ((insertedJob as Row).id as string)
        : undefined;
  } else {
    const pending = ((existingJobRows as Row[] | null) ?? []).find(
      (j) => j.state === "pending" || j.state === "running" || j.state === "failed",
    );
    if (pending && typeof pending.id === "string") jobId = pending.id as string;
  }

  await enqueueMediaSync({
    kind: "attachment",
    refId: attachmentId,
    orgId,
    opId,
    ...(jobId ? { jobId } : {}),
  });

  return {
    attachment: {
      id: attachmentId,
      messageId,
      bucketPath: r2Key,
      thumbPath: thumbExists && r2KeyThumb ? r2KeyThumb : null,
      fileName,
      mimeType,
      sizeBytes: sizeBytes ?? head.size ?? 0,
      width,
      height,
      pipeline: "r2_sp",
      r2Key,
      r2KeyThumb: thumbExists && r2KeyThumb ? r2KeyThumb : null,
      r2Status: "ready",
      spStatus: "queued",
    },
    r2Ready: true,
  };
}

/** Cleanup R2: tylko verified + po terminie retencji. Service/admin. */
async function actionMediaCleanupR2(admin: SupabaseClient, callerId: string, body: Row) {
  if (!r2Configured()) throw new ActionError("R2 nie jest skonfigurowany.", 200);

  const orgId =
    typeof body.orgId === "string" && body.orgId ? body.orgId : null;
  if (orgId) {
    if (!(await isOrgAdmin(admin, orgId, callerId))) {
      throw new ActionError("Tylko administrator może uruchomić cleanup.", 403);
    }
  } else {
    // Global cleanup — tylko gdy wywołane z hooka Workera (service role caller
    // nie ma auth.uid w tym samym sensie; tu wymagamy orgId z klienta admin).
    throw new ActionError("Podaj orgId.", 400);
  }

  const nowIso = new Date().toISOString();
  const limit = Math.min(Number(body.limit ?? 50), 200);
  let deleted = 0;
  const errors: string[] = [];

  let gq = admin
    .from("gallery_items")
    .select(
      "id, r2_key_full, r2_status, sp_status, r2_deleted_at, r2_delete_after, retention_hold, galleries!inner(org_id)",
    )
    .eq("r2_status", "ready")
    .eq("sp_status", "verified")
    .eq("retention_hold", false)
    .is("r2_deleted_at", null)
    .lt("r2_delete_after", nowIso)
    .limit(limit);
  // Filter by org via join is awkward in supabase-js — fetch then filter.
  const { data: galleryDue } = await gq;
  for (const row of (galleryDue as Row[]) ?? []) {
    const g = row.galleries as { org_id?: string } | null;
    if (g?.org_id !== orgId) continue;
    const key = row.r2_key_full as string | null;
    if (!key) continue;
    // Nigdy nie kasuj thumb keys — tylko gallery_full.
    if (
      !shouldCleanupR2Object({
        spStatus: row.sp_status as string | null,
        r2Status: row.r2_status as string | null,
        r2DeletedAt: row.r2_deleted_at as string | null,
        r2DeleteAfter: row.r2_delete_after as string | null,
        retentionHold: Boolean(row.retention_hold),
        nowIso,
        objectKind: "gallery_full",
      })
    ) {
      continue;
    }
    try {
      await deleteR2Object(key);
      await admin
        .from("gallery_items")
        .update({ r2_status: "deleted", r2_deleted_at: nowIso })
        .eq("id", row.id);
      deleted += 1;
    } catch (e) {
      errors.push(`gallery ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const { data: attDue } = await admin
    .from("message_attachments")
    .select("id, r2_key, org_id, r2_status, sp_status, r2_deleted_at, r2_delete_after, retention_hold")
    .eq("org_id", orgId)
    .eq("r2_status", "ready")
    .eq("sp_status", "verified")
    .eq("retention_hold", false)
    .is("r2_deleted_at", null)
    .lt("r2_delete_after", nowIso)
    .limit(limit);

  for (const row of (attDue as Row[]) ?? []) {
    const key = row.r2_key as string | null;
    if (!key) continue;
    if (
      !shouldCleanupR2Object({
        spStatus: row.sp_status as string | null,
        r2Status: row.r2_status as string | null,
        r2DeletedAt: row.r2_deleted_at as string | null,
        r2DeleteAfter: row.r2_delete_after as string | null,
        retentionHold: Boolean(row.retention_hold),
        nowIso,
        objectKind: "attachment",
      })
    ) {
      continue;
    }
    try {
      await deleteR2Object(key);
      await admin
        .from("message_attachments")
        .update({ r2_status: "deleted", r2_deleted_at: nowIso })
        .eq("id", row.id);
      deleted += 1;
    } catch (e) {
      errors.push(`att ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { deleted, errors };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function actionAttachmentSpDownload(
  admin: SupabaseClient,
  callerId: string,
  body: Row,
) {
  const driveItemId = requireString(body, "driveItemId", 200);
  const { data: att } = await admin
    .from("message_attachments")
    .select("id, message_id, org_id, sp_drive_item_id, messages!inner(conversation_id)")
    .eq("sp_drive_item_id", driveItemId)
    .maybeSingle();
  if (!att) throw new ActionError("Załącznik nie istnieje.", 404);
  const conversationId = (att.messages as { conversation_id?: string } | null)?.conversation_id;
  if (!conversationId || !(await isConversationMember(admin, conversationId, callerId))) {
    throw new ActionError("Brak dostępu.", 403);
  }
  const orgId = att.org_id as string | null;
  if (!orgId) throw new ActionError("Brak organizacji.", 200);
  const storage = await getActiveStorage(admin, orgId);
  if (!storage?.driveId) throw new ActionError("Magazyn plików niedostępny.", 200);
  if (!graphConfigured()) throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);
  const url = await getDownloadUrl(storage.driveId, driveItemId);
  return { url };
}

const ACTIONS: Record<string, (admin: SupabaseClient, callerId: string, body: Row) => Promise<unknown>> = {
  storage_status: actionStorageStatus,
  storage_save: actionStorageSave,
  storage_disconnect: actionStorageDisconnect,
  storage_probe: actionStorageProbe,
  storage_list_orgs_for_conversation: actionStorageListOrgsForConversation,
  gallery_create: actionGalleryCreate,
  gallery_add_items: actionGalleryAddItems,
  gallery_upload_item: actionGalleryUploadItem,
  gallery_upload_thumb: actionGalleryUploadThumb,
  gallery_recompute: actionGalleryRecompute,
  gallery_get: actionGalleryGet,
  gallery_item_url: actionGalleryItemUrl,
  gallery_soft_delete: actionGallerySoftDelete,
  gallery_delete_storage: actionGalleryDeleteStorage,
  r2_presign_gallery_items: actionR2PresignGalleryItems,
  r2_confirm_gallery_item: actionR2ConfirmGalleryItem,
  r2_presign_attachment: actionR2PresignAttachment,
  r2_confirm_attachment: actionR2ConfirmAttachment,
  attachment_sp_download: actionAttachmentSpDownload,
  media_cleanup_r2: actionMediaCleanupR2,
  media_pipeline_info: actionMediaPipelineInfo,
  media_enqueue_gallery_item: actionMediaEnqueueGalleryItem,
  r2_signed_get: actionR2SignedGet,
  org_media_pipeline_get: actionOrgMediaPipelineGet,
  org_media_pipeline_set: actionOrgMediaPipelineSet,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Row;
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      body = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          body[key] = value;
          continue;
        }
        // File / Blob
        const buf = new Uint8Array(await value.arrayBuffer());
        if (key === "file") {
          body.contentBytes = buf;
          if (!body.fileName && value.name) body.fileName = value.name;
          if (!body.mimeType && value.type) body.mimeType = value.type;
        } else if (key === "thumb") {
          body.thumbBytes = buf;
          if (!body.thumbMimeType && value.type) body.thumbMimeType = value.type;
        } else {
          body[key] = buf;
        }
      }
    } else {
      body = (await req.json()) as Row;
    }
  } catch {
    return json({ error: "Nieprawidłowe body żądania (JSON lub multipart)." }, 400);
  }
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS[action]) {
    return json({ error: `Nieznana akcja: ${String(action)}` }, 400);
  }

  let callerId: string;
  try {
    const auth = await createUserClient(req);
    callerId = auth.userId;
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return json({ error: e instanceof Error ? e.message : "Nieautoryzowany." }, status);
  }

  const admin = createServiceClient();
  try {
    const result = await ACTIONS[action](admin, callerId, body);
    return json(result, 200);
  } catch (e) {
    if (e instanceof ActionError) {
      return json(
        {
          error: e.message,
          ...(e.code ? { errorCode: e.code } : {}),
        },
        e.status,
      );
    }
    console.error(`[gallery-api] action=${action}`, e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500);
  }
});
