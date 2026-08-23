/**
 * Polityka URL dla wychodzących żądań serwerowych (guard SSRF).
 *
 * Moduł jest czystym TypeScriptem bez API Deno, żeby dało się go pokryć testami
 * jednostkowymi Vitest (src/lib/security/urlPolicy.test.ts).
 *
 * Model zagrożenia: zalogowany użytkownik podaje dowolny URL, który funkcja Edge
 * pobiera ze swojej sieci. Bez kontroli pozwala to skanować hosty wewnętrzne i
 * czytać metadane chmury (169.254.169.254). Samo sprawdzenie pierwszego URL nie
 * wystarcza — atakujący kontroluje serwer, który może odpowiedzieć
 * przekierowaniem na adres prywatny. Dlatego przekierowania obsługujemy ręcznie
 * i walidujemy każdy skok osobno.
 */

export const MAX_REDIRECTS = 3;
export const DEFAULT_TIMEOUT_MS = 5000;

/** Preview linków ma sens tylko dla zwykłego ruchu WWW. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home.arpa",
];

export type UrlVerdict =
  | { ok: true; url: URL }
  | { ok: false; reason: BlockReason };

export type BlockReason =
  | "invalid-url"
  | "unsupported-protocol"
  | "credentials-in-url"
  | "blocked-port"
  | "blocked-host";

/** Rozbija literał IPv4 na bajty. Zwraca null, gdy host nie jest adresem IPv4. */
export function parseIpv4(hostname: string): number[] | null {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

export function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // prywatna
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local + metadane chmury
  if (a === 172 && b >= 16 && b <= 31) return true; // prywatna
  if (a === 192 && b === 168) return true; // prywatna
  if (a === 192 && parts[2] === 0 && (b === 0 || b === 88)) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18/15
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + broadcast
  return false;
}

/**
 * Rozbija literał IPv6 (z nawiasami lub bez) na 16 bajtów.
 * Obsługuje skrót `::` i końcówkę w notacji IPv4 (`::ffff:127.0.0.1`).
 */
export function parseIpv6(hostname: string): number[] | null {
  let h = hostname.trim();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const zone = h.indexOf("%");
  if (zone !== -1) h = h.slice(0, zone);
  if (!h.includes(":")) return null;

  // Końcówka w notacji IPv4 → zamień na dwie grupy szesnastkowe.
  const lastColon = h.lastIndexOf(":");
  const tail = h.slice(lastColon + 1);
  const tailV4 = parseIpv4(tail);
  if (tailV4) {
    const hi = ((tailV4[0] << 8) | tailV4[1]).toString(16);
    const lo = ((tailV4[2] << 8) | tailV4[3]).toString(16);
    h = `${h.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = h.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  const tailGroups = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tailGroups) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tailGroups.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<number>(fill).fill(0), ...tailGroups];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

export function isPrivateIpv6(bytes: number[]): boolean {
  const isZero = (from: number, to: number) =>
    bytes.slice(from, to).every((b) => b === 0);

  if (isZero(0, 15) && (bytes[15] === 0 || bytes[15] === 1)) return true; // :: i ::1
  if (bytes[0] === 0xff) return true; // multicast ff00::/8
  if ((bytes[0] & 0xfe) === 0xfc) return true; // unique local fc00::/7
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // link-local fe80::/10

  // IPv4-mapped ::ffff:a.b.c.d — decyduje osadzony adres IPv4.
  if (isZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(bytes.slice(12, 16));
  }
  // NAT64 64:ff9b::/96
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isPrivateIpv4(bytes.slice(12, 16));
  }
  // 6to4 2002::/16 — osadzony IPv4 w bajtach 2..5
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPrivateIpv4(bytes.slice(2, 6));
  }
  return false;
}

/** Czy host jest lokalny / prywatny / w puli zarezerwowanej. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost") return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;

  const v4 = parseIpv4(h);
  if (v4) return isPrivateIpv4(v4);

  const v6 = parseIpv6(h);
  if (v6) return isPrivateIpv6(v6);

  // Nawiasy kwadratowe bez poprawnego IPv6 = wejście spreparowane.
  if (h.startsWith("[") || h.includes(":")) return true;

  // Nazwa bez kropki nie jest publiczną domeną (np. host z sieci wewnętrznej).
  if (!h.includes(".")) return true;

  return false;
}

/**
 * Waliduje pojedynczy URL. Uwaga: konstruktor URL normalizuje zapisy IPv4
 * (dziesiętny `2130706433`, ósemkowy `0177.0.0.1`, szesnastkowy `0x7f000001`)
 * do postaci kropkowej, więc kontrola hosta obejmuje też te warianty.
 */
export function evaluateUrl(raw: string | URL, base?: string | URL): UrlVerdict {
  let url: URL;
  try {
    url = base ? new URL(String(raw), base) : new URL(String(raw));
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported-protocol" };
  }
  // `http://trusted.example@169.254.169.254/` — część przed @ to nie host.
  if (url.username || url.password) {
    return { ok: false, reason: "credentials-in-url" };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: "blocked-port" };
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, reason: "blocked-host" };
  }
  return { ok: true, url };
}

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  maxRedirects?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: URL }
  | { ok: false; reason: BlockReason | "too-many-redirects" | "fetch-failed" };

/**
 * Pobiera zasób, samodzielnie podążając za przekierowaniami i sprawdzając
 * politykę na KAŻDYM skoku. `redirect: "manual"` jest kluczowe — wbudowane
 * `follow` przeszłoby na adres prywatny bez naszej wiedzy.
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;

  let verdict = evaluateUrl(rawUrl);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  let current = verdict.url;
  const seen = new Set<string>();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (seen.has(current.toString())) {
      return { ok: false, reason: "too-many-redirects" };
    }
    seen.add(current.toString());

    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        redirect: "manual",
        signal: opts.signal,
        // Bez credentials i bez nagłówków użytkownika — funkcja nie może
        // wypożyczać swojej tożsamości sieciowej.
        headers: opts.headers ?? {},
      });
    } catch {
      return { ok: false, reason: "fetch-failed" };
    }

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");
    if (!isRedirect || !location) {
      return { ok: true, response: res, finalUrl: current };
    }

    if (hop === maxRedirects) {
      return { ok: false, reason: "too-many-redirects" };
    }

    // Location bywa względny — rozwiązujemy względem bieżącego skoku,
    // a następnie walidujemy pełny wynik.
    verdict = evaluateUrl(location, current);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    current = verdict.url;
  }

  return { ok: false, reason: "too-many-redirects" };
}
