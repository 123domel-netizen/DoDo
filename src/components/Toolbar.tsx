import { useEffect, useState } from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  Bell,
  Link2,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { CalendarViewKind } from "@/types";
import { getViewLabel } from "@/lib/viewLabel";
import { getViewDays } from "@/lib/time";
import { groupIdForNewItem } from "@/lib/groups";
import { enablePush, ensureLocalNotificationPermission, pushSupported } from "@/lib/push";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { authUserFromSupabaseUser, signOut, type AuthUserInfo } from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";
import { GoogleIntegrationPanel } from "@/components/settings/GoogleIntegrationPanel";

const VIEWS: { key: CalendarViewKind; label: string }[] = [
  { key: "day", label: "Dzień" },
  { key: "week", label: "Tydzień" },
  { key: "eleven", label: "11 dni" },
  { key: "month", label: "Miesiąc" },
];

interface ToolbarProps {
  todoOpen: boolean;
  onToggleTodo: () => void;
}

export function Toolbar({ todoOpen, onToggleTodo }: ToolbarProps) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const startDraft = useStore((s) => s.startDraft);
  const [settingsPanel, setSettingsPanel] = useState<"view" | "google" | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("google") === "connected" ? "google" : null;
  });

  const anchor = new Date(settings.anchorDate);

  const shift = (dir: number) => {
    if (settings.view === "month") {
      setSettings({ anchorDate: startOfDay(addMonths(anchor, dir)).toISOString() });
      return;
    }
    if (settings.view === "day") {
      setSettings({ anchorDate: startOfDay(addDays(anchor, dir)).toISOString() });
      return;
    }
    if (settings.view === "eleven") {
      const days = getViewDays("eleven", anchor, settings.nineDayStartWeekday);
      const next = addDays(days[0], dir * 7);
      setSettings({ anchorDate: startOfDay(next).toISOString() });
      return;
    }
    setSettings({ anchorDate: startOfDay(addDays(anchor, dir * 7)).toISOString() });
  };

  const goToday = () => setSettings({ anchorDate: startOfDay(new Date()).toISOString() });

  const quickAdd = () => {
    const start = new Date();
    start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
    startDraft({
      type: "event",
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
      groupId: groupIdForNewItem(),
    });
  };

  const enableNotifications = async () => {
    if (cloudEnabled && pushSupported()) {
      const res = await enablePush();
      if (!res.ok) {
        const local = await ensureLocalNotificationPermission();
        if (!local) alert(res.reason ?? "Nie udało się włączyć powiadomień.");
      }
    } else {
      const ok = await ensureLocalNotificationPermission();
      if (!ok) alert("Brak zgody na powiadomienia w przeglądarce.");
    }
  };

  return (
    <header className="glass relative z-30 flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div className="mr-1 flex items-center gap-2">
        <Logo size={26} />
      </div>

      <button
        onClick={goToday}
        className="rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-sm text-ink transition hover:border-line-strong"
      >
        Dziś
      </button>

      <div className="flex items-center">
        <button
          onClick={() => shift(-1)}
          className="rounded-lg p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Poprzedni"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={() => shift(1)}
          className="rounded-lg p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Następny"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="min-w-[170px] text-sm font-medium capitalize text-ink">
        {getViewLabel(settings.view, anchor, settings.nineDayStartWeekday)}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setSettings({ view: v.key })}
              className={`rounded-md px-2.5 py-1 text-sm transition ${
                settings.view === v.key
                  ? "bg-accent text-white shadow-glow"
                  : "text-ink-light hover:text-ink"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSettingsPanel((v) => (v === "view" ? null : "view"))}
          className={`rounded-lg p-1.5 transition hover:bg-surface-overlay hover:text-ink ${
            settingsPanel === "view" ? "bg-surface-overlay text-ink" : "text-ink-light"
          }`}
          aria-label="Ustawienia widoku"
          title="Ustawienia widoku (godziny, wysokość siatki)"
        >
          <Settings2 size={18} />
        </button>

        <button
          onClick={() => setSettingsPanel((v) => (v === "google" ? null : "google"))}
          className={`rounded-lg p-1.5 transition hover:bg-surface-overlay hover:text-ink ${
            settingsPanel === "google" ? "bg-surface-overlay text-ink" : "text-ink-light"
          }`}
          aria-label="Integracja Google"
          title="Integracja Google (Kalendarz + Tasks)"
        >
          <Link2 size={18} />
        </button>

        <UserMenu onClosePanels={() => setSettingsPanel(null)} />

        <button
          onClick={enableNotifications}
          className="rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Powiadomienia"
          title="Włącz powiadomienia"
        >
          <Bell size={18} />
        </button>

        <button
          onClick={onToggleTodo}
          className="rounded-lg p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Panel zadań"
          title="Panel zadań"
        >
          {todoOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>

        <button
          onClick={quickAdd}
          className="flex items-center gap-1 rounded-lg bg-accent-grad px-3 py-1.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110"
        >
          <Plus size={16} /> Dodaj
        </button>
      </div>

      {settingsPanel && (
        <div className="absolute right-3 top-full z-40 mt-2 w-80 max-h-[min(70vh,520px)] overflow-y-auto thin-scrollbar rounded-xl border border-line bg-surface-overlay p-3 shadow-pop">
          <div className="mb-3 flex gap-1 rounded-lg border border-line bg-surface-raised p-0.5">
            <button
              type="button"
              onClick={() => setSettingsPanel("view")}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                settingsPanel === "view"
                  ? "bg-accent text-white shadow-glow"
                  : "text-ink-light hover:text-ink"
              }`}
            >
              Widok
            </button>
            <button
              type="button"
              onClick={() => setSettingsPanel("google")}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                settingsPanel === "google"
                  ? "bg-accent text-white shadow-glow"
                  : "text-ink-light hover:text-ink"
              }`}
            >
              Google
            </button>
          </div>

          {settingsPanel === "view" ? (
            <>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Zakres widocznych godzin
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-light">
                <label className="flex items-center gap-1">
                  od
                  <input
                    type="number"
                    min={0}
                    max={settings.dayEndHour - 1}
                    value={settings.dayStartHour}
                    onChange={(e) =>
                      setSettings({
                        dayStartHour: clamp(+e.target.value, 0, settings.dayEndHour - 1),
                      })
                    }
                    className="w-16 rounded-lg border border-line bg-surface-raised px-2 py-1 text-ink"
                  />
                </label>
                <label className="flex items-center gap-1">
                  do
                  <input
                    type="number"
                    min={settings.dayStartHour + 1}
                    max={24}
                    value={settings.dayEndHour}
                    onChange={(e) =>
                      setSettings({
                        dayEndHour: clamp(+e.target.value, settings.dayStartHour + 1, 24),
                      })
                    }
                    className="w-16 rounded-lg border border-line bg-surface-raised px-2 py-1 text-ink"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                Wydarzenia spoza tego zakresu pojawią się jako „chmurki” nad i pod siatką, bez
                marnowania miejsca na puste godziny.
              </p>

              <div className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Wysokość godziny
              </div>
              <input
                type="range"
                min={36}
                max={96}
                value={settings.hourHeight}
                onChange={(e) => setSettings({ hourHeight: +e.target.value })}
                className="w-full"
              />
            </>
          ) : (
            <>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Integracja Google
              </div>
              <GoogleIntegrationPanel />
            </>
          )}
        </div>
      )}
    </header>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(v, max));
}

function UserMenu({ onClosePanels }: { onClosePanels: () => void }) {
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [ready, setReady] = useState(!cloudEnabled);
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    if (!cloudEnabled || !supabase) return;

    const syncUser = (sessionUser: Parameters<typeof authUserFromSupabaseUser>[0] | undefined) => {
      setUser(sessionUser ? authUserFromSupabaseUser(sessionUser) : null);
      setReady(true);
    };

    void supabase.auth.getSession().then(({ data }) => syncUser(data.session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      syncUser(session?.user);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatarUrl]);

  if (!cloudEnabled) {
    return (
      <span
        className="rounded-lg border border-dashed border-line px-2 py-1 text-[11px] text-ink-faint"
        title="Skopiuj .env.example → .env i uzupełnij VITE_SUPABASE_URL oraz VITE_SUPABASE_ANON_KEY, aby włączyć logowanie Google."
      >
        Tryb lokalny
      </span>
    );
  }

  if (!ready) {
    return (
      <div
        className="h-8 w-8 animate-pulse rounded-full border border-line bg-surface-raised"
        aria-label="Ładowanie konta"
      />
    );
  }

  if (!user) return null;

  const label = user.name ?? user.email ?? "Konto";
  const initials = label.slice(0, 1).toUpperCase();

  const logout = () => {
    setOpen(false);
    onClosePanels();
    void signOut();
  };

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-raised text-xs font-semibold text-ink transition hover:border-line-strong"
          title={user.email ?? label}
          aria-label="Konto użytkownika"
        >
          {user.avatarUrl && !avatarFailed ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            initials
          )}
        </button>
        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              aria-label="Zamknij menu"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-line bg-surface-overlay p-2 shadow-pop">
              <div className="px-2 pb-2">
                <div className="truncate text-sm font-medium text-ink">{label}</div>
                {user.email && user.name && (
                  <div className="truncate text-xs text-ink-faint">{user.email}</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={logout}
        className="flex items-center gap-1 rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
        title="Wyloguj"
        aria-label="Wyloguj"
      >
        <LogOut size={14} />
        <span className="hidden sm:inline">Wyloguj</span>
      </button>
    </div>
  );
}
