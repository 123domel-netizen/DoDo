import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  enableNotificationsFlow,
  hasActivePushSubscription,
  pushSupported,
} from "@/lib/push";
import { cloudEnabled } from "@/lib/supabase";

const SESSION_DISMISS_KEY = "dodo-notif-prompt-session";
const SNOOZE_KEY = "dodo-notif-prompt-snooze";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 dni

function isSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* private mode */
  }
}

function dismissSession() {
  try {
    sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Po zalogowaniu — prośba o włączenie powiadomień, jeśli jeszcze nie ma zgody / pusha.
 */
export function NotificationPermissionPrompt() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const denied =
    typeof Notification !== "undefined" && Notification.permission === "denied";

  useEffect(() => {
    if (!cloudEnabled || !pushSupported()) return;
    if (dismissedThisSession() || isSnoozed()) return;

    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          if (await hasActivePushSubscription()) return;
        }
        if (!cancelled) setOpen(true);
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  const closeSession = () => {
    dismissSession();
    setOpen(false);
  };

  const closeSnooze = () => {
    snooze();
    dismissSession();
    setOpen(false);
  };

  const enable = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await enableNotificationsFlow();
    setBusy(false);
    if (res.mode === "push" || res.mode === "local") {
      dismissSession();
      try {
        localStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* ignore */
      }
      setOpen(false);
      return;
    }
    setFeedback(res.message);
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={closeSession} width={400}>
      <div className="p-5 pr-10">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
          {denied ? <BellOff size={22} /> : <Bell size={22} />}
        </div>
        <h2 className="mb-1 text-base font-semibold text-ink">Włącz powiadomienia</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-light">
          {denied
            ? "Przeglądarka zablokowała powiadomienia. Włącz je w ustawieniach strony (ikona kłódki przy adresie), a potem wróć tutaj."
            : "Żeby usłyszeć nową wiadomość na telefonie i komputerze — także gdy DoDo jest w tle — włącz powiadomienia dla tej aplikacji."}
        </p>
        {feedback && (
          <p className="mb-3 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[12px] text-ink-light">
            {feedback}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {!denied && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void enable()}
              className="rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? "Włączanie…" : "Włącz powiadomienia"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={closeSession}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-line-strong"
          >
            Później
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={closeSnooze}
            className="px-1 py-1 text-[11px] text-ink-faint transition hover:text-ink-light"
          >
            Nie pytaj przez 3 dni
          </button>
        </div>
      </div>
    </Modal>
  );
}
