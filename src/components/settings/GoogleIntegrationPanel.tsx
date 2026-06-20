import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Unlink } from "lucide-react";
import type { DualVisibilityMode, GoogleConnectionStatus, GoogleSyncSettings } from "@/types";
import {
  DEFAULT_GOOGLE_SETTINGS,
  disconnectGoogle,
  fetchGoogleCalendars,
  fetchGoogleStatus,
  fetchGoogleTaskLists,
  googleIntegrationAvailable,
  reimportGoogle,
  saveGoogleSettings,
  startGoogleConnect,
  triggerGoogleSync,
} from "@/lib/googleSync";
import { cloudEnabled } from "@/lib/supabase";
import { fmt } from "@/lib/format";

const DUAL_MODES: { value: DualVisibilityMode; label: string }[] = [
  { value: "both_linked", label: "Kalendarz + Tasks (powiązane)" },
  { value: "calendar_only", label: "Tylko Kalendarz Google" },
  { value: "tasks_only", label: "Tylko Google Tasks" },
  { value: "ask_per_item", label: "Wybór per element w edytorze" },
];

export function GoogleIntegrationPanel() {
  const available = googleIntegrationAvailable();
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [settings, setSettings] = useState<GoogleSyncSettings>(DEFAULT_GOOGLE_SETTINGS);
  const [calendars, setCalendars] = useState<{ id: string; summary: string }[]>([]);
  const [taskLists, setTaskLists] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const s = await fetchGoogleStatus();
      setStatus(s);
      if (s.settings) setSettings(s.settings);
      if (s.connected) {
        const [cals, lists] = await Promise.all([
          fetchGoogleCalendars().catch(() => []),
          fetchGoogleTaskLists().catch(() => []),
        ]);
        setCalendars(cals);
        setTaskLists(lists);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!cloudEnabled) {
    return (
      <p className="text-[11px] leading-snug text-ink-faint">
        Integracja Google wymaga konta w chmurze (Supabase). Skonfiguruj{" "}
        <code className="text-ink-light">VITE_SUPABASE_URL</code> w pliku .env.
      </p>
    );
  }

  const patchSettings = (patch: Partial<GoogleSyncSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  };

  const persistSettings = async () => {
    setError(null);
    try {
      await saveGoogleSettings(settings);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const connect = async () => {
    setError(null);
    try {
      await startGoogleConnect();
    } catch (e) {
      setError(String(e));
    }
  };

  const disconnect = async () => {
    setError(null);
    try {
      await disconnectGoogle();
      setCalendars([]);
      setTaskLists([]);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      await triggerGoogleSync("full");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const reimport = async () => {
    if (
      !window.confirm(
        "Pełny ponowny import usunie zaimportowane wydarzenia Google z aplikacji i pobierze je od nowa z Google. Twój kalendarz Google nie zostanie zmieniony. Kontynuować?",
      )
    ) {
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      await reimportGoogle();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3">
      {!status?.connected ? (
        <div>
          <p className="mb-2 text-[11px] leading-snug text-ink-faint">
            Połącz konto Google, aby synchronizować wydarzenia z Kalendarzem i zadania z Google
            Tasks (dwukierunkowo). Zadania tylko w Tasks z przypomnieniami dostają osobne wpisy w
            Kalendarzu Google w chwili przypomnienia (np. 10:45 przy terminie 11:00 i −15 min).
          </p>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={loading}
            className="w-full rounded-lg bg-accent-grad px-3 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
          >
            Połącz Google
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-ink">{status.email}</span>
            <button
              type="button"
              onClick={() => void disconnect()}
              className="flex shrink-0 items-center gap-1 text-xs text-ink-faint transition hover:text-ink"
              title="Rozłącz"
            >
              <Unlink size={14} /> Rozłącz
            </button>
          </div>

          {status.lastSyncAt && (
            <p className="text-[11px] text-ink-faint">
              Ostatnia sync: {fmt(new Date(status.lastSyncAt), "d MMM, HH:mm")}
            </p>
          )}
          {status.lastSyncError && (
            <p className="text-[11px] text-red-400">Błąd: {status.lastSyncError}</p>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-light">
            <input
              type="checkbox"
              checked={settings.calendarEnabled}
              onChange={(e) => patchSettings({ calendarEnabled: e.target.checked })}
              className="accent-accent"
            />
            Kalendarz Google
          </label>
          {settings.calendarEnabled && calendars.length > 0 && (
            <select
              value={settings.calendarId}
              onChange={(e) => patchSettings({ calendarId: e.target.value })}
              className="w-full rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-ink"
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}
                </option>
              ))}
            </select>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-light">
            <input
              type="checkbox"
              checked={settings.tasksEnabled}
              onChange={(e) => patchSettings({ tasksEnabled: e.target.checked })}
              className="accent-accent"
            />
            Google Tasks
          </label>
          {settings.tasksEnabled && taskLists.length > 0 && (
            <select
              value={settings.taskListId}
              onChange={(e) => patchSettings({ taskListId: e.target.value })}
              className="w-full rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-ink"
            >
              {taskLists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Zadanie w kalendarzu i ToDo
            </div>
            <select
              value={settings.dualVisibilityMode}
              onChange={(e) =>
                patchSettings({ dualVisibilityMode: e.target.value as DualVisibilityMode })
              }
              className="w-full rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-ink"
            >
              {DUAL_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-light">
            <input
              type="checkbox"
              checked={settings.syncCompletedTasks}
              onChange={(e) => patchSettings({ syncCompletedTasks: e.target.checked })}
              className="accent-accent"
            />
            Sync ukończonych zadań (ARCH)
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-light">
            <input
              type="checkbox"
              checked={settings.importExistingOnConnect}
              onChange={(e) => patchSettings({ importExistingOnConnect: e.target.checked })}
              className="accent-accent"
            />
            Import istniejących z Google przy pierwszej sync
          </label>

          <p className="text-[11px] leading-snug text-ink-faint">
            Wydarzenia i zadania zaimportowane z Google są tylko do odczytu — synchronizacja
            pobiera zmiany z Google, ale nie nadpisuje ich z aplikacji.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void persistSettings()}
              className="flex-1 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm text-ink transition hover:border-line-strong"
            >
              Zapisz
            </button>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync teraz
            </button>
          </div>

          <button
            type="button"
            onClick={() => void reimport()}
            disabled={syncing}
            className="w-full rounded-lg border border-line px-2 py-1.5 text-xs text-ink-light transition hover:border-line-strong hover:text-ink disabled:opacity-60"
            title="Usuwa zaimportowane wydarzenia Google z aplikacji i pobiera je od nowa"
          >
            Wyczyść i zaimportuj ponownie z Google
          </button>
        </>
      )}

      {loading && !status && (
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <Loader2 size={14} className="animate-spin" /> Ładowanie…
        </div>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

export async function handleGoogleOAuthReturn(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get("google") !== "connected") return;
  params.delete("google");
  const qs = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  await triggerGoogleSync("full");
}
