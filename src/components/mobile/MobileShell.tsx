import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Settings2,
  Sliders,
  X,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { CalendarViewKind, Group } from "@/types";
import { CalendarView } from "@/components/calendar/CalendarView";
import { MobileDashboard } from "@/components/mobile/MobileDashboard";
import { MobileTodayPanel } from "@/components/mobile/MobileTodayPanel";
import { TodoPanel } from "@/components/todo/TodoPanel";
import { ItemEditorPanel } from "@/components/item/ItemEditorPanel";
import { Logo } from "@/components/brand/Logo";
import { ViewSettings } from "@/components/settings/ViewSettings";
import { GroupsModal } from "@/components/groups/GroupsModal";
import { AddGroupDialog } from "@/components/groups/AddGroupDialog";
import { getViewLabel } from "@/lib/viewLabel";
import {
  ARCHIVE_GROUP_NAME,
  findArchiveGroup,
  findShareGroup,
  groupIdForNewItem,
  sortGroupsForRail,
} from "@/lib/groups";
import { SHARE_GROUP_COLOR } from "@/lib/share";
import { enableNotificationsFlow } from "@/lib/push";
import { cloudEnabled } from "@/lib/supabase";
import { signOut } from "@/lib/auth";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { OrgSettings } from "@/components/settings/OrgSettings";
import { AppAdminSettings } from "@/components/settings/AppAdminSettings";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { useChatStore } from "@/lib/chat/store";
import { totalUnread } from "@/lib/chat/feed";
import { setRouteHash } from "@/lib/navigation";

const ChatPanel = lazy(() =>
  import("@/components/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

type Tab = "dashboard" | "calendar" | "tasks" | "chat";
type MobileCalendarMode = CalendarViewKind | "today";

const MOBILE_VIEWS: { key: MobileCalendarMode; label: string }[] = [
  { key: "today", label: "Lista" },
  { key: "day", label: "Dzień" },
  { key: "week", label: "Tydzień" },
  { key: "month", label: "Miesiąc" },
];

function chipStyle(color: string, active: boolean): CSSProperties {
  if (active) {
    return {
      background: `linear-gradient(180deg, ${color}40 0%, ${color}26 100%)`,
      borderColor: `${color}66`,
      color: "#fff",
    };
  }
  return { background: `${color}14`, borderColor: `${color}3a`, color: `${color}cc` };
}

export function MobileShell() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const startDraft = useStore((s) => s.startDraft);
  const editingId = useStore((s) => s.editingId);

  const groups = useStore((s) => s.groups);
  const activeGroupFilter = useStore((s) => s.activeGroupFilter);
  const setActiveGroupFilter = useStore((s) => s.setActiveGroupFilter);
  const addGroup = useStore((s) => s.addGroup);

  const [tab, setTab] = useState<Tab>("dashboard");
  const [mobileView, setMobileView] = useState<MobileCalendarMode>("day");
  const [sheet, setSheet] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<
    "view" | "org" | "contacts" | "tags" | "sync" | "admin"
  >("view");
  const isAppAdmin = useStore((s) => s.isAppAdmin);
  const [showManage, setShowManage] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);

  const chatUnread = useChatStore((s) => (cloudEnabled ? totalUnread(s.overview) : 0));
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  // Deep-link (push / chip „→ rozmowa") otwiera rozmowę → przełącz na zakładkę czatu.
  useEffect(() => {
    if (activeConversationId) setTab("chat");
  }, [activeConversationId]);

  const goChatHome = () => {
    setTab("chat");
    if (activeConversationId) {
      setActiveConversation(null);
      setRouteHash({ view: "chat" });
    }
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
    setTab("calendar");
    const start = new Date();
    start.setMinutes(Math.round(start.getMinutes() / 30) * 30, 0, 0);
    startDraft({
      type: "event",
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600000).toISOString(),
      groupId: groupIdForNewItem(),
    });
  };

  const addTask = () => {
    setTab("tasks");
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
          {(tab === "calendar" || tab === "tasks") && (
            <button
              type="button"
              onClick={tab === "calendar" ? addEvent : addTask}
              aria-label={tab === "calendar" ? "Dodaj wydarzenie" : "Dodaj zadanie"}
              title={tab === "calendar" ? "Dodaj wydarzenie" : "Dodaj zadanie"}
              className="flex items-center justify-center rounded-lg bg-accent-grad p-2 text-white shadow-glow transition hover:brightness-110"
            >
              <Plus size={18} />
            </button>
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

      {/* Chipsy filtra grup (nie dotyczą czatu) — nad belką kalendarza */}
      {tab !== "chat" && (
        <GroupFilterBar
          userGroups={userGroups}
          share={share}
          archive={archive}
          activeGroupFilter={activeGroupFilter}
          onSelect={setActiveGroupFilter}
          onManage={() => setShowManage(true)}
          onAdd={() => setShowAddGroup(true)}
        />
      )}

      {/* Pasek nawigacji daty + przełącznik widoku (kalendarz) */}
      {tab === "calendar" && (
        <div className="flex flex-col border-b border-line">
          {mobileView !== "today" ? (
            <div className="relative flex h-9 items-center px-2">
              <button
                type="button"
                onClick={goToday}
                className="z-10 shrink-0 px-1.5 py-1 text-[12px] font-medium text-accent transition hover:text-accent/80"
              >
                Dziś
              </button>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-0.5 px-14">
                <button
                  type="button"
                  onClick={() => shift(-1)}
                  className="pointer-events-auto rounded-md p-1.5 text-ink-faint transition hover:bg-white/[0.04] hover:text-ink"
                  aria-label="Poprzedni"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="min-w-0 truncate text-center text-[13px] font-semibold capitalize tracking-tight text-ink">
                  {getViewLabel(mobileView, anchor, settings.nineDayStartWeekday)}
                </div>
                <button
                  type="button"
                  onClick={() => shift(1)}
                  className="pointer-events-auto rounded-md p-1.5 text-ink-faint transition hover:bg-white/[0.04] hover:text-ink"
                  aria-label="Następny"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-9 items-center justify-center px-3 text-[13px] font-semibold tracking-tight text-ink">
              Dziś · wydarzenia i zadania
            </div>
          )}
          <div className="flex items-stretch">
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
        {tab === "chat" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                Ładowanie czatu…
              </div>
            }
          >
            <ChatPanel />
          </Suspense>
        ) : tab === "dashboard" ? (
          <MobileDashboard />
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

      {/* Dolne menu: Dashboard · Kalendarz · Zadania · Czat (zawsze widoczne) */}
      <nav
        className="z-30 flex shrink-0 items-stretch border-t border-line bg-surface"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Menu główne"
      >
        <BottomTab
          active={tab === "dashboard"}
          onSelect={() => setTab("dashboard")}
          icon={<LayoutDashboard size={22} strokeWidth={tab === "dashboard" ? 2.25 : 1.75} />}
          label="Dashboard"
        />
        <BottomTab
          active={tab === "calendar"}
          onSelect={() => setTab("calendar")}
          icon={<CalendarDays size={22} strokeWidth={tab === "calendar" ? 2.25 : 1.75} />}
          label="Kalendarz"
        />
        <BottomTab
          active={tab === "tasks"}
          onSelect={() => setTab("tasks")}
          icon={<ListChecks size={22} strokeWidth={tab === "tasks" ? 2.25 : 1.75} />}
          label="Zadania"
        />
        {cloudEnabled && (
          <BottomTab
            active={tab === "chat"}
            onSelect={goChatHome}
            icon={
              <MessageCircle
                size={22}
                strokeWidth={tab === "chat" || chatUnread > 0 ? 2.25 : 1.75}
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

      <AddGroupDialog
        open={showAddGroup}
        onClose={() => setShowAddGroup(false)}
        onAdd={(name, color) => addGroup(name, color)}
        groupCount={groups.length}
      />
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

type ChipItem = {
  key: string;
  label: string;
  color: string;
  filterId: string | null;
};

function GroupFilterBar({
  userGroups,
  share,
  archive,
  activeGroupFilter,
  onSelect,
  onManage,
  onAdd,
}: {
  userGroups: Group[];
  share: Group | undefined;
  archive: Group | undefined;
  activeGroupFilter: string | null;
  onSelect: (id: string | null) => void;
  onManage: () => void;
  onAdd: () => void;
}) {
  const userChips: ChipItem[] = userGroups.map((g) => ({
    key: g.id,
    label: g.name,
    color: g.color,
    filterId: g.id,
  }));

  const systemChips: ChipItem[] = [
    { key: "all", label: "ALL", color: "#737881", filterId: null },
    ...(share
      ? [{ key: share.id, label: "SHARE", color: SHARE_GROUP_COLOR, filterId: share.id }]
      : []),
    ...(archive
      ? [
          {
            key: archive.id,
            label: ARCHIVE_GROUP_NAME,
            color: archive.color,
            filterId: archive.id,
          },
        ]
      : []),
  ];

  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(userChips.length);
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;

    const layoutRows = (widths: number[], availW: number, gap: number) => {
      let rows = 1;
      let x = 0;
      for (const w of widths) {
        if (x === 0) {
          x = w;
          continue;
        }
        if (x + gap + w <= availW) {
          x += gap + w;
        } else {
          rows += 1;
          x = w;
        }
      }
      return rows;
    };

    const recompute = () => {
      const chipEls = Array.from(
        measure.querySelectorAll<HTMLElement>("[data-chip-measure]"),
      );
      const moreEl = measure.querySelector<HTMLElement>("[data-more-measure]");
      if (!chipEls.length) {
        setVisibleCount(0);
        return;
      }

      const availW = wrap.clientWidth;
      if (availW <= 0) return;

      const gap = 4;
      const widths = chipEls.map((el) => el.offsetWidth);
      const moreW = moreEl?.offsetWidth ?? 28;

      // Grupy użytkownika: max 1 wiersz (ALL/SHARE/ARCH mają osobny wiersz poniżej)
      if (layoutRows(widths, availW, gap) <= 1) {
        setVisibleCount(widths.length);
        return;
      }

      let best = 1;
      for (let n = widths.length - 1; n >= 1; n--) {
        if (layoutRows([...widths.slice(0, n), moreW], availW, gap) <= 1) {
          best = n;
          break;
        }
      }
      setVisibleCount(best);
    };

    recompute();
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [userChips.length, userChips.map((c) => `${c.key}:${c.label}`).join("|")]);

  const visible = userChips.slice(0, visibleCount);
  const hidden = userChips.slice(visibleCount);
  const hiddenActive = hidden.some((c) => c.filterId === activeGroupFilter);

  const renderChip = (c: ChipItem) => (
    <GroupChip
      key={c.key}
      label={c.label}
      color={c.color}
      active={activeGroupFilter === c.filterId}
      onClick={() => onSelect(c.filterId)}
    />
  );

  return (
    <div className="relative border-b border-line px-3 py-1.5">
      <div className="flex items-start gap-1">
        <div ref={wrapRef} className="flex min-w-0 flex-1 flex-col gap-1">
          {userChips.length > 0 && (
            <div className="flex flex-wrap content-start justify-center gap-1">
              {visible.map(renderChip)}
              {hidden.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label={`Więcej grup (${hidden.length})`}
                    aria-expanded={menuOpen}
                    className={`flex h-7 min-w-[1.875rem] shrink-0 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold transition ${
                      hiddenActive || menuOpen
                        ? "border-accent/50 bg-accent/15 text-accent"
                        : "border-dashed border-line text-ink-faint hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {menuOpen && (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-40 cursor-default"
                        aria-label="Zamknij"
                        onClick={() => setMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full z-50 mt-1 max-h-56 min-w-[10rem] overflow-y-auto rounded-lg border border-line bg-surface-overlay p-1 shadow-pop">
                        {hidden.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => {
                              onSelect(c.filterId);
                              setMenuOpen(false);
                            }}
                            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] transition ${
                              activeGroupFilter === c.filterId
                                ? "bg-accent/15 text-ink"
                                : "text-ink-light hover:bg-surface-raised hover:text-ink"
                            }`}
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: c.color }}
                            />
                            <span className="truncate">{c.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap content-start justify-center gap-1">
            {systemChips.map(renderChip)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 pt-px">
          <button
            type="button"
            onClick={onManage}
            className="shrink-0 rounded-full border border-dashed border-line p-1.5 text-ink-faint transition hover:border-line-strong hover:text-ink"
            aria-label="Zarządzaj grupami"
          >
            <Sliders size={13} />
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="shrink-0 rounded-full border border-dashed border-line p-1.5 text-ink-faint transition hover:border-line-strong hover:text-ink"
            aria-label="Dodaj grupę"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Ukryty pomiar — tylko grupy użytkownika (1 wiersz) */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute left-0 top-0 flex flex-wrap gap-1 px-3"
        aria-hidden
      >
        {userChips.map((c) => (
          <span key={c.key} data-chip-measure>
            <GroupChip label={c.label} color={c.color} active={false} onClick={() => {}} />
          </span>
        ))}
        <span data-more-measure>
          <span className="flex h-7 min-w-[1.875rem] items-center justify-center rounded-full border px-1.5">
            <MoreHorizontal size={14} />
          </span>
        </span>
      </div>
    </div>
  );
}

function GroupChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={chipStyle(color, active)}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium leading-none transition ${
        active ? "" : "border-dashed"
      }`}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="max-w-[7rem] truncate">{label}</span>
    </button>
  );
}
