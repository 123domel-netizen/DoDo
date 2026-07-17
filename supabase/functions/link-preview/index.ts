// Supabase Edge Function: link-preview
// CHAT5: podgląd linków — pobiera tytuł / opis / miniaturę (Open Graph)
// po stronie serwera (klient nie może przez CORS). Wynik klient zapisuje
// w messages.payload.linkPreview — jeden fetch na link, zero tabel cache.
//
// Bezpieczeństwo:
//  - verify_jwt = true (domyślne) — wywołania tylko z ważną sesją użytkownika;
//  - guard SSRF: wyłącznie http(s), blokada localhost / adresów prywatnych;
//  - limit 512 kB odpowiedzi i 5 s timeoutu.
//
// Wdrożenie: supabase functions deploy link-preview

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

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

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // IPv4 literal
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // IPv6 literal (uproszczony guard)
  if (h.includes(":")) return true;
  return false;
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

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; DoDoLinkPreview/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
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
    return new TextDecoder("utf-8", { fatal: false }).decode(merged);
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

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return json({ error: "invalid url" }, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json({ error: "unsupported protocol" }, 400);
  }
  if (isPrivateHost(parsed.hostname)) {
    return json({ error: "blocked host" }, 400);
  }

  const html = await fetchHtml(parsed.toString());
  if (!html) return json({ title: null, description: null, imageUrl: null, siteName: null });

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
    try {
      imageUrl = new URL(imageUrl, parsed).toString();
      if (!imageUrl.startsWith("http")) imageUrl = null;
    } catch {
      imageUrl = null;
    }
  }
  const siteName = metaContent(html, "og:site_name");

  return json({
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 300) : null,
    imageUrl,
    siteName: siteName ? siteName.slice(0, 100) : null,
  });
});
