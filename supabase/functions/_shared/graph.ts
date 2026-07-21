// Microsoft Graph — klient app-only (client credentials), używany wyłącznie
// po stronie serwera. TOKENY NIGDY nie trafiają do klienta — Edge Function
// wykonuje wywołania Graph i zwraca do klienta tylko wynik (np. URL pobrania).
//
// Sekrety: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
// (uprawnienia aplikacji Azure AD: Sites.ReadWrite.All lub Files.ReadWrite.All).

const TENANT_ID = Deno.env.get("MICROSOFT_TENANT_ID") ?? "";
const CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const SHAREPOINT_NOT_CONFIGURED = "SharePoint nie jest skonfigurowany na serwerze.";

export function graphConfigured(): boolean {
  return Boolean(TENANT_ID && CLIENT_ID && CLIENT_SECRET);
}

export class GraphError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Cache modułowy — instancja Edge Function bywa reużywana między wywołaniami
// (ciepły start), więc unikamy pobierania nowego tokenu przy każdym requeście.
let cachedToken: CachedToken | null = null;

export async function getGraphToken(): Promise<string> {
  if (!graphConfigured()) {
    throw new GraphError(SHAREPOINT_NOT_CONFIGURED, 501);
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => null as unknown);
  const token = (data as { access_token?: string } | null)?.access_token;
  if (!res.ok || !token) {
    const desc = (data as { error_description?: string } | null)?.error_description;
    throw new GraphError(
      `Nie udało się uzyskać tokenu Microsoft Graph: ${desc ?? res.statusText}`,
      502,
    );
  }
  const expiresIn = Number((data as { expires_in?: number } | null)?.expires_in ?? 3600);
  cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

async function parseJsonOrNull(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Ogólny fetch do Graph z Bearer tokenem app-only + parsowanie JSON/błędów. */
export async function graphFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getGraphToken();
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const data = await parseJsonOrNull(res);
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      res.statusText;
    throw new GraphError(`Graph API: ${msg}`, res.status);
  }
  return data as T;
}

export interface GraphDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  folder?: { childCount?: number };
  "@microsoft.graph.downloadUrl"?: string;
}

/** Segment ścieżki Graph (addressowanie po nazwie, po dwukropku). */
function encodePathSegment(name: string): string {
  return encodeURIComponent(name);
}

/**
 * Get-or-create: folder o danej nazwie pod parentItemId. Idempotentne —
 * bezpieczne do wywołania wielokrotnie (np. wspólny folder "Galerie").
 */
export async function createFolder(
  driveId: string,
  parentItemId: string,
  name: string,
): Promise<GraphDriveItem> {
  try {
    const existing = await graphFetch<GraphDriveItem>(
      `/drives/${driveId}/items/${parentItemId}:/${encodePathSegment(name)}`,
    );
    if (existing?.id) return existing;
  } catch (e) {
    if (!(e instanceof GraphError && e.status === 404)) throw e;
  }
  return await graphFetch<GraphDriveItem>(
    `/drives/${driveId}/items/${parentItemId}/children`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    },
  );
}

/**
 * Upload małego pliku (PUT .../content) — wystarczające dla zdjęć galerii
 * (limit praktyczny Graph dla tej ścieżki to kilka MB; większe pliki
 * wymagałyby upload session, poza zakresem V1).
 */
export async function uploadSmallFile(
  driveId: string,
  folderItemId: string,
  fileName: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<GraphDriveItem> {
  const token = await getGraphToken();
  const url =
    `${GRAPH_BASE}/drives/${driveId}/items/${folderItemId}:/` +
    `${encodePathSegment(fileName)}:/content`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": contentType || "application/octet-stream",
    },
    body: bytes,
  });
  const data = await parseJsonOrNull(res);
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      res.statusText;
    throw new GraphError(`Graph upload: ${msg}`, res.status);
  }
  return data as GraphDriveItem;
}

/** Krótkotrwały URL pobrania (pre-authenticated) — nie wymaga tokenu klienta. */
export async function getDownloadUrl(driveId: string, itemId: string): Promise<string> {
  const data = await graphFetch<GraphDriveItem>(
    `/drives/${driveId}/items/${itemId}?$select=id,@microsoft.graph.downloadUrl`,
  );
  const url = data["@microsoft.graph.downloadUrl"];
  if (!url) throw new GraphError("Brak adresu pobierania z Graph.", 502);
  return url;
}

/** Usuwa element (plik/folder) — brak błędu gdy element już nie istnieje. */
export async function deleteItem(driveId: string, itemId: string): Promise<void> {
  try {
    await graphFetch(`/drives/${driveId}/items/${itemId}`, { method: "DELETE" });
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return;
    throw e;
  }
}
