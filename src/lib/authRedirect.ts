/**
 * Bezpieczne URL-e powrotu OAuth — bez hardkodu produkcji jako jedynego targetu.
 * redirectTo zawsze z bieżącego originu; returnTo tylko ścieżka lokalna lub allowlista.
 */

export const OAUTH_REDIRECT_ALLOWLIST: readonly string[] = [
  "https://dodo-c39.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** Exact origin match against allowlist (no open redirect). */
export function isAllowedOAuthOrigin(origin: string): boolean {
  const o = origin.trim().replace(/\/$/, "");
  return OAUTH_REDIRECT_ALLOWLIST.some((allowed) => allowed === o);
}

/**
 * Canonical redirectTo for signInWithOAuth — current window origin only.
 * Never hardcodes production.
 */
export function oauthRedirectUrlFromOrigin(origin: string): string {
  const base = origin.trim().replace(/\/$/, "");
  return `${base}/`;
}

/**
 * returnTo: wyłącznie ścieżka względna (`/foo`) albo pełny URL z allowlisty originów.
 * Zewnętrzne domeny → null (odrzucone).
 */
export function resolveSafeReturnTo(
  returnTo: string | null | undefined,
  currentOrigin: string,
): string | null {
  if (returnTo == null) return null;
  const raw = returnTo.trim();
  if (!raw) return null;

  // Relative path only — no protocol-relative //evil.com
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (raw.includes("://") || raw.includes("\\")) return null;
    return raw;
  }

  try {
    const url = new URL(raw);
    if (!isAllowedOAuthOrigin(url.origin)) return null;
    // Must match current session origin when resolving absolute returnTo
    if (url.origin.replace(/\/$/, "") !== currentOrigin.trim().replace(/\/$/, "")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return null;
  }
}

/** Final redirectTo for OAuth: origin root, optionally with safe return path as query. */
export function buildOAuthRedirectTo(input: {
  origin: string;
  returnTo?: string | null;
}): string {
  const root = oauthRedirectUrlFromOrigin(input.origin);
  const safe = resolveSafeReturnTo(input.returnTo, input.origin);
  if (!safe || safe === "/") return root;
  const u = new URL(root);
  u.searchParams.set("returnTo", safe);
  return u.toString();
}

export function assertNoHardcodedProdOnlyRedirect(source: string): boolean {
  // Used in tests — source must not force production as the only redirect.
  const forced =
    /redirectTo\s*:\s*['"]https:\/\/dodo-c39\.pages\.dev/i.test(source) ||
    /redirectTo\s*=\s*['"]https:\/\/dodo-c39\.pages\.dev/i.test(source);
  return !forced;
}
