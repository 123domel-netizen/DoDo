import { supabase } from "@/lib/supabase";

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

/** Subscribe this device to Web Push and store the subscription in Supabase. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Przeglądarka nie wspiera powiadomień push." };
  if (!VAPID_PUBLIC) return { ok: false, reason: "Brak klucza VAPID (skonfiguruj backend)." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Brak zgody na powiadomienia." };

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });

  if (supabase) {
    const { data } = await supabase.auth.getUser();
    const json = sub.toJSON();
    await supabase.from("push_subscriptions").upsert({
      user_id: data.user?.id,
      endpoint: json.endpoint,
      keys: json.keys,
      device_label: navigator.userAgent.slice(0, 120),
    });
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

export function showLocalNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  navigator.serviceWorker.ready
    .then((reg) => reg.showNotification(title, { body, icon: "/icon-192.png" }))
    .catch(() => new Notification(title, { body }));
}
