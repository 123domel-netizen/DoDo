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

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // ~12 MB po zdekodowaniu base64
const MAX_ITEMS_PER_CALL = 60;
const MAX_TITLE_LEN = 120;
const MAX_DESCRIPTION_LEN = 2000;

class ActionError extends Error {
  status: number;
  constructor(message: string, status = 200) {
    super(message);
    this.status = status;
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
    status: r.status as string,
    errorCode: (r.error_code as string | null) ?? null,
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
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
    .select("status")
    .eq("gallery_id", galleryId);
  const rows = (items as { status: string }[] | null) ?? [];
  const total = rows.length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const ready = rows.filter((r) => r.status === "ready").length;
  const pending = rows.filter((r) => r.status === "pending" || r.status === "uploading").length;

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
  const { data: orgRows } = await admin
    .from("orgs")
    .select("id, name")
    .in("id", activeOrgIds);
  const nameById = new Map<string, string>();
  for (const r of (orgRows as Row[] | null) ?? []) {
    nameById.set(r.id as string, (r.name as string) ?? "Organizacja");
  }

  return {
    orgs: activeRows.map((r) => ({
      orgId: r.org_id as string,
      orgName: nameById.get(r.org_id as string) ?? "Organizacja",
      baseFolderName: (r.base_folder_name as string | null) ?? null,
    })),
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

  if (!(await isConversationMember(admin, conversationId, callerId))) {
    throw new ActionError("Nie jesteś członkiem tej rozmowy.", 403);
  }
  if (!(await isOrgMember(admin, orgId, callerId))) {
    throw new ActionError("Nie należysz do tej organizacji.", 403);
  }
  if (!graphConfigured()) {
    throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);
  }
  const storage = await requireActiveStorage(admin, orgId);

  const galleryId = crypto.randomUUID();
  const folderName = galleryFolderName(title, galleryId);

  let folderId: string;
  let folderPath: string | null;
  try {
    const galerieFolder = await createFolder(
      storage.driveId!,
      storage.baseFolderId!,
      "Galerie",
    );
    const galleryFolder = await createFolder(storage.driveId!, galerieFolder.id, folderName);
    folderId = galleryFolder.id;
    folderPath = galleryFolder.webUrl ?? null;
  } catch (e) {
    const msg = e instanceof GraphError ? e.message : "Nie udało się utworzyć folderu.";
    throw new ActionError(`Nie udało się utworzyć folderu na SharePoint: ${msg}`, 200);
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
    payload: { galleryId },
    mentions: [],
  });
  if (msgErr) {
    throw new ActionError(`Nie udało się utworzyć wiadomości: ${msgErr.message}`, 500);
  }
  await admin.from("galleries").update({ message_id: messageId }).eq("id", galleryId);

  let insertedItems: Row[] = [];
  if (items.length) {
    const rows = items.map((it, idx) => ({
      id: it.id ?? crypto.randomUUID(),
      gallery_id: galleryId,
      sort_order: idx,
      file_name: it.fileName,
      mime_type: it.mimeType ?? "image/jpeg",
      size_bytes: it.sizeBytes ?? 0,
      width: it.width ?? null,
      height: it.height ?? null,
      status: "pending",
    }));
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
    gallery: rowToGallery({ ...(galleryRow as Row), message_id: messageId }),
    items: insertedItems.map(rowToGalleryItem),
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

  const rows = items.map((it, idx) => ({
    id: it.id ?? crypto.randomUUID(),
    gallery_id: galleryId,
    sort_order: startOrder + idx,
    file_name: it.fileName,
    mime_type: it.mimeType ?? "image/jpeg",
    size_bytes: it.sizeBytes ?? 0,
    width: it.width ?? null,
    height: it.height ?? null,
    status: "pending",
  }));
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
  const contentBase64 = body.contentBase64;
  if (typeof contentBase64 !== "string" || !contentBase64) {
    throw new ActionError('Pole "contentBase64" jest wymagane.', 400);
  }

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

  const storage = await getActiveStorage(admin, gallery.org_id as string);
  if (!storage || !gallery.provider_folder_id) {
    const { gallery: g } = await markFailed("no_storage", "Magazyn plików niedostępny.");
    return { item: rowToGalleryItem({ ...item, status: "failed" }), gallery: g };
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(contentBase64);
  } catch {
    const { gallery: g } = await markFailed("bad_data", "Nieprawidłowe dane pliku.");
    return { item: rowToGalleryItem({ ...item, status: "failed" }), gallery: g };
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    const { gallery: g } = await markFailed(
      "too_large",
      `Plik przekracza limit ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    );
    return { item: rowToGalleryItem({ ...item, status: "failed" }), gallery: g };
  }

  await admin.from("gallery_items").update({ status: "uploading" }).eq("id", itemId);

  try {
    const uploaded = await uploadSmallFile(
      storage.driveId!,
      gallery.provider_folder_id as string,
      item.file_name as string,
      bytes,
      item.mime_type as string,
    );
    const { data: updatedRow } = await admin
      .from("gallery_items")
      .update({
        status: "ready",
        provider_item_id: uploaded.id,
        size_bytes: uploaded.size ?? bytes.byteLength,
        error_code: null,
        error_message: null,
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
    const msg = e instanceof GraphError ? e.message : "Nie udało się wysłać pliku.";
    const code = e instanceof GraphError ? String(e.status) : "upload_failed";
    const { gallery: g } = await markFailed(code, msg);
    return { item: rowToGalleryItem({ ...item, status: "failed", error_message: msg }), gallery: g };
  }
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
    throw new ActionError("Zdjęcie jeszcze nie jest gotowe.", 200);
  }
  const storage = await getActiveStorage(admin, gallery.org_id as string);
  if (!storage) throw new ActionError("Magazyn plików niedostępny.", 200);

  if (!graphConfigured()) throw new ActionError(SHAREPOINT_NOT_CONFIGURED, 200);
  try {
    const url = await getDownloadUrl(storage.driveId!, item.provider_item_id as string);
    return { url };
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
// Router
// ---------------------------------------------------------------------------

const ACTIONS: Record<string, (admin: SupabaseClient, callerId: string, body: Row) => Promise<unknown>> = {
  storage_status: actionStorageStatus,
  storage_save: actionStorageSave,
  storage_disconnect: actionStorageDisconnect,
  storage_list_orgs_for_conversation: actionStorageListOrgsForConversation,
  gallery_create: actionGalleryCreate,
  gallery_add_items: actionGalleryAddItems,
  gallery_upload_item: actionGalleryUploadItem,
  gallery_get: actionGalleryGet,
  gallery_item_url: actionGalleryItemUrl,
  gallery_soft_delete: actionGallerySoftDelete,
  gallery_delete_storage: actionGalleryDeleteStorage,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Row;
  try {
    body = (await req.json()) as Row;
  } catch {
    return json({ error: "Nieprawidłowe body żądania (wymagany JSON)." }, 400);
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
      return json({ error: e.message }, e.status);
    }
    console.error(`[gallery-api] action=${action}`, e);
    return json({ error: "Wewnętrzny błąd serwera." }, 500);
  }
});
