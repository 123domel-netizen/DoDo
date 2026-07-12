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
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
  });

  const json = sub.toJSON();
  // onConflict: endpoint — ponowna rejestracja tego samego urządzenia odświeża
  // klucze zamiast wysypać się na unique(endpoint) i zostawić martwy wpis.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: data.user.id,
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
  if (cloudEnabled && pushSupported()) {
    const res = await enablePush();
    if (res.ok) {
      return {
        mode: "push",
        message:
          "Powiadomienia push włączone. Przypomnienia będą przychodzić na to urządzenie także przy zamkniętej aplikacji.",
      };
    }
    const local = await ensureLocalNotificationPermission();
    if (local) {
      return {
        mode: "local",
        message:
          `Uwaga: działają tylko powiadomienia lokalne (przy otwartej aplikacji). Push nieaktywny — ${res.reason ?? "nieznany błąd"}`,
      };
    }
    return { mode: "none", message: res.reason ?? "Nie udało się włączyć powiadomień." };
  }

  const ok = await ensureLocalNotificationPermission();
  if (ok) {
    return {
      mode: "local",
      message:
        "Powiadomienia lokalne włączone (działają, gdy aplikacja jest otwarta). Skonfiguruj Supabase + VAPID, aby dostawać push przy zamkniętej aplikacji.",
    };
  }
  return { mode: "none", message: "Brak zgody na powiadomienia w przeglądarce." };
}

export function showLocalNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, { body, icon: "/icon-192.png" }))
    .catch(() => new Notification(title, { body }));
}
