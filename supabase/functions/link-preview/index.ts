// Supabase Edge Function: link-preview
// CHAT5: podgląd linków — pobiera tytuł / opis / miniaturę (Open Graph)
// po stronie serwera (klient nie może przez CORS). Wynik klient zapisuje
// w messages.payload.linkPreview — jeden fetch na link, zero tabel cache.
//
// Bezpieczeństwo:
//  - verify_jwt = true (domyślne) — wywołania tylko z ważną sesją użytkownika;
//  - guard SSRF w `_shared/urlPolicy.ts`: wyłącznie http(s), tylko porty 80/443,
//    blokada userinfo, localhost, adresów prywatnych IPv4/IPv6 i metadanych
//    chmury; przekierowania obsługiwane ręcznie i walidowane na każdym skoku;
//  - limit 512 kB odpowiedzi i 5 s timeoutu.
//
// Wdrożenie: supabase functions deploy link-preview

import { DEFAULT_TIMEOUT_MS, evaluateUrl, safeFetch } from "../_shared/urlPolicy.ts";

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

/** Meta property/name → content (kolejność atrybutów dowolna). */
function metaContent(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: URL } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const result = await safeFetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; DoDoLinkPreview/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!result.ok) return null;
    const { response: res, finalUrl } = result;
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    void reader.cancel().catch(() => undefined);
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c.subarray(0, Math.min(c.byteLength, received - offset)), offset);
      offset += c.byteLength;
      if (offset >= received) break;
    }
    return { html: new TextDecoder("utf-8", { fatal: false }).decode(merged), finalUrl };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let url: string | undefined;
  try {
    const body = await req.json();
    url = typeof body?.url === "string" ? body.url : undefined;
  } catch {
    // brak body
  }
  if (!url) return json({ error: "url required" }, 400);

  const verdict = evaluateUrl(url);
  if (!verdict.ok) return json({ error: verdict.reason }, 400);

  const fetched = await fetchHtml(verdict.url.toString());
  if (!fetched) {
    return json({ title: null, description: null, imageUrl: null, siteName: null });
  }
  // Adresy względne rozwiązujemy względem OSTATNIEGO skoku, nie pierwotnego URL.
  const { html, finalUrl } = fetched;

  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1])
      : null);
  const description =
    metaContent(html, "og:description") ??
    metaContent(html, "twitter:description") ??
    metaContent(html, "description");
  let imageUrl =
    metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (imageUrl) {
    // Miniatura trafia do <img src> u każdego uczestnika rozmowy, więc musi
    // przejść tę samą politykę co pobierany dokument.
    const img = evaluateUrl(imageUrl, finalUrl);
    imageUrl = img.ok ? img.url.toString() : null;
  }
  const siteName = metaContent(html, "og:site_name");

  return json({
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 300) : null,
    imageUrl,
    siteName: siteName ? siteName.slice(0, 100) : null,
  });
});
