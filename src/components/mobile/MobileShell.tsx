import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { useStore } from "@/state/store";
import { CalendarView } from "@/components/calendar/CalendarView";
import { MobileDashboard } from "@/components/mobile/MobileDashboard";
import { MobileRecentCorrespondences } from "@/components/mobile/MobileRecentCorrespondences";
import { GroupFilterBar } from "@/components/groups/GroupFilterBar";
import { MobileCalendarToolbar } from "@/components/calendar/MobileCalendarToolbar";
import { MobileTodayPanel } from "@/components/mobile/MobileTodayPanel";
import { TodoPanel } from "@/components/todo/TodoPanel";
import { ItemEditorPanel } from "@/components/item/ItemEditorPanel";
import { ProjectsPreviewMobileHost } from "@/components/projectsPreview/ProjectsPreviewNavButton";
import { Logo } from "@/components/brand/Logo";
import { ViewSettings } from "@/components/settings/ViewSettings";
import { GroupsModal } from "@/components/groups/GroupsModal";
import { defaultEventDraftRange } from "@/lib/eventDraft";
import {
  loadMobileCalendarView,
  saveMobileCalendarView,
  type MobileCalendarMode,
} from "@/lib/viewLabel";
import {
  findArchiveGroup,
  findShareGroup,
  groupIdForNewItem,
  sortGroupsForRail,
} from "@/lib/groups";
import { enableNotificationsFlow } from "@/lib/push";
import { cloudEnabled } from "@/lib/supabase";
import { signOut } from "@/lib/auth";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { OrgSettings } from "@/components/settings/OrgSettings";
import { AppAdminSettings } from "@/components/settings/AppAdminSettings";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { useChatStore } from "@/lib/chat/store";
import { setAttendanceLaunchIntent } from "@/lib/projectsPreview/attendanceLaunch";
import { findSelfNotesEntry, totalUnread } from "@/lib/chat/feed";
import { openSelfNotes } from "@/lib/chat/init";
import { pushRouteHash, setMobileConversationReturn, setRouteHash } from "@/lib/navigation";
import { useHistoryBackLayer } from "@/hooks/useHistoryBackLayer";

const ChatPanel = lazy(() =>
  import("@/components/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

type Tab = "dashboard" | "calendar" | "tasks" | "chat";

const MOBILE_VIEWS: { key: MobileCalendarMode; label: string }[] = [
  { key: "today", label: "Lista" },
  { key: "day", label: "Dzień" },
  { key: "week", label: "Tydzień" },
  { key: "month", label: "Miesiąc" },
];

export function MobileShell() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const startDraft = useStore((s) => s.startDraft);
  const editingId = useStore((s) => s.editingId);

  const groups = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const setActiveGroupFilter = useStore((s) => s.setActiveGroupFilter);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [schedulesMode, setSchedulesMode] = useState<
    null | "board" | "attendance"
  >(null);
  const schedulesOpen = schedulesMode !== null;
  const [mobileView, setMobileViewState] = useState<MobileCalendarMode>(
    loadMobileCalendarView,
  );
  const setMobileView = (view: MobileCalendarMode) => {
    setMobileViewState(view);
    saveMobileCalendarView(view);
  };
  const [sheet, setSheet] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<
    "view" | "org" | "contacts" | "tags" | "sync" | "admin"
  >("view");
  const isAppAdmin = useStore((s) => s.isAppAdmin);
  const [showManage, setShowManage] = useState(false);

  useHistoryBackLayer(schedulesOpen, () => setSchedulesMode(null));
  useHistoryBackLayer(sheet, () => setSheet(false));
  useHistoryBackLayer(showManage, () => setShowManage(false));
  useHistoryBackLayer(Boolean(editingId), () => useStore.getState().closeEditor());

  const chatUnread = useChatStore((s) => (cloudEnabled ? totalUnread(s.overview) : 0));
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const myUserId = useChatStore((s) => s.userId);
  const overview = useChatStore((s) => s.overview);
  const notebookId = findSelfNotesEntry(overview, myUserId)?.id ?? null;
  const notebookOpen =
    Boolean(activeConversationId) &&
    Boolean(notebookId) &&
    activeConversationId === notebookId;

  // Deep-link (push / chip „→ rozmowa") otwiera rozmowę → przełącz na zakładkę czatu.
  useEffect(() => {
    if (activeConversationId) {
      setSchedulesMode(null);
      setTab("chat");
    }
  }, [activeConversationId]);

  const goChatHome = () => {
    setSchedulesMode(null);
    setTab("chat");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash({ view: "chat" });
    }
  };

  const goDashboard = () => {
    setSchedulesMode(null);
    setTab("dashboard");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash(null);
    }
  };

  const goNotebook = () => {
    if (!cloudEnabled) return;
    setSchedulesMode(null);
    setMobileConversationReturn("dashboard");
    void openSelfNotes().then((id) => {
      if (!id) return;
      setTab("chat");
      pushRouteHash({ view: "conversation", conversationId: id });
    });
  };

  const goCalendar = () => {
    setSchedulesMode(null);
    setTab("calendar");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash(null);
    }
  };

  const goTasks = () => {
    setSchedulesMode(null);
    setTab("tasks");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash(null);
    }
  };

  const goSchedules = () => {
    setSchedulesMode("board");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash(null);
    }
  };

  const goAttendance = () => {
    setSchedulesMode("attendance");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash(null);
    }
  };

  const goAddAttendance = (workDate: string) => {
    setAttendanceLaunchIntent({ action: "add", workDate });
    goAttendance();
  };

  const anchor = new Date(settings.anchorDate);

  const shift = (dir: number) => {
    if (mobileView === "month") {
      setSettings({ anchorDate: startOfDay(addMonths(anchor, dir)).toISOString() });
    } else if (mobileView === "week") {
      setSettings({ anchorDate: startOfDay(addDays(anchor, dir * 7)).toISOString() });
    } else {
      setSettings({ anchorDate: startOfDay(addDays(anchor, dir)).toISOString() });
    }
  };

  const goToday = () => setSettings({ anchorDate: startOfDay(new Date()).toISOString() });

  const addEvent = () => {
    const day =
      mobileView === "today" ? startOfDay(new Date()) : startOfDay(anchor);
    const { start, end } = defaultEventDraftRange(day);
    startDraft({
      type: "event",
      start,
      end,
      groupId: groupIdForNewItem(),
    });
  };

  const addTask = () => {
    goTasks();
    startDraft({
      type: "task",
      hasDueDate: false,
      showInTodo: true,
      showInCalendar: false,
      groupId: groupIdForNewItem(),
    });
  };

  const enableNotifications = async () => {
    const res = await enableNotificationsFlow();
    alert(res.message);
  };

  const userGroups = sortGroupsForRail(groups);
  const archive = findArchiveGroup(groups);
  const share = findShareGroup(groups);

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Pasek górny */}
      <header
        className="glass z-30 flex items-center gap-2 border-b border-line px-3 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <Logo size={24} />

        <div className="ml-auto flex items-center gap-1">
          {(tab === "calendar" || tab === "tasks") && !schedulesOpen && (
            <>
              <button
                type="button"
                onClick={goDashboard}
                className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-ink-light transition hover:bg-surface-overlay hover:text-ink"
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={tab === "calendar" ? addEvent : addTask}
                aria-label={tab === "calendar" ? "Dodaj wydarzenie" : "Dodaj zadanie"}
                title={tab === "calendar" ? "Dodaj wydarzenie" : "Dodaj zadanie"}
                className="flex items-center justify-center rounded-lg bg-accent-grad p-2 text-white shadow-glow transition hover:brightness-110"
              >
                <Plus size={18} />
              </button>
            </>
          )}
          <button
            onClick={enableNotifications}
            className="rounded-lg p-2 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
            aria-label="Powiadomienia"
          >
            <Bell size={18} />
          </button>
          <button
            onClick={() => setSheet((v) => !v)}
            className={`rounded-lg p-2 transition hover:bg-surface-overlay hover:text-ink ${
              sheet ? "bg-surface-overlay text-ink" : "text-ink-light"
            }`}
            aria-label="Ustawienia"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      {/* Chipsy filtra grup (nie dotyczą czatu / Harmonogramów) — nad belką kalendarza */}
      {tab !== "chat" && !schedulesOpen && (
        <GroupFilterBar
          userGroups={userGroups}
          share={share}
          archive={archive}
          activeGroupFilter={activeGroupFilter}
          onSelect={setActiveGroupFilter}
          onManage={() => setShowManage(true)}
        />
      )}

      {/* Pasek nawigacji daty + przełącznik widoku (kalendarz) */}
      {tab === "calendar" && !schedulesOpen && (
        <div className="flex flex-col border-b border-line">
          <MobileCalendarToolbar
            view={mobileView}
            anchor={anchor}
            nineDayStartWeekday={settings.nineDayStartWeekday}
            onToday={goToday}
            onShift={shift}
            onAddEvent={addEvent}
          />
          <div className="flex items-stretch border-t border-line/50">
            {MOBILE_VIEWS.map((v) => {
              const active = mobileView === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setMobileView(v.key)}
                  className={`relative min-w-0 flex-1 px-1 py-2 text-[12px] font-medium transition ${
                    active ? "text-ink" : "text-ink-faint hover:text-ink-light"
                  }`}
                >
                  {v.label}
                  {active && (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Treść */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {schedulesOpen ? (
          <ProjectsPreviewMobileHost
            key={schedulesMode}
            onClose={() => setSchedulesMode(null)}
            initialSection={
              schedulesMode === "attendance" ? "attendance" : "board"
            }
          />
        ) : tab === "chat" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                Ładowanie czatu…
              </div>
            }
          >
            <ChatPanel onLeaveConversation={goDashboard} />
          </Suspense>
        ) : tab === "dashboard" ? (
          <MobileDashboard
            onOpenSchedules={goSchedules}
            onOpenAttendance={goAttendance}
            onAddAttendance={goAddAttendance}
            onOpenNotebook={goNotebook}
          />
        ) : tab === "calendar" ? (
          mobileView === "today" ? (
            <MobileTodayPanel />
          ) : (
            <CalendarView
              view={mobileView}
              onViewDay={(day) => {
                setSettings({ anchorDate: startOfDay(day).toISOString() });
                setMobileView("day");
              }}
            />
          )
        ) : (
          <TodoPanel />
        )}
      </main>

      {/* Ostatnie korespondencje — tylko na Dashboardzie (nie w czacie / rozmowie). */}
      {!schedulesOpen &&
        (tab === "dashboard" || tab === "calendar" || tab === "tasks") && (
          <MobileRecentCorrespondences />
        )}

      {/* Dolne menu: Dashboard · Wydarzenia · Zadania · Czat */}
      <nav
        className="z-30 flex shrink-0 items-stretch border-t border-line bg-surface"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Menu główne"
      >
        <BottomTab
          active={tab === "dashboard" && !schedulesOpen}
          onSelect={goDashboard}
          icon={
            <LayoutDashboard
              size={22}
              strokeWidth={tab === "dashboard" && !schedulesOpen ? 2.25 : 1.75}
            />
          }
          label="Dashboard"
        />
        <BottomTab
          active={tab === "calendar" && !schedulesOpen}
          onSelect={goCalendar}
          icon={
            <CalendarDays
              size={22}
              strokeWidth={tab === "calendar" && !schedulesOpen ? 2.25 : 1.75}
            />
          }
          label="Wydarzenia"
        />
        <BottomTab
          active={tab === "tasks" && !schedulesOpen}
          onSelect={goTasks}
          icon={
            <CheckSquare
              size={22}
              strokeWidth={tab === "tasks" && !schedulesOpen ? 2.25 : 1.75}
            />
          }
          label="Zadania"
        />
        {cloudEnabled && (
          <BottomTab
            active={tab === "chat" && !schedulesOpen && !notebookOpen}
            onSelect={goChatHome}
            icon={
              <MessageCircle
                size={22}
                strokeWidth={
                  (tab === "chat" && !schedulesOpen && !notebookOpen) ||
                  chatUnread > 0
                    ? 2.25
                    : 1.75
                }
                fill={chatUnread > 0 ? "currentColor" : "none"}
              />
            }
            label="Czat"
            badge={chatUnread}
            emphasize={chatUnread > 0}
          />
        )}
      </nav>

      {/* Edytor pełnoekranowy */}
      {editingId && (
        <div
          className="fixed inset-0 z-50 bg-surface"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <ItemEditorPanel />
        </div>
      )}

      {/* Panel ustawień (dolny arkusz) */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Zamknij ustawienia"
            onClick={() => setSheet(false)}
          />
          <div
            className="relative max-h-[80vh] overflow-y-auto thin-scrollbar rounded-t-2xl border-t border-line bg-surface-overlay p-4 shadow-pop"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
            <div className="mb-3 flex items-center gap-2">
              <div className="flex-1 text-sm font-semibold text-ink">Ustawienia</div>
              <button
                type="button"
                onClick={() => setSheet(false)}
                className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                aria-label="Zamknij"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-line bg-surface-raised p-0.5">
              {(
                [
                  { id: "view" as const, label: "Widok" },
                  { id: "org" as const, label: "Zespół" },
                  { id: "contacts" as const, label: "Kontakty" },
                  { id: "tags" as const, label: "Tagi" },
                  ...(cloudEnabled ? [{ id: "sync" as const, label: "Sync" }] : []),
                  ...(isAppAdmin ? [{ id: "admin" as const, label: "Admin" }] : []),
                ] as { id: typeof settingsTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSettingsTab(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    settingsTab === tab.id
                      ? "bg-accent text-white"
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

            {cloudEnabled && (
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
              >
                <LogOut size={15} /> Wyloguj
              </button>
            )}
          </div>
        </div>
      )}

      <GroupsModal open={showManage} onClose={() => setShowManage(false)} />
    </div>
  );
}

function BottomTab({
  active,
  onSelect,
  icon,
  label,
  badge = 0,
  emphasize = false,
}: {
  active: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  /** Np. nieodczytane — lekko wyróżnij nawet gdy tab nieaktywny. */
  emphasize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition ${
        active || emphasize ? "text-accent" : "text-ink-faint"
      }`}
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        {icon}
        {badge > 0 && (
          <span className="absolute -right-2.5 -top-1.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-white shadow-sm ring-2 ring-surface">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span
        className={`truncate text-[10px] leading-tight ${
          active || emphasize ? "font-semibold" : "font-medium"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
