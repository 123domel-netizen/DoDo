import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarRange,
  ClipboardList,
  History,
  List,
  MoreVertical,
  Pencil,
  Plus,
  Upload,
  Users,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { useStore } from "@/state/store";
import type { ScheduleEventKind } from "@/lib/projectsPreview/types";
import { AttendanceWeekView } from "./AttendanceWeekView";
import { CatalogView } from "./CatalogView";
import { BuildsFilterControl } from "./BuildsFilterControl";
import { CrewsView } from "./CrewsView";
import { EventsView } from "./EventsView";
import { ProjectsListView } from "./ProjectsListView";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { SCHEDULE_TOOLBAR_SLOT_ID, ScheduleTab } from "./ScheduleTab";

/** Board grouping — "project" is implied by `focusProjectId`. */
export type BoardMode = "allBuilds" | "byCrew";

export type ProjectsPreviewView =
  | {
      name: "board";
      mode: BoardMode;
      /** "all" = every visible budowa. */
      projectIds?: string[] | "all";
      /** Set = single budowa, plan mode. */
      focusProjectId?: string;
    }
  | { name: "events"; kind: ScheduleEventKind }
  | { name: "list"; archived?: boolean }
  | { name: "crews" }
  | { name: "attendance" }
  | { name: "catalog"; from: ProjectsPreviewView };

/** Row 1 segments. Everything else is a sub-state of one of them. */
type PrimarySection = "board" | "events" | "list" | "crews" | "attendance";

const PRIMARY_SECTIONS: Array<{
  id: PrimarySection;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "board", label: "Harmonogramy", icon: <CalendarRange size={13} /> },
  { id: "events", label: "Zdarzenia", icon: <History size={13} /> },
  { id: "crews", label: "Brygady", icon: <Users size={13} /> },
  { id: "attendance", label: "Obecność", icon: <ClipboardList size={13} /> },
  { id: "list", label: "Budowy", icon: <List size={13} /> },
];

function primaryOf(view: ProjectsPreviewView): PrimarySection {
  switch (view.name) {
    case "list":
      return "list";
    case "crews":
      return "crews";
    case "attendance":
      return "attendance";
    case "events":
      return "events";
    case "catalog":
      return primaryOf(view.from);
    default:
      return "board";
  }
}

const EVENT_KINDS: Array<{ id: ScheduleEventKind; label: string }> = [
  { id: "budowlane", label: "Budowlane" },
  { id: "dokumentacyjne", label: "Dokumentacyjne" },
];

interface ProjectsPreviewAppProps {
  onClose: () => void;
  /** Render inside main canvas (calendar slot) instead of fullscreen portal. */
  embedded?: boolean;
  /** Entry section when opened from CalendarNav (Harmonogramy / Obecności). */
  initialSection?: "board" | "attendance";
}

/**
 * HARMONOGRAMY shell.
 * Two-row chrome: row 1 never changes (sekcje), row 2 is the context bar.
 */
export function ProjectsPreviewApp({
  onClose,
  embedded = false,
  initialSection = "board",
}: ProjectsPreviewAppProps) {
  const isMobile = useIsMobile();
  const repo = useProjectsPreviewRepo();
  const setSettings = useStore((s) => s.setSettings);
  const [view, setView] = useState<ProjectsPreviewView>(() =>
    initialSection === "attendance"
      ? { name: "attendance" }
      : { name: "board", mode: "allBuilds", projectIds: "all" },
  );
  /** Row/day focused after a jump onto the board. */
  const [highlight, setHighlight] = useState<{
    blockId: string | null;
    date: string | null;
  }>({ blockId: null, date: null });
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [crewFormOpen, setCrewFormOpen] = useState(false);
  /** Shared across Tablica + Zdarzenia; also mirrored into board view.projectIds. */
  const [buildsFilter, setBuildsFilterState] = useState<string[] | "all">("all");

  /** Last sub-state per section, so row 1 does not reset the context bar. */
  const memory = useRef({
    listArchived: false,
    boardMode: "allBuilds" as BoardMode,
    boardProjectIds: "all" as string[] | "all",
    eventsKind: "budowlane" as ScheduleEventKind,
  });

  const focusedProject =
    view.name === "board" && view.focusProjectId
      ? repo.getProjectIfVisible(view.focusProjectId)
      : null;
  const isAdmin = focusedProject?.adminUserId === repo.currentUserId();

  const primary = primaryOf(view);
  const activeProjects = repo.visibleProjectList({ status: "active" });
  const canGoBack = view.name === "catalog" || Boolean(focusedProject);

  const clearFocus = () => {
    setHighlight({ blockId: null, date: null });
    setView({
      name: "board",
      mode: memory.current.boardMode,
      projectIds: memory.current.boardProjectIds,
    });
  };

  const goBack = () => {
    if (view.name === "catalog") {
      setView(view.from);
      return;
    }
    if (focusedProject) clearFocus();
  };

  const goToSection = (section: PrimarySection) => {
    if (section === "list") {
      setView({ name: "list", archived: memory.current.listArchived });
    } else if (section === "crews") {
      setView({ name: "crews" });
    } else if (section === "attendance") {
      setView({ name: "attendance" });
    } else if (section === "events") {
      setView({ name: "events", kind: memory.current.eventsKind });
    } else {
      setView({
        name: "board",
        mode: memory.current.boardMode,
        projectIds: memory.current.boardProjectIds,
      });
    }
    if (embedded) {
      setSettings({
        mainAreaMode: section === "attendance" ? "attendance" : "projects",
      });
    }
  };

  useEffect(() => {
    if (initialSection === "attendance") {
      setView((v) =>
        primaryOf(v) === "attendance" ? v : { name: "attendance" },
      );
      return;
    }
    setView((v) => {
      if (primaryOf(v) !== "attendance") return v;
      return {
        name: "board",
        mode: memory.current.boardMode,
        projectIds: memory.current.boardProjectIds,
      };
    });
  }, [initialSection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (canGoBack) goBack();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goBack derives from view
  }, [menuOpen, canGoBack, view, onClose]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const _focusProject = (
    projectId: string,
    focus?: { blockId?: string | null; date?: string | null },
  ) => {
    setHighlight({
      blockId: focus?.blockId ?? null,
      date: focus?.date ?? null,
    });
    setView({
      name: "board",
      mode: memory.current.boardMode,
      projectIds: memory.current.boardProjectIds,
      focusProjectId: projectId,
    });
  };
  void _focusProject;

  const setEventsKind = (kind: ScheduleEventKind) => {
    memory.current.eventsKind = kind;
    setView({ name: "events", kind });
  };

  const setBuildsFilter = (value: string[] | "all") => {
    memory.current.boardProjectIds = value;
    setBuildsFilterState(value);
    if (view.name === "board" && !view.focusProjectId) {
      setView({ ...view, projectIds: value });
    }
  };

  const setListArchived = (archived: boolean) => {
    memory.current.listArchived = archived;
    setView({ name: "list", archived });
  };

  const setBoardMode = (mode: BoardMode) => {
    memory.current.boardMode = mode;
    if (view.name !== "board") return;
    setView({ ...view, mode });
  };

  const openCatalog = () => {
    if (view.name !== "catalog") setView({ name: "catalog", from: view });
    setMenuOpen(false);
  };

  const listCount =
    view.name === "list"
      ? repo.visibleProjectList({ status: view.archived ? "all" : "active" })
          .length
      : 0;

  const crewCount = repo.getState().crews.length;

  const sectionLabel =
    PRIMARY_SECTIONS.find((s) => s.id === primary)?.label ?? "Harmonogramy";

  const shell = (
    <div
      className={
        embedded
          ? "relative flex h-full min-h-0 flex-1 flex-col bg-surface text-ink"
          : "fixed inset-0 z-[9000] flex flex-col bg-surface text-ink"
      }
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : true}
      aria-label="Harmonogramy"
      style={
        embedded
          ? undefined
          : { paddingTop: "env(safe-area-inset-top)" }
      }
    >
      <header className="shrink-0 border-b border-line bg-surface-raised/50">
        {isMobile ? (
          <>
            <div className="flex h-11 items-center gap-1 px-2">
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-2 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                aria-label={embedded ? "Wróć do kalendarza" : "Zamknij"}
              >
                <X size={18} />
              </button>
              {canGoBack ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="shrink-0 rounded-lg p-2 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                  aria-label="Wróć"
                >
                  <ArrowLeft size={18} />
                </button>
              ) : null}
              <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                {focusedProject ? (
                  <>
                    <span className="text-accent">#{focusedProject.number}</span>{" "}
                    {focusedProject.name}
                  </>
                ) : (
                  sectionLabel
                )}
              </div>
              {!focusedProject ? (
                <BuildsFilterControl
                  projects={activeProjects}
                  value={buildsFilter}
                  onChange={setBuildsFilter}
                  disabled={false}
                />
              ) : null}
              <div className="relative shrink-0" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="rounded-lg p-2 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                  aria-label="Narzędzia Harmonogramów"
                  aria-expanded={menuOpen}
                >
                  <MoreVertical size={18} />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface-overlay py-1 shadow-pop">
                    {PRIMARY_SECTIONS.map((s) => (
                      <MenuItem
                        key={s.id}
                        icon={s.icon}
                        label={s.label}
                        onClick={() => {
                          goToSection(s.id);
                          setMenuOpen(false);
                        }}
                      />
                    ))}
                    <div className="my-1 border-t border-line" />
                    {focusedProject && isAdmin ? (
                      <MenuItem
                        icon={<Pencil size={14} />}
                        label="Edytuj budowę"
                        onClick={() => {
                          setEditOpen(true);
                          setMenuOpen(false);
                        }}
                      />
                    ) : null}
                    <MenuItem
                      icon={<BookOpen size={14} />}
                      label="Katalog czynności"
                      onClick={openCatalog}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div
              className="flex gap-1 overflow-x-auto thin-scrollbar px-2 pb-2"
              aria-label="Sekcje Harmonogramów"
            >
              {PRIMARY_SECTIONS.map((s) => {
                const active = primary === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => goToSection(s.id)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition ${
                      active
                        ? "bg-accent/15 text-accent"
                        : "bg-surface-raised/60 text-ink-faint"
                    }`}
                  >
                    {s.icon}
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="flex min-h-9 items-center gap-1 overflow-x-auto thin-scrollbar border-t border-line/60 px-2 py-1.5">
              {view.name === "events" ? (
                <Segmented
                  options={EVENT_KINDS}
                  value={view.kind}
                  onChange={(id) => setEventsKind(id)}
                />
              ) : null}
              {view.name === "list" ? (
                <>
                  <Segmented
                    options={[
                      { id: "active", label: "Aktywne" },
                      { id: "archived", label: "Archiwum" },
                    ]}
                    value={view.archived ? "archived" : "active"}
                    onChange={(id) => setListArchived(id === "archived")}
                  />
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBulkOpen(true)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] font-medium text-ink-light"
                    >
                      <Upload size={14} />
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormOpen(true)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-accent px-2.5 text-[12px] font-semibold text-white"
                    >
                      <Plus size={14} />
                      Budowa
                    </button>
                  </div>
                </>
              ) : null}
              {view.name === "crews" ? (
                <div className="ml-auto">
                  <button
                    type="button"
                    onClick={() => setCrewFormOpen(true)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-accent px-2.5 text-[12px] font-semibold text-white"
                  >
                    <Plus size={14} />
                    Brygada
                  </button>
                </div>
              ) : null}
              <div
                id={SCHEDULE_TOOLBAR_SLOT_ID}
                className={
                  view.name === "board" || view.name === "attendance"
                    ? "flex min-w-0 flex-1 items-center"
                    : "hidden"
                }
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex h-9 items-center gap-1 px-1.5 sm:px-2">
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                aria-label={embedded ? "Wróć do kalendarza" : "Zamknij"}
                title={embedded ? "Wróć do kalendarza" : "Zamknij"}
              >
                <X size={16} />
              </button>

              <BuildsFilterControl
                projects={activeProjects}
                value={buildsFilter}
                onChange={setBuildsFilter}
                disabled={Boolean(focusedProject)}
              />

              <nav
                className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto thin-scrollbar"
                aria-label="Sekcje Harmonogramów"
              >
                {PRIMARY_SECTIONS.map((s) => {
                  const active = primary === s.id;
                  const ancestor = active && canGoBack;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => goToSection(s.id)}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition ${
                        active
                          ? ancestor
                            ? "bg-accent/[0.07] text-accent/80"
                            : "bg-accent/15 text-accent"
                          : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                      }`}
                    >
                      {s.icon}
                      {s.label}
                    </button>
                  );
                })}
              </nav>

              <div className="relative shrink-0" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  className="rounded-md p-1.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                  aria-label="Narzędzia Harmonogramów"
                  aria-expanded={menuOpen}
                >
                  <MoreVertical size={16} />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface-overlay py-1 shadow-pop">
                    {focusedProject && isAdmin ? (
                      <>
                        <MenuItem
                          icon={<Pencil size={14} />}
                          label="Edytuj budowę"
                          onClick={() => {
                            setEditOpen(true);
                            setMenuOpen(false);
                          }}
                        />
                        <div className="my-1 border-t border-line" />
                      </>
                    ) : null}
                    <MenuItem
                      icon={<BookOpen size={14} />}
                      label="Katalog czynności"
                      onClick={openCatalog}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex h-8 items-center gap-1 overflow-x-auto thin-scrollbar border-t border-line/60 px-1.5 sm:px-2">
              {canGoBack ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                  aria-label="Wróć"
                  title="Wróć"
                >
                  <ArrowLeft size={15} />
                </button>
              ) : null}

              {view.name === "events" ? (
                <Segmented
                  options={EVENT_KINDS}
                  value={view.kind}
                  onChange={(id) => setEventsKind(id)}
                />
              ) : null}

              {view.name === "list" ? (
                <>
                  <Segmented
                    options={[
                      { id: "active", label: "Aktywne" },
                      { id: "archived", label: "Archiwum" },
                    ]}
                    value={view.archived ? "archived" : "active"}
                    onChange={(id) => setListArchived(id === "archived")}
                  />
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {listCount} {pluralBudowy(listCount)}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBulkOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
                      title="Import zbiorczy"
                    >
                      <Upload size={12} />
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white transition hover:brightness-110"
                      title="Dodaj budowę"
                    >
                      <Plus size={12} />
                      Budowa
                    </button>
                  </div>
                </>
              ) : null}

              {view.name === "crews" ? (
                <>
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {crewCount} {pluralBrygady(crewCount)}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCrewFormOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white transition hover:brightness-110"
                      title="Dodaj brygadę"
                    >
                      <Plus size={12} />
                      Brygada
                    </button>
                  </div>
                </>
              ) : null}

              {view.name === "board" && focusedProject ? (
                <button
                  type="button"
                  onClick={() => isAdmin && setEditOpen(true)}
                  className="min-w-0 shrink truncate text-left text-[12px] font-semibold text-ink transition hover:text-accent"
                  title={isAdmin ? "Edytuj budowę" : projectTitle(focusedProject)}
                >
                  <span className="tabular-nums text-accent">
                    #{focusedProject.number}
                  </span>{" "}
                  {focusedProject.name}
                  {focusedProject.status === "archived" ? (
                    <span className="ml-1 text-[10px] font-normal text-ink-faint">
                      archiwum
                    </span>
                  ) : null}
                </button>
              ) : null}

              {view.name === "catalog" ? (
                <span className="shrink-0 text-[12px] font-semibold text-ink">
                  Katalog czynności
                </span>
              ) : null}

              <div
                id={SCHEDULE_TOOLBAR_SLOT_ID}
                className={
                  view.name === "board" || view.name === "attendance"
                    ? "flex min-w-0 flex-1 items-center"
                    : "hidden"
                }
              />
            </div>
          </>
        )}
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        {view.name === "board" ? (
          <ScheduleTab
            key={view.focusProjectId ?? "org-board"}
            chromeInParent
            projectId={view.focusProjectId}
            projectIds={view.projectIds}
            mode={view.focusProjectId ? "project" : view.mode}
            highlightBlockId={highlight.blockId}
            highlightDate={highlight.date}
            onFocusProject={(id) => _focusProject(id)}
            onModeChange={(mode) => {
              if (mode === "project") return;
              setBoardMode(mode);
            }}
          />
        ) : null}
        {view.name === "events" ? (
          <EventsView kind={view.kind} projectIds={buildsFilter} />
        ) : null}
        {view.name === "list" ? (
          <ProjectsListView
            showArchived={Boolean(view.archived)}
            formOpen={formOpen}
            bulkOpen={bulkOpen}
            onFormOpenChange={setFormOpen}
            onBulkOpenChange={setBulkOpen}
          />
        ) : null}
        {view.name === "crews" ? (
          <CrewsView
            createOpen={crewFormOpen}
            onCreateOpenChange={setCrewFormOpen}
            projectIds={buildsFilter}
          />
        ) : null}
        {view.name === "attendance" ? (
          <AttendanceWeekView projectIds={buildsFilter} />
        ) : null}
        {view.name === "catalog" ? <CatalogView onBack={goBack} /> : null}
      </main>

      {focusedProject ? (
        <ProjectFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          project={focusedProject}
        />
      ) : null}

    </div>
  );

  if (embedded) return shell;
  return createPortal(shell, document.body);
}

function projectTitle(p: { number: string; name: string }): string {
  return `#${p.number} ${p.name}`;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-surface-raised/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
            value === o.id
              ? "bg-accent/15 text-accent"
              : "text-ink-faint hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition hover:bg-surface-raised"
    >
      <span className="text-ink-faint">{icon}</span>
      {label}
    </button>
  );
}

/** Polish plural: 1 budowa / 2-4 budowy / 5+ budów. */
function pluralBudowy(n: number): string {
  if (n === 1) return "budowa";
  return isFewForm(n) ? "budowy" : "budów";
}

function pluralBrygady(n: number): string {
  if (n === 1) return "brygada";
  return isFewForm(n) ? "brygady" : "brygad";
}

function isFewForm(n: number): boolean {
  const rest10 = n % 10;
  const rest100 = n % 100;
  return rest10 >= 2 && rest10 <= 4 && (rest100 < 12 || rest100 > 14);
}
