// Cloudflare R2 — S3-compatible client (presign PUT/GET, HeadObject, Delete).
// Sekrety Edge: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (opcjonalnie R2_PUBLIC_HOST — jeśli custom domain dla GET; domyślnie endpoint S3).

const ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID") ?? "";
const ACCESS_KEY = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const SECRET_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const BUCKET = Deno.env.get("R2_BUCKET") ?? "dodo-media";
const REGION = "auto";

export function r2Configured(): boolean {
  return Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET);
}

function endpointHost(): string {
  return `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeRfc3986(seg))
    .join("/");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof ArrayBuffer ? key : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signingKey(dateStamp: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(
    new TextEncoder().encode("AWS4" + SECRET_KEY),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, REGION);
  const kService = await hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

export type PresignMethod = "PUT" | "GET" | "HEAD" | "DELETE";

export interface PresignOptions {
  key: string;
  method: PresignMethod;
  expiresInSec?: number;
  contentType?: string;
}

/** Krótkotrwały podpisany URL (SigV4 query). */
export async function presignR2Url(opts: PresignOptions): Promise<string> {
  if (!r2Configured()) {
    throw new Error("R2 nie jest skonfigurowany na serwerze.");
  }
  const expires = Math.min(Math.max(opts.expiresInSec ?? 300, 60), 3600);
  const host = endpointHost();
  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${ACCESS_KEY}/${dateStamp}/${REGION}/s3/aws4_request`;
  const signedHeaders = "host";
  const canonicalUri = `/${BUCKET}/${encodePath(opts.key)}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  if (opts.method === "PUT" && opts.contentType) {
    // Content-Type nie jest w signed headers — klient musi wysłać ten sam typ;
    // dla prostoty nie podpisujemy content-type (CORS + Edge confirm Head).
  }

  const sortedQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k]!)}`)
    .join("&");

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    sortedQuery,
    `host:${host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/${REGION}/s3/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const key = await signingKey(dateStamp);
  const signature = toHex(await hmacSha256(key, stringToSign));

  return `https://${host}${canonicalUri}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

export interface HeadResult {
  exists: boolean;
  etag: string | null;
  size: number | null;
  contentType: string | null;
}

/** HeadObject przez podpisany GET-style request (Authorization header). */
export async function headR2Object(key: string): Promise<HeadResult> {
  if (!r2Configured()) {
    throw new Error("R2 nie jest skonfigurowany na serwerze.");
  }
  const host = endpointHost();
  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${encodePath(key)}`;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    "HEAD",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/${REGION}/s3/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const keySigning = await signingKey(dateStamp);
  const signature = toHex(await hmacSha256(keySigning, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${dateStamp}/${REGION}/s3/aws4_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "HEAD",
    headers: {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
    },
  });

  if (res.status === 404) {
    return { exists: false, etag: null, size: null, contentType: null };
  }
  if (!res.ok) {
    throw new Error(`R2 HEAD failed: ${res.status} ${res.statusText}`);
  }
  const etag = res.headers.get("etag")?.replace(/"/g, "") ?? null;
  const sizeRaw = res.headers.get("content-length");
  const size = sizeRaw != null ? Number(sizeRaw) : null;
  return {
    exists: true,
    etag,
    size: Number.isFinite(size) ? size : null,
    contentType: res.headers.get("content-type"),
  };
}

export async function deleteR2Object(key: string): Promise<void> {
  if (!r2Configured()) {
    throw new Error("R2 nie jest skonfigurowany na serwerze.");
  }
  const host = endpointHost();
  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${BUCKET}/${encodePath(key)}`;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/${REGION}/s3/aws4_request`,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const keySigning = await signingKey(dateStamp);
  const signature = toHex(await hmacSha256(keySigning, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${dateStamp}/${REGION}/s3/aws4_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "DELETE",
    headers: {
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
    },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 DELETE failed: ${res.status}`);
  }
}

export function galleryFullKey(orgId: string, galleryId: string, itemId: string): string {
  return `hot/teams/${orgId}/galleries/${galleryId}/full/${itemId}.jpg`;
}

export function galleryThumbKey(orgId: string, galleryId: string, itemId: string): string {
  return `hot/teams/${orgId}/galleries/${galleryId}/thumb/${itemId}.webp`;
}

export function attachmentKey(
  orgId: string,
  conversationId: string,
  messageId: string,
  attId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, "_").slice(0, 80);
  return `hot/teams/${orgId}/attachments/${conversationId}/${messageId}/${attId}-${safe}`;
}
