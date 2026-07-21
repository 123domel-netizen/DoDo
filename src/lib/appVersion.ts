import { cloudEnabled, supabase } from "@/lib/supabase";

/** Wstrzykiwane przy `vite build` (git short SHA lub „dev”). */
export const CLIENT_BUILD_VERSION =
  typeof __APP_BUILD_VERSION__ !== "undefined" ? __APP_BUILD_VERSION__ : "dev";

const SESSION_DISMISS_KEY = "dodo-update-prompt-session";

export interface AppReleaseInfo {
  version: string;
  message: string | null;
  updatedAt: string | null;
}

export function dismissedUpdatePromptThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissUpdatePromptForSession() {
  try {
    sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
  } catch {
    /* private mode */
  }
}

export async function fetchLatestAppRelease(): Promise<AppReleaseInfo | null> {
  if (!cloudEnabled || !supabase) return null;
  const { data, error } = await supabase
    .from("app_release")
    .select("version, message, updated_at")
    .eq("id", "client")
    .maybeSingle();
  if (error || !data) return null;
  return {
    version: data.version as string,
    message: (data.message as string | null) ?? null,
    updatedAt: (data.updated_at as string | null) ?? null,
  };
}

export function isClientVersionStale(
  clientVersion: string,
  serverVersion: string | null | undefined,
): boolean {
  const client = clientVersion.trim();
  const remote = serverVersion?.trim();
  if (!remote || remote === "dev") return false;
  if (!client || client === "dev") return false;
  return client !== remote;
}

/** Wyczyść cache SW i przeładuj — po deployu nowy bundle. */
export async function reloadAppToLatest() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        reg.waiting?.postMessage({ type: "SKIP_WAITING" });
      }
    }
  } catch {
    /* ignore */
  }
  window.location.reload();
}
