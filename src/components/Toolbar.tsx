import { useEffect, useState } from "react";
import {
  Settings2,
  Bell,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { enableNotificationsFlow, hasActivePushSubscription } from "@/lib/push";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { authUserFromSupabaseUser, signOut, type AuthUserInfo } from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { ViewSettings } from "@/components/settings/ViewSettings";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { OrgSettings } from "@/components/settings/OrgSettings";
import { AppAdminSettings } from "@/components/settings/AppAdminSettings";
import { SyncSettings } from "@/components/settings/SyncSettings";

type SettingsTab = "view" | "org" | "contacts" | "tags" | "sync" | "admin";

interface ToolbarProps {
  todoOpen: boolean;
  onToggleTodo: () => void;
}

export function Toolbar({ todoOpen, onToggleTodo }: ToolbarProps) {
  const isAppAdmin = useStore((s) => s.isAppAdmin);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("view");

  const enableNotifications = async () => {
    const res = await enableNotificationsFlow();
    setPushOn(res.mode === "push" || (await hasActivePushSubscription()));
    alert(res.message);
  };

  const [pushOn, setPushOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void hasActivePushSubscription().then((on) => {
      if (!cancelled) setPushOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="glass relative z-30 flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div className="mr-1 flex items-center gap-2">
        <Logo size={26} />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          className={`rounded-lg p-1.5 transition hover:bg-surface-overlay hover:text-ink ${
            settingsOpen ? "bg-surface-overlay text-ink" : "text-ink-light"
          }`}
          aria-label="Ustawienia widoku"
          title="Ustawienia widoku (godziny, wysokość siatki)"
        >
          <Settings2 size={18} />
        </button>

        <UserMenu onClosePanels={() => setSettingsOpen(false)} />

        <button
          onClick={enableNotifications}
          className={`rounded-lg p-1.5 transition hover:bg-surface-overlay hover:text-ink ${
            pushOn ? "text-accent" : "text-ink-light"
          }`}
          aria-label="Powiadomienia"
          title={
            pushOn
              ? "Powiadomienia push włączone"
              : "Włącz powiadomienia (wymagane, żeby dzwoniło przy wiadomości)"
          }
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
      </div>

      {settingsOpen && (
        <div className="absolute right-3 top-full z-40 mt-2 w-[22rem] max-h-[min(70vh,560px)] overflow-y-auto thin-scrollbar rounded-xl border border-line bg-surface-overlay p-3 shadow-pop">
          <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-line bg-surface-raised p-0.5">
            {(
              [
                { id: "view", label: "Widok" },
                { id: "org", label: "Zespół" },
                { id: "contacts", label: "Kontakty" },
                { id: "tags", label: "Tagi" },
                ...(cloudEnabled ? [{ id: "sync" as const, label: "Sync" }] : []),
                ...(isAppAdmin ? [{ id: "admin" as const, label: "Admin" }] : []),
              ] as { id: SettingsTab; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSettingsTab(tab.id)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  settingsTab === tab.id
                    ? "bg-accent text-white shadow-glow"
                    : "text-ink-light hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {settingsTab === "view" ? (
            <ViewSettings />
          ) : settingsTab === "org" ? (
            <OrgSettings />
          ) : settingsTab === "contacts" ? (
            <TeamSettings />
          ) : settingsTab === "tags" ? (
            <TagsSettings />
          ) : settingsTab === "admin" ? (
            <AppAdminSettings />
          ) : (
            <SyncSettings />
          )}
        </div>
      )}
    </header>
  );
}

function UserMenu({ onClosePanels }: { onClosePanels: () => void }) {
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [ready, setReady] = useState(!cloudEnabled);
  const [open, setOpen] = useState(false);
  const profileAvatar = useChatStore((s) =>
    user?.id ? s.profiles[user.id]?.avatarUrl : undefined,
  );

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
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-raised transition hover:border-line-strong"
          title={user.email ?? label}
          aria-label="Konto użytkownika"
        >
          <PersonAvatar
            userId={user.id}
            avatarUrl={profileAvatar}
            size={32}
            className="border-0"
          />
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
              <div className="flex items-center gap-2.5 px-2 pb-2">
                <PersonAvatar
                  userId={user.id}
                  avatarUrl={profileAvatar}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{label}</div>
                  {user.email && user.name && (
                    <div className="truncate text-xs text-ink-faint">{user.email}</div>
                  )}
                </div>
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
