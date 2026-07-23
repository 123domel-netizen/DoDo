import type { User } from "@supabase/supabase-js";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { buildOAuthRedirectTo } from "@/lib/authRedirect";
import { isR2PreviewSurface } from "@/lib/media/previewSurface";

export interface AuthUserInfo {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

const OAUTH_DIAG_KEY = "dodo.oauthDiag.v1";

/** Preview-only OAuth host diag — hostnames only, never full URLs / tokens / query. */
export interface OAuthOriginDiag {
  beforeHost: string;
  afterHost: string | null;
  redirectToHost: string;
  updatedAt: string;
}

function hostnameOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//i, "").split("/")[0] || "(unknown)";
  }
}

function pickMetaString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function authUserFromSupabaseUser(user: User): AuthUserInfo {
  const meta = user.user_metadata ?? {};
  const googleIdentity = user.identities?.find((i) => i.provider === "google");
  const identityData = (googleIdentity?.identity_data ?? {}) as Record<string, unknown>;

  return {
    id: user.id,
    email: user.email ?? null,
    name: pickMetaString(meta.full_name, meta.name, identityData.full_name, identityData.name),
    avatarUrl: pickMetaString(
      meta.avatar_url,
      meta.picture,
      identityData.avatar_url,
      identityData.picture,
    ),
  };
}

export function parseAuthErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);

  const errorDesc =
    params.get("error_description") ??
    hashParams.get("error_description") ??
    params.get("error") ??
    hashParams.get("error");

  if (!errorDesc) return null;

  const decoded = decodeURIComponent(errorDesc.replace(/\+/g, " "));
  if (/invite|zapros|allowlist|403|not authorized/i.test(decoded)) {
    return "To konto Google nie ma zaproszenia do aplikacji.";
  }
  return decoded;
}

export function clearAuthErrorFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  // Keep returnTo if present; never log/copy code
  url.searchParams.delete("code");
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

/** Powrót po Google OAuth — wyłącznie bieżący origin (preview / prod / localhost). */
export function oauthRedirectUrl(returnTo?: string | null): string {
  return buildOAuthRedirectTo({
    origin: window.location.origin,
    returnTo,
  });
}

function saveOAuthBeforeDiag(redirectTo: string): void {
  if (typeof sessionStorage === "undefined") return;
  if (!isR2PreviewSurface()) return;
  try {
    const diag: OAuthOriginDiag = {
      beforeHost: hostnameOf(window.location.origin),
      afterHost: null,
      redirectToHost: hostnameOf(redirectTo),
      updatedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(OAUTH_DIAG_KEY, JSON.stringify(diag));
    console.info("[oauth-diag]", {
      beforeHost: diag.beforeHost,
      redirectToHost: diag.redirectToHost,
    });
  } catch {
    // ignore
  }
}

/** Po powrocie z OAuth — zapisz host callback (bez URL, code, tokenów). */
export function recordOAuthCallbackOrigin(): OAuthOriginDiag | null {
  if (typeof sessionStorage === "undefined") return null;
  if (!isR2PreviewSurface()) return null;
  try {
    const raw = sessionStorage.getItem(OAUTH_DIAG_KEY);
    const prev = raw ? (JSON.parse(raw) as OAuthOriginDiag) : null;
    const diag: OAuthOriginDiag = {
      beforeHost: prev?.beforeHost ?? "(unknown)",
      afterHost: hostnameOf(window.location.origin),
      redirectToHost: prev?.redirectToHost ?? "(unknown)",
      updatedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(OAUTH_DIAG_KEY, JSON.stringify(diag));
    console.info("[oauth-diag]", {
      beforeHost: diag.beforeHost,
      afterHost: diag.afterHost,
      redirectToHost: diag.redirectToHost,
    });
    return diag;
  } catch {
    return null;
  }
}

export function getOAuthOriginDiag(): OAuthOriginDiag | null {
  if (typeof sessionStorage === "undefined") return null;
  if (!isR2PreviewSurface()) return null;
  try {
    const raw = sessionStorage.getItem(OAUTH_DIAG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OAuthOriginDiag> & {
      beforeOrigin?: string;
      afterOrigin?: string | null;
    };
    // Migrate legacy full-origin snapshots → hostnames only.
    return {
      beforeHost: hostnameOf(parsed.beforeHost ?? parsed.beforeOrigin ?? "(unknown)"),
      afterHost: parsed.afterHost
        ? hostnameOf(parsed.afterHost)
        : parsed.afterOrigin
          ? hostnameOf(parsed.afterOrigin)
          : null,
      redirectToHost: hostnameOf(parsed.redirectToHost ?? "(unknown)"),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function signInWithGoogle(returnTo?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak konfiguracji Supabase." };
  const redirectTo = oauthRedirectUrl(returnTo);
  saveOAuthBeforeDiag(redirectTo);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  return error ? { error: error.message } : {};
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getCurrentAuthUser(): Promise<AuthUserInfo | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  return authUserFromSupabaseUser(user);
}

export function isCloudAuthRequired(): boolean {
  return cloudEnabled;
}
