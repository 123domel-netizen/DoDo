import type { User } from "@supabase/supabase-js";
import { cloudEnabled, supabase } from "@/lib/supabase";

export interface AuthUserInfo {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
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
  url.hash = "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (!supabase) return { error: "Brak konfiguracji Supabase." };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
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
