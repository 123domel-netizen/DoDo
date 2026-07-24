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
  // 1) Pełny driveItem — $select bywa zawodny dla instance attribute downloadUrl
  //    (app-only / SharePoint czasem zwraca item bez tej adnotacji przy $select).
  try {
    const data = await graphFetch<GraphDriveItem>(
      `/drives/${driveId}/items/${itemId}`,
    );
    const direct = data["@microsoft.graph.downloadUrl"];
    if (direct) return direct;
  } catch (e) {
    if (!(e instanceof GraphError && e.status === 404)) {
      // 404 = brak pliku; inne błędy — spróbuj jeszcze /content
    } else {
      throw e;
    }
  }

  // 2) Fallback: GET .../content → 302 Location (ten sam pre-auth URL).
  //    Działa z tokenem app-only po stronie Edge; Location można podać klientowi.
  const token = await getGraphToken();
  const res = await fetch(
    `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/content`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    },
  );
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("Location") ?? res.headers.get("location");
    if (location) return location;
  }
  // Niektóre runtime'y mogą śledzić redirect — wtedy nie trzymamy body w pamięci
  // (to ścieżka awaryjna; docelowo zawsze 302).
  if (res.status === 200) {
    throw new GraphError(
      "Graph zwrócił treść pliku zamiast URL (brak Location). Spróbuj ponownie.",
      502,
    );
  }
  const errBody = await parseJsonOrNull(res);
  const msg =
    (errBody as { error?: { message?: string } } | null)?.error?.message ??
    res.statusText;
  throw new GraphError(`Brak adresu pobierania z Graph: ${msg}`, res.status || 502);
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

export interface GraphDriveItemMeta extends GraphDriveItem {
  parentReference?: { id?: string; name?: string; path?: string };
}

/** Odczyt itemu (nazwa + parent) — do idempotencji kosza. */
export async function getDriveItem(
  driveId: string,
  itemId: string,
): Promise<GraphDriveItemMeta> {
  return graphFetch<GraphDriveItemMeta>(
    `/drives/${driveId}/items/${itemId}?$select=id,name,webUrl,size,parentReference`,
  );
}

/** Zmiana nazwy elementu na dysku. */
export async function renameItem(
  driveId: string,
  itemId: string,
  name: string,
): Promise<GraphDriveItemMeta> {
  return graphFetch<GraphDriveItemMeta>(`/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/**
 * Przenosi element pod newParentId; opcjonalnie zmienia nazwę.
 * conflictBehavior=rename przy kolizji nazwy w katalogu docelowym.
 */
export async function moveItem(
  driveId: string,
  itemId: string,
  newParentId: string,
  newName?: string,
): Promise<GraphDriveItemMeta> {
  const body: Record<string, unknown> = {
    parentReference: { id: newParentId },
    "@microsoft.graph.conflictBehavior": "rename",
  };
  if (newName) body.name = newName;
  return graphFetch<GraphDriveItemMeta>(`/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Sesja uploadu Graph — klient PUTuje bajty na zwrócony uploadUrl
 * (URL jest pre-auth, bez Bearer po stronie przeglądarki).
 */
export async function createUploadSession(
  driveId: string,
  folderItemId: string,
  fileName: string,
): Promise<{ uploadUrl: string; expirationDateTime?: string }> {
  const data = await graphFetch<{
    uploadUrl?: string;
    expirationDateTime?: string;
  }>(
    `/drives/${driveId}/items/${folderItemId}:/${encodePathSegment(fileName)}:/createUploadSession`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        item: {
          "@microsoft.graph.conflictBehavior": "rename",
          name: fileName,
        },
      }),
    },
  );
  if (!data?.uploadUrl) {
    throw new GraphError("Graph nie zwrócił uploadUrl sesji.", 502);
  }
  return { uploadUrl: data.uploadUrl, expirationDateTime: data.expirationDateTime };
}

/**
 * Link edycji: najpierw publiczny (anyone), potem organizacja.
 * Wiele witryn SharePoint ma wyłączone „Anyone” — wtedy organization nadal działa.
 */
export async function createEditShareLink(
  driveId: string,
  itemId: string,
): Promise<{ shareUrl: string; webUrl?: string; scope: "anonymous" | "organization" }> {
  let webUrl: string | undefined;
  try {
    const item = await graphFetch<GraphDriveItem>(
      `/drives/${driveId}/items/${itemId}?$select=id,webUrl`,
    );
    webUrl = item.webUrl;
  } catch {
    // optional
  }

  const tryScope = async (
    scope: "anonymous" | "organization",
  ): Promise<string | null> => {
    try {
      const data = await graphFetch<{
        link?: { webUrl?: string; type?: string; scope?: string };
      }>(`/drives/${driveId}/items/${itemId}/createLink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "edit", scope }),
      });
      return data?.link?.webUrl ?? null;
    } catch (e) {
      if (scope === "anonymous") return null;
      throw e;
    }
  };

  const anon = await tryScope("anonymous");
  if (anon) return { shareUrl: anon, webUrl, scope: "anonymous" };

  try {
    const org = await tryScope("organization");
    if (org) return { shareUrl: org, webUrl, scope: "organization" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new GraphError(
      `Nie udało się utworzyć linku edycji (${msg}). ` +
        `W SharePoint włącz udostępnianie linków (co najmniej „osoby w organizacji”) ` +
        `dla tej witryny magazynu plików.`,
      502,
    );
  }

  throw new GraphError(
    "Nie udało się utworzyć linku edycji. Sprawdź ustawienia udostępniania witryny SharePoint.",
    502,
  );
}

/** @deprecated Użyj createEditShareLink — najpierw anonymous, potem organization. */
export async function createAnonymousEditLink(
  driveId: string,
  itemId: string,
): Promise<{ shareUrl: string; webUrl?: string }> {
  const link = await createEditShareLink(driveId, itemId);
  return { shareUrl: link.shareUrl, webUrl: link.webUrl };
}
