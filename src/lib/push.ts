import { cloudEnabled, supabase } from "@/lib/supabase";

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushConfigured(): boolean {
  return cloudEnabled && Boolean(VAPID_PUBLIC);
}

/** Czy to urządzenie ma aktywną subskrypcję push (serwer dosyła powiadomienia). */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!pushSupported() || !pushConfigured()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

async function upsertSubscription(
  userId: string,
  sub: PushSubscription,
): Promise<{ ok: boolean; reason?: string }> {
  if (!supabase) return { ok: false, reason: "Synchronizacja z chmurą jest wyłączona." };
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys) {
    return { ok: false, reason: "Niepełna subskrypcja push." };
  }
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      keys: json.keys,
      device_label: navigator.userAgent.slice(0, 120),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    return { ok: false, reason: `Nie udało się zapisać subskrypcji: ${error.message}` };
  }
  return { ok: true };
}

/** Subscribe this device to Web Push and store the subscription in Supabase. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Przeglądarka nie wspiera powiadomień push." };
  if (!VAPID_PUBLIC) return { ok: false, reason: "Brak klucza VAPID (skonfiguruj backend)." };
  if (!supabase) return { ok: false, reason: "Synchronizacja z chmurą jest wyłączona." };

  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) {
    return { ok: false, reason: "Zaloguj się, aby włączyć powiadomienia push." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Brak zgody na powiadomienia." };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
    });
  }

  return upsertSubscription(data.user.id, sub);
}

/**
 * Po logowaniu: jeśli przeglądarka ma już subskrypcję, dopisz ją do bazy.
 * (Bez tego push z serwera idzie w próżnię — 0 wierszy w push_subscriptions.)
 */
export async function syncExistingPushSubscription(): Promise<void> {
  if (!pushSupported() || !pushConfigured() || !supabase) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await upsertSubscription(data.user.id, sub);
  } catch {
    /* ignore */
  }
}

/** Local notification fallback (works without a backend, while the tab/PWA is open). */
export async function ensureLocalNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const p = await Notification.requestPermission();
  return p === "granted";
}

export type NotificationsMode = "push" | "local" | "none";

/**
 * Wspólny przepływ włączania powiadomień (dzwonek w pasku, desktop i mobile).
 * Zwraca tryb, który realnie działa, oraz komunikat dla użytkownika — żeby nie
 * sugerować, że push działa, gdy udało się włączyć tylko powiadomienia lokalne.
 */
export async function enableNotificationsFlow(): Promise<{
  mode: NotificationsMode;
  message: string;
}> {
  const isiOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone));

  if (isiOS && !isStandalone) {
    return {
      mode: "none",
      message:
        "Na iPhonie powiadomienia działają tylko po dodaniu DoDo do ekranu początkowego (Udostępnij → Do ekranu początkowego), a potem dzwonek w aplikacji.",
    };
  }

  if (cloudEnabled && pushSupported()) {
    const res = await enablePush();
    if (res.ok) {
      return {
        mode: "push",
        message:
          "Powiadomienia włączone. Dostaniesz alert przy nowej wiadomości także gdy aplikacja jest w tle (na iOS — tylko zainstalowana PWA).",
      };
    }
    const local = await ensureLocalNotificationPermission();
    if (local) {
      return {
        mode: "local",
        message: `Uwaga: działają tylko powiadomienia lokalne (przy otwartej karcie). Push nieaktywny — ${res.reason ?? "nieznany błąd"}`,
      };
    }
    return { mode: "none", message: res.reason ?? "Nie udało się włączyć powiadomień." };
  }

  const ok = await ensureLocalNotificationPermission();
  if (ok) {
    return {
      mode: "local",
      message:
        "Powiadomienia lokalne włączone (gdy karta jest otwarta). Skonfiguruj Supabase + VAPID, aby push działał w tle.",
    };
  }
  return { mode: "none", message: "Brak zgody na powiadomienia w przeglądarce." };
}

export function showLocalNotification(
  title: string,
  body: string,
  opts?: { tag?: string; url?: string },
) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    ...(opts?.tag ? { tag: opts.tag, renotify: true } : {}),
    data: { url: opts?.url ?? "/" },
    vibrate: [40, 60, 40],
  };
  navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, options))
    .catch(() => {
      try {
        new Notification(title, options);
      } catch {
        /* ignore */
      }
    });
}
