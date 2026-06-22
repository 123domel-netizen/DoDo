import { useState, type CSSProperties, type ReactNode } from "react";
import { addDays, addMonths, startOfDay } from "date-fns";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Plus,
  Settings2,
  Sliders,
  X,
} from "lucide-react";
import { useStore } from "@/state/store";
import type { CalendarViewKind } from "@/types";
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
import { enablePush, ensureLocalNotificationPermission, pushSupported } from "@/lib/push";
import { cloudEnabled } from "@/lib/supabase";
import { signOut } from "@/lib/auth";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { TagsSettings } from "@/components/settings/TagsSettings";
import { SyncSettings } from "@/components/settings/SyncSettings";

type Tab = "dashboard" | "calendar" | "tasks";
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
  const [settingsTab, setSettingsTab] = useState<"view" | "team" | "tags" | "sync">("view");
  const [showManage, setShowManage] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);

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

      {/* Menu główne: Dziś · Kalendarz [+] · Zadania [+] */}
      <div className="flex items-stretch gap-1.5 border-b border-line px-3 py-2">
        <TabSegment
          active={tab === "dashboard"}
          onSelect={() => setTab("dashboard")}
          icon={<LayoutDashboard size={16} />}
          label="Dziś"
        />
        <TabSegment
          active={tab === "calendar"}
          onSelect={() => setTab("calendar")}
          onAdd={addEvent}
          icon={<CalendarDays size={16} />}
          label="Kalendarz"
          addLabel="Dodaj wydarzenie"
        />
        <TabSegment
          active={tab === "tasks"}
          onSelect={() => setTab("tasks")}
          onAdd={addTask}
          icon={<ListChecks size={16} />}
          label="Zadania"
          addLabel="Dodaj zadanie"
        />
      </div>

      {/* Pasek nawigacji daty + przełącznik widoku (kalendarz) */}
      {tab === "calendar" && (
        <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
          {mobileView !== "today" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={goToday}
                className="rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink transition hover:border-line-strong"
              >
                Dziś
              </button>
              <button
                onClick={() => shift(-1)}
                className="rounded-lg p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
                aria-label="Poprzedni"
              >
                <ChevronLeft size={20} />
              </button>
              <div className="min-w-0 flex-1 truncate text-center text-sm font-medium capitalize text-ink">
                {getViewLabel(mobileView, anchor, settings.nineDayStartWeekday)}
              </div>
              <button
                onClick={() => shift(1)}
                className="rounded-lg p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
                aria-label="Następny"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          ) : (
            <div className="text-center text-sm font-medium text-ink">Dziś · wydarzenia i zadania</div>
          )}
          <div className="flex items-center gap-0.5 self-center rounded-lg border border-line bg-surface-raised p-0.5">
            {MOBILE_VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setMobileView(v.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  mobileView === v.key
                    ? "bg-accent text-white shadow-glow"
                    : "text-ink-light hover:text-ink"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chipsy filtra grup */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-3 py-2 no-scrollbar">
        <GroupChip
          label="Wszystkie"
          color="#737881"
          active={activeGroupFilter === null}
          onClick={() => setActiveGroupFilter(null)}
        />
        {userGroups.map((g) => (
          <GroupChip
            key={g.id}
            label={g.name}
            color={g.color}
            active={activeGroupFilter === g.id}
            onClick={() => setActiveGroupFilter(g.id)}
          />
        ))}
        {share && (
          <GroupChip
            label="SHARE"
            color={SHARE_GROUP_COLOR}
            active={activeGroupFilter === share.id}
            onClick={() => setActiveGroupFilter(share.id)}
          />
        )}
        {archive && (
          <GroupChip
            label={ARCHIVE_GROUP_NAME}
            color={archive.color}
            active={activeGroupFilter === archive.id}
            onClick={() => setActiveGroupFilter(archive.id)}
          />
        )}
        <button
          onClick={() => setShowManage(true)}
          className="ml-0.5 shrink-0 rounded-full border border-dashed border-line p-1.5 text-ink-faint transition hover:border-line-strong hover:text-ink"
          aria-label="Zarządzaj grupami"
        >
          <Sliders size={14} />
        </button>
        <button
          onClick={() => setShowAddGroup(true)}
          className="shrink-0 rounded-full border border-dashed border-line p-1.5 text-ink-faint transition hover:border-line-strong hover:text-ink"
          aria-label="Dodaj grupę"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Treść */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "dashboard" ? (
          <MobileDashboard />
        ) : tab === "calendar" ? (
          mobileView === "today" ? (
            <MobileTodayPanel />
          ) : (
            <CalendarView view={mobileView} />
          )
        ) : (
          <TodoPanel />
        )}
      </main>

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

            <div className="mb-3 flex gap-1 rounded-lg border border-line bg-surface-raised p-0.5">
              <button
                type="button"
                onClick={() => setSettingsTab("view")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  settingsTab === "view" ? "bg-accent text-white" : "text-ink-light hover:text-ink"
                }`}
              >
                Widok
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab("team")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  settingsTab === "team" ? "bg-accent text-white" : "text-ink-light hover:text-ink"
                }`}
              >
                Zespół
              </button>
              <button
                type="button"
                onClick={() => setSettingsTab("tags")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  settingsTab === "tags" ? "bg-accent text-white" : "text-ink-light hover:text-ink"
                }`}
              >
                Tagi
              </button>
              {cloudEnabled && (
                <button
                  type="button"
                  onClick={() => setSettingsTab("sync")}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    settingsTab === "sync" ? "bg-accent text-white" : "text-ink-light hover:text-ink"
                  }`}
                >
                  Sync
                </button>
              )}
            </div>

            {settingsTab === "view" ? (
              <ViewSettings />
            ) : settingsTab === "team" ? (
              <TeamSettings />
            ) : settingsTab === "tags" ? (
              <TagsSettings />
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

function TabSegment({
  active,
  onSelect,
  onAdd,
  icon,
  label,
  addLabel,
}: {
  active: boolean;
  onSelect: () => void;
  onAdd?: () => void;
  icon: ReactNode;
  label: string;
  addLabel?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-center rounded-xl border p-0.5 transition ${
        active ? "border-accent/60 bg-accent/10" : "border-line bg-surface-raised"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-xs font-semibold transition sm:gap-1.5 sm:px-2 sm:text-sm ${
          active ? "text-ink" : "text-ink-light"
        }`}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="flex shrink-0 items-center justify-center rounded-lg bg-accent-grad p-1.5 text-white shadow-glow transition hover:brightness-110 sm:p-2"
        >
          <Plus size={16} />
        </button>
      )}
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
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? "" : "border-dashed"
      }`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <span className="max-w-[8rem] truncate">{label}</span>
    </button>
  );
}
