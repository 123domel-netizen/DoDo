import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderTree,
  LayoutTemplate,
  Layers,
  Pencil,
  Plus,
  ChevronDown,
  ChevronRight,
  FoldVertical,
  UnfoldVertical,
  GanttChart,
  List,
  Users,
  X,
  Zap,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import { scheduleOverflow } from "@/lib/projectsPreview/scheduleOverflow";
import {
  formatDayShort,
} from "@/lib/projectsPreview/projectLastEvent";
import {
  projectStageLabel,
  todayIso,
} from "@/lib/projectsPreview/projectMetrics";
import {
  categoryCollapseKey,
  collapseAllScheduleRows,
  expandScheduleRowsStep,
  filterCollapsedBoardRows,
  loadScheduleCollapseState,
  loadScheduleShowCategories,
  nextExpandStepLabel,
  projectCollapseKey,
  saveScheduleCollapseState,
  saveScheduleShowCategories,
  subcategoryCollapseKey,
  toggleCollapsedKey,
  type ScheduleRevealLevel,
} from "@/lib/projectsPreview/scheduleRowCollapse";
import { softenScheduleColor } from "@/lib/projectsPreview/softenScheduleColor";
import { visibleCrews } from "@/lib/projectsPreview/search";
import {
  DOC_EVENT_STATUS_LABEL,
  PROJECT_LEVEL_EVENT_CATEGORY,
  SCHEDULE_EVENT_KIND_LABEL,
  SCHEDULE_STATUS_LABEL,
  isProjectLevelEventCategory,
  projectLabel,
  scheduleEventLabel,
  type PreviewCrew,
  type PreviewProject,
  type ScheduleBlock,
  type ScheduleBlockRole,
  type ScheduleBlockStatus,
  type ScheduleCategoryMeta,
  type ScheduleEvent,
  type ScheduleEventKind,
  type SupervisionCatalogPreset,
} from "@/lib/projectsPreview/types";
import type { ScheduleCatalogPreset } from "@/lib/projectsPreview/scheduleCatalog";
import {
  BAR_MIN_PX,
  DEFAULT_VISIBLE_DAYS,
  FIT_LOOKBACK_DAYS,
  MARKER_MIN_DAY_PX,
  ZOOM_PRESETS,
  type ZoomPresetId,
  dayPxAfterWheel,
  dayPxForVisibleDays,
  expandRangeToMinDays,
  buildScheduleContentRange,
  isoAtChartX,
  scrollLeftForAnchor,
  scrollLeftForDayStart,
  startOfWeekIso,
  ticksForRange,
  weekendBandStyle,
} from "@/lib/projectsPreview/scheduleZoom";
import { CrewEditorSheet } from "./CrewEditorSheet";
import { IsoDateInput } from "./IsoDateInput";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { ScheduleEventSheet } from "./ScheduleEventSheet";

export type ScheduleViewMode = "project" | "allBuilds" | "byCrew";

export const SCHEDULE_TOOLBAR_SLOT_ID = "projects-preview-schedule-toolbar";

interface ScheduleTabProps {
  /** Focused single budowa (mode "project"). */
  projectId?: string;
  /** Org-mode scope. "all" / undefined = every visible budowa. */
  projectIds?: string[] | "all";
  /** Render toolbar into parent header slot instead of a second bar. */
  chromeInParent?: boolean;
  /** Row to focus after a jump from the queue panel. */
  highlightBlockId?: string | null;
  /** Day to scroll to after a jump (used when the event has no block). */
  highlightDate?: string | null;
  /** Controlled board mode. Left out → the board keeps its own mode. */
  mode?: ScheduleViewMode;
  onModeChange?: (mode: ScheduleViewMode) => void;
  /** Mobile list: open a single budowa on the board. */
  onFocusProject?: (projectId: string) => void;
}

const STATUSES = Object.keys(SCHEDULE_STATUS_LABEL) as ScheduleBlockStatus[];
const LABEL_PX = 220;
/** Tick header — needs room for weekday + date. */
const HEADER_H = 30;
/** Budowa / brygada section strip. */
const ROW_SECTION = 26;
/** Category envelope. */
const ROW_CATEGORY = 26;
/** Subcategory planned window. */
const ROW_SUBCATEGORY = 26;
/** Work / zakres bars (primary content). */
const ROW_WORK = 28;
/** Select „Inny” w arkuszu kategorii — własna nazwa. */
const CATEGORY_INNY_VALUE = "__inny__";

function newCustomCategoryId(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `custom-${slug || "kategoria"}-${suffix}`;
}

/** Compact PL date range for labels/tooltips: 22.07–02.08 */
function shortDateRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${d}.${m}`;
  };
  if (start === end) return fmt(start);
  return `${fmt(start)}–${fmt(end)}`;
}

export function ScheduleTab({
  projectId,
  projectIds,
  chromeInParent = false,
  highlightBlockId = null,
  highlightDate = null,
  mode: modeProp,
  onModeChange,
  onFocusProject,
}: ScheduleTabProps) {
  const isMobile = useIsMobile();
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const [mobileSurface, setMobileSurface] = useState<"list" | "timeline">(
    "list",
  );
  const showMobileList = isMobile && mobileSurface === "list";
  const labelPx = isMobile ? 132 : LABEL_PX;
  const [ownMode, setOwnMode] = useState<ScheduleViewMode>(
    modeProp ?? (projectId ? "project" : "allBuilds"),
  );
  const mode = projectId ? "project" : (modeProp ?? ownMode);
  const setMode = (next: ScheduleViewMode) => {
    if (modeProp === undefined) setOwnMode(next);
    onModeChange?.(next);
  };
  const [editing, setEditing] = useState<ScheduleBlock | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<{
    parentId?: string | null;
    role?: ScheduleBlockRole;
    categoryId?: string;
    projectId?: string;
    /** Toolbar „Dodaj pozycję” — wybór Kategoria / Podkategoria / Zakres. */
    pickPositionKind?: boolean;
    /** Prefill po powrocie z tworzenia kategorii. */
    scopePreset?: string;
    customScope?: string;
    startDate?: string;
    endDate?: string;
    crewId?: string;
    status?: ScheduleBlockStatus;
    note?: string;
    color?: string;
  }>({});
  /** Po zapisaniu nowej kategorii wróć do formularza zakresu/podkategorii. */
  const [resumeBlockAfterCategory, setResumeBlockAfterCategory] = useState(false);
  const [createNonce, setCreateNonce] = useState(0);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [overflowHint, setOverflowHint] = useState<string | null>(null);
  const [eventEdit, setEventEdit] = useState<{
    projectId: string;
    blockId: string | null;
    categoryId?: string;
    event: ScheduleEvent | null;
    kind: ScheduleEventKind;
  } | null>(null);
  const [crewEdit, setCrewEdit] = useState<PreviewCrew | null | "new">(null);
  const [projectEdit, setProjectEdit] = useState<PreviewProject | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<{
    projectId: string;
    categoryId: string;
    label: string;
    window?: { start: string; end: string };
    title: string;
    note: string;
  } | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [dayPx, setDayPx] = useState(() =>
    dayPxForVisibleDays(1100, DEFAULT_VISIBLE_DAYS),
  );
  const [rangeMinDays, setRangeMinDays] = useState<number | null>(null);
  const [activeZoomId, setActiveZoomId] = useState<ZoomPresetId | null>("1m");
  /** Zwijanie wierszy — localStorage (poziom + pojedyncze klucze). */
  const [collapsedRowKeys, setCollapsedRowKeys] = useState(
    () => loadScheduleCollapseState().collapsed,
  );
  const [revealLevel, setRevealLevel] = useState<ScheduleRevealLevel>(
    () => loadScheduleCollapseState().revealLevel,
  );
  const [showCategoryRows, setShowCategoryRows] = useState(
    () => loadScheduleShowCategories(),
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const conflictsRef = useRef<HTMLDivElement>(null);
  const didInitView = useRef(false);

  const myProjects = useMemo(
    () =>
      state.projects.filter(
        (p) =>
          p.adminUserId === state.viewAsUserId ||
          p.memberIds.includes(state.viewAsUserId),
      ),
    [state.projects, state.viewAsUserId],
  );

  const crews = useMemo(
    () => visibleCrews(state.crews, state.viewAsUserId),
    [state.crews, state.viewAsUserId],
  );

  /** Budowy currently on the board — one when focused, filtered set otherwise. */
  const scopeProjects = useMemo(() => {
    if (projectId) {
      return myProjects.filter((p) => p.id === projectId);
    }
    if (!projectIds || projectIds === "all") return myProjects;
    const wanted = new Set(projectIds);
    return myProjects.filter((p) => wanted.has(p.id));
  }, [myProjects, projectId, projectIds]);

  const scopeIds = useMemo(
    () => new Set(scopeProjects.map((p) => p.id)),
    [scopeProjects],
  );

  const blocks = useMemo(
    () => state.scheduleBlocks.filter((b) => scopeIds.has(b.projectId)),
    [state.scheduleBlocks, scopeIds],
  );

  const workBlocks = useMemo(
    () => blocks.filter((b) => b.role === "work"),
    [blocks],
  );

  /** All events in scope — Tablica always shows both kinds as markers. */
  const scheduleEvents = useMemo(
    () => state.scheduleEvents.filter((e) => scopeIds.has(e.projectId)),
    [state.scheduleEvents, scopeIds],
  );

  const eventsByBlock = useMemo(() => {
    const inScope = new Set(blocks.map((b) => b.id));
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of scheduleEvents) {
      // Documentary events live on the investment row, not on categories/blocks.
      if (e.kind === "dokumentacyjne") continue;
      if (!e.blockId || !inScope.has(e.blockId)) continue;
      const list = m.get(e.blockId) ?? [];
      list.push(e);
      m.set(e.blockId, list);
    }
    return m;
  }, [scheduleEvents, blocks]);

  const conflicts = repo.crewConflicts();
  const conflictIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      s.add(c.a.id);
      s.add(c.b.id);
    }
    return s;
  }, [conflicts]);

  const contentRange = useMemo(() => {
    const today = todayIso();
    const metaDates = state.categoryMeta
      .filter((m) => scopeIds.has(m.projectId))
      .flatMap((m) => [m.startDate, m.endDate]);
    // Always include every block role (works + subcategories) and category
    // planned windows — otherwise long presets clip off the board edges.
    return buildScheduleContentRange(
      [
        ...blocks.flatMap((b) => [b.startDate, b.endDate]),
        ...metaDates,
        ...scheduleEvents.map((e) => e.date),
        today,
        addDaysIso(today, -FIT_LOOKBACK_DAYS),
        addDaysIso(today, 40),
      ],
      3,
      today,
    );
  }, [blocks, scheduleEvents, state.categoryMeta, scopeIds]);

  const range = useMemo(
    () => expandRangeToMinDays(contentRange, rangeMinDays, todayIso()),
    [contentRange, rangeMinDays],
  );

  const crewName = (id: string) =>
    id ? (state.crews.find((c) => c.id === id)?.name ?? "Brygada") : "Bez brygady";

  const openEditor = (
    block: ScheduleBlock | null,
    defaults?: {
      parentId?: string | null;
      role?: ScheduleBlockRole;
      categoryId?: string;
      projectId?: string;
      pickPositionKind?: boolean;
    },
  ) => {
    if (block) {
      setEditing(block);
      setCreating(false);
      setCreatingCategory(false);
      setCreateDefaults({});
    } else {
      setCreating(true);
      setEditing(null);
      setCreatingCategory(false);
      setCreateDefaults(defaults ?? {});
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setCreating(false);
    setCreatingCategory(false);
    setCreateDefaults({});
    setResumeBlockAfterCategory(false);
  };

  const openNewCategory = (defaults?: {
    projectId?: string;
    resumeBlock?: boolean;
    blockDraft?: typeof createDefaults;
  }) => {
    setCreatingCategory(true);
    setCreating(false);
    setEditing(null);
    setResumeBlockAfterCategory(Boolean(defaults?.resumeBlock));
    setCreateDefaults({
      ...(defaults?.blockDraft ?? {}),
      projectId: defaults?.projectId ?? defaults?.blockDraft?.projectId,
      pickPositionKind: true,
    });
  };

  const defaultEventProjectId =
    projectId ?? scopeProjects[0]?.id ?? state.projects[0]?.id ?? "";

  const openEventSheet = (opts: {
    projectId?: string;
    block?: ScheduleBlock | null;
    categoryId?: string;
    event?: ScheduleEvent | null;
    kind?: ScheduleEventKind;
  }) => {
    const owner =
      opts.event?.projectId ??
      opts.block?.projectId ??
      opts.projectId ??
      defaultEventProjectId;
    if (!owner) return;
    setEventEdit({
      projectId: owner,
      blockId: opts.event?.blockId ?? opts.block?.id ?? null,
      categoryId:
        opts.event?.categoryId ??
        opts.categoryId ??
        opts.block?.categoryId,
      event: opts.event ?? null,
      kind: opts.event?.kind ?? opts.kind ?? "budowlane",
    });
  };

  const moveBlock = (
    id: string,
    startDate: string,
    endDate: string,
    opts?: { shiftChildrenByDays?: number },
  ) => {
    const block = state.scheduleBlocks.find((b) => b.id === id);
    repo.moveScheduleBlock(id, startDate, endDate, opts);
    if (block?.role === "work" && block.parentId) {
      const parent = state.scheduleBlocks.find((b) => b.id === block.parentId);
      if (parent && scheduleOverflow({ startDate, endDate }, parent).outside) {
        setOverflowHint("Robota nie mieści się w oknie terminów podkategorii");
        window.setTimeout(() => setOverflowHint(null), 4000);
      }
    }
  };

  const byId = useMemo(() => {
    const m = new Map<string, ScheduleBlock>();
    for (const b of blocks) m.set(b.id, b);
    return m;
  }, [blocks]);

  const rows = useMemo(() => {
    if (mode === "byCrew") {
      return buildByCrewRows(workBlocks, crews, state.projects);
    }
    if (mode === "allBuilds") {
      return buildAllBuildsRows(
        blocks,
        scopeProjects,
        state.scheduleCatalog,
        state.catalog,
        crewName,
        scheduleEvents,
        state.categoryMeta,
      );
    }
    return buildProjectScopeRows(
      blocks,
      state.scheduleCatalog,
      state.catalog,
      crewName,
      scheduleEvents,
      projectId ?? defaultEventProjectId,
      state.categoryMeta,
      {
        includeDocLane: true,
        investmentLabel: (() => {
          const pid = projectId ?? defaultEventProjectId;
          const p = state.projects.find((x) => x.id === pid);
          return p ? projectLabel(p) : "Inwestycja";
        })(),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- crewName derives from crews
  }, [
    mode,
    workBlocks,
    blocks,
    projectId,
    defaultEventProjectId,
    scopeProjects,
    scheduleEvents,
    crews,
    state.projects,
    state.scheduleCatalog,
    state.catalog,
    state.categoryMeta,
  ]);

  /** Wiele budów naraz → tylko kategorie; pojedyncza budowa → od razu rozwinięte. */
  const collapseInventory = useMemo(() => {
    const projectKeys: string[] = [];
    const categoryKeys: string[] = [];
    const subcategoryKeys: string[] = [];
    for (const row of rows) {
      if (
        row.section &&
        row.projectId &&
        !row.crew &&
        !row.docLane
      ) {
        projectKeys.push(projectCollapseKey(row.projectId));
      }
      if (row.categoryLane && row.projectId && row.categoryId) {
        categoryKeys.push(categoryCollapseKey(row.projectId, row.categoryId));
      }
      if (row.subcategory) {
        const subId = row.blocks[0]?.id ?? row.id;
        if ((row.childBlocks?.length ?? 0) > 0) {
          subcategoryKeys.push(subcategoryCollapseKey(subId));
        }
      }
    }
    return { projectKeys, categoryKeys, subcategoryKeys };
  }, [rows]);

  const boardRows = useMemo(
    () =>
      // Widok brygad: zawsze pełna lista robót pod sekcjami (bez drzewa kategorii).
      mode === "byCrew"
        ? rows
        : filterCollapsedBoardRows(rows, collapsedRowKeys, revealLevel, {
            showCategoryRows,
          }),
    [mode, rows, collapsedRowKeys, revealLevel, showCategoryRows],
  );

  const toggleProjectCollapse = (projectId: string) => {
    const key = projectCollapseKey(projectId);
    setCollapsedRowKeys((prev) => toggleCollapsedKey(prev, key, revealLevel));
  };

  const toggleCategoryCollapse = (projectId: string, categoryId: string) => {
    const key = categoryCollapseKey(projectId, categoryId);
    // Expanding a category should at least reveal subcategory rows.
    const nextLvl: ScheduleRevealLevel = revealLevel < 1 ? 1 : revealLevel;
    setRevealLevel(nextLvl);
    setCollapsedRowKeys((prev) => toggleCollapsedKey(prev, key, nextLvl));
  };

  const toggleSubcategoryCollapse = (subcategoryId: string) => {
    const key = subcategoryCollapseKey(subcategoryId);
    const nextLvl: ScheduleRevealLevel = revealLevel < 2 ? 2 : revealLevel;
    setRevealLevel(nextLvl);
    setCollapsedRowKeys((prev) => toggleCollapsedKey(prev, key, nextLvl));
  };

  const minimizeAllRows = () => {
    const next = collapseAllScheduleRows(collapseInventory);
    setCollapsedRowKeys(next.collapsed);
    setRevealLevel(next.revealLevel);
  };

  const expandRowsStep = () => {
    const next = expandScheduleRowsStep(collapseInventory, revealLevel);
    setCollapsedRowKeys(next.collapsed);
    setRevealLevel(next.revealLevel);
  };

  // A budowa with no plan and no events has nothing to show.
  const projectModeEmpty =
    mode === "project" &&
    Boolean(projectId) &&
    blocks.length === 0 &&
    scheduleEvents.length === 0;
  const showEmptyPanel = rows.length === 0 || projectModeEmpty;

  /** Align so today is visible with ~5 days of lookback on the left (when range allows). */
  const scrollToToday = (
    opts?: { dayPx?: number; rangeStart?: string; smooth?: boolean },
  ) => {
    const el = scrollerRef.current;
    if (!el) return;
    const px = opts?.dayPx ?? dayPx;
    const start = opts?.rangeStart ?? range.start;
    const today = todayIso();
    let anchor = addDaysIso(today, -5);
    if (anchor < start) anchor = start;
    if (anchor > range.end) anchor = start;
    el.scrollTo({
      left: scrollLeftForDayStart({
        rangeStart: start,
        dayPx: px,
        iso: anchor,
      }),
      behavior: opts?.smooth === false ? "auto" : "smooth",
    });
  };

  /** Align the Monday of `iso`'s week to the left edge of the chart. */
  const scrollToWeekStart = (
    iso: string,
    opts?: { dayPx?: number; rangeStart?: string; smooth?: boolean },
  ) => {
    const el = scrollerRef.current;
    if (!el) return;
    const px = opts?.dayPx ?? dayPx;
    const start = opts?.rangeStart ?? range.start;
    let weekStart = startOfWeekIso(iso);
    if (weekStart < start) weekStart = start;
    if (weekStart > range.end) weekStart = startOfWeekIso(range.end);
    el.scrollTo({
      left: scrollLeftForDayStart({
        rangeStart: start,
        dayPx: px,
        iso: weekStart,
      }),
      behavior: opts?.smooth === false ? "auto" : "smooth",
    });
  };

  const scrollToDay = (
    iso: string,
    opts?: { dayPx?: number; rangeStart?: string; smooth?: boolean },
  ) => {
    const el = scrollerRef.current;
    if (!el) return;
    const px = opts?.dayPx ?? dayPx;
    const start = opts?.rangeStart ?? range.start;
    const target =
      labelPx + dayOffset(start, iso) * px - el.clientWidth / 2;
    el.scrollTo({
      left: Math.max(0, target),
      behavior: opts?.smooth === false ? "auto" : "smooth",
    });
  };

  const applyZoomPreset = (preset: (typeof ZOOM_PRESETS)[number]) => {
    const el = scrollerRef.current;
    const avail = Math.max(200, (el?.clientWidth ?? 900) - labelPx);
    const nextMin =
      preset.visibleDays === null ? null : preset.minRangeDays;
    const nextPx =
      preset.visibleDays === null
        ? dayPxForVisibleDays(avail, contentRange.days)
        : dayPxForVisibleDays(avail, preset.visibleDays);
    const today = todayIso();
    const nextRange = expandRangeToMinDays(
      contentRange,
      nextMin,
      today,
    );
    setRangeMinDays(nextMin);
    setDayPx(nextPx);
    setActiveZoomId(preset.id);
    requestAnimationFrame(() => {
      if (preset.id === "fit") {
        // Left edge = 14 days before today (clamped to painted range).
        let anchor = addDaysIso(today, -FIT_LOOKBACK_DAYS);
        if (anchor < nextRange.start) anchor = nextRange.start;
        if (anchor > nextRange.end) anchor = nextRange.start;
        el?.scrollTo({
          left: scrollLeftForDayStart({
            rangeStart: nextRange.start,
            dayPx: nextPx,
            iso: anchor,
          }),
          behavior: "smooth",
        });
        return;
      }
      // Other presets: keep the current week at the left edge.
      scrollToWeekStart(today, {
        dayPx: nextPx,
        rangeStart: nextRange.start,
        smooth: true,
      });
    });
  };

  const scopeKey =
    (projectId ?? "") + "|" + scopeProjects.map((p) => p.id).join(",");
  const lastInitedScope = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (highlightBlockId || highlightDate) return;
    if (showEmptyPanel) return;
    const el = scrollerRef.current;
    if (!el) return;

    if (lastInitedScope.current !== scopeKey) {
      lastInitedScope.current = scopeKey;
      didInitView.current = false;
    }
    if (didInitView.current) return;

    const avail = Math.max(200, el.clientWidth - labelPx);
    const nextPx = dayPxForVisibleDays(avail, DEFAULT_VISIBLE_DAYS);
    if (Math.abs(nextPx - dayPx) > 0.5) {
      setDayPx(nextPx);
      setActiveZoomId("1m");
      // Wait for the next paint with the real dayPx before scrolling.
      return;
    }

    const today = todayIso();
    let weekStart = startOfWeekIso(today);
    if (weekStart < range.start) weekStart = range.start;
    if (weekStart > range.end) weekStart = startOfWeekIso(range.end);
    el.scrollLeft = scrollLeftForDayStart({
      rangeStart: range.start,
      dayPx,
      iso: weekStart,
    });
    didInitView.current = true;
    setActiveZoomId("1m");
  }, [
    scopeKey,
    showEmptyPanel,
    range.start,
    range.end,
    contentRange.days,
    dayPx,
    highlightBlockId,
    highlightDate,
    rows.length,
  ]);

  useEffect(() => {
    const target = highlightBlockId
      ? byId.get(highlightBlockId)?.startDate
      : highlightDate;
    if (!target) return;
    const id = window.setTimeout(() => scrollToDay(target), 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll once per jump target
  }, [highlightBlockId, highlightDate, byId, range.start]);

  useEffect(() => {
    if (!conflictsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!conflictsRef.current?.contains(e.target as Node)) {
        setConflictsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [conflictsOpen]);

  useLayoutEffect(() => {
    if (!chromeInParent) {
      setToolbarSlot(null);
      return;
    }
    setToolbarSlot(document.getElementById(SCHEDULE_TOOLBAR_SLOT_ID));
  }, [chromeInParent]);

  const toolbar = (
    <div
      className={
        chromeInParent
          ? "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto thin-scrollbar"
          : "flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 sm:px-4"
      }
    >
      {mode !== "project" ? (
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-raised/70 p-0.5">
          {(
            [
              ["allBuilds", "Wg budów"],
              ["byCrew", "Wg brygad"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === id
                  ? "bg-accent/20 text-accent shadow-sm"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="relative shrink-0" ref={conflictsRef}>
          <button
            type="button"
            onClick={() => setConflictsOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md bg-amber-950/40 px-2 py-1 text-[10px] font-medium text-amber-200 transition hover:bg-amber-900/50"
            title="Ostrzeżenie — nie blokuje zapisu. Kliknij, aby zobaczyć pary."
            aria-expanded={conflictsOpen}
          >
            <AlertTriangle size={12} className="shrink-0" />
            <span className="tabular-nums">{conflicts.length}</span>
            <span className="hidden sm:inline">
              {conflicts.length === 1 ? "konflikt" : "konflikty"}
            </span>
          </button>
          {conflictsOpen ? (
            <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-80 overflow-y-auto thin-scrollbar rounded-xl border border-line bg-surface-overlay p-1 shadow-pop">
              <p className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                Ta sama brygada w dwóch miejscach
              </p>
              {conflicts.map((c, i) => (
                <div
                  key={`${c.a.id}-${c.b.id}-${i}`}
                  className="rounded-lg px-2 py-1.5 hover:bg-surface-raised"
                >
                  <div className="text-[11px] font-semibold text-ink">
                    {crewName(c.crewId)}
                  </div>
                  {[c.a, c.b].map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setConflictsOpen(false);
                        scrollToDay(b.startDate);
                        openEditor(b);
                      }}
                      className="mt-0.5 block w-full truncate text-left text-[11px] text-ink-light hover:text-accent"
                    >
                      {projectNumberLabel(state.projects, b.projectId)}{" "}
                      {b.title || b.scope} · {b.startDate} → {b.endDate}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {overflowHint ? (
        <span
          className="inline-flex max-w-[10rem] shrink-0 items-center gap-1 truncate rounded-md bg-amber-950/40 px-2 py-1 text-[10px] font-medium text-amber-200"
          title={overflowHint}
        >
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">{overflowHint}</span>
        </span>
      ) : null}

      {!showMobileList ? (
        <>
          <div
            className="mx-0.5 hidden h-4 w-px shrink-0 bg-line sm:block"
            aria-hidden
          />
          <div
            className="flex shrink-0 items-center gap-0.5"
            title="Ctrl+scroll — zoom osi"
          >
            {(isMobile
              ? ZOOM_PRESETS.filter((p) => p.id === "1m" || p.id === "1q")
              : ZOOM_PRESETS
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyZoomPreset(preset)}
                aria-pressed={activeZoomId === preset.id}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                  activeZoomId === preset.id
                    ? "bg-surface-raised text-ink"
                    : "text-ink-faint hover:bg-surface-raised/70 hover:text-ink"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => scrollToToday()}
            className="inline-flex shrink-0 items-center rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-110"
            title="Pokaż dziś (z 5 dniami wstecz, jeśli jest miejsce)"
          >
            Dziś
          </button>
        </>
      ) : null}

      <div className="min-w-2 flex-1" aria-hidden />

      <div className="flex shrink-0 items-center gap-1.5">
        {isMobile ? (
          <button
            type="button"
            onClick={() =>
              setMobileSurface((s) => (s === "list" ? "timeline" : "list"))
            }
            className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
              showMobileList
                ? "border-line text-ink-light"
                : "border-accent/40 bg-accent/15 text-accent"
            }`}
            title={showMobileList ? "Pokaż oś czasu" : "Pokaż listę"}
          >
            {showMobileList ? <GanttChart size={13} /> : <List size={13} />}
            {showMobileList ? "Oś" : "Lista"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => openEventSheet({ kind: "budowlane" })}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/12 px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20"
          title="Dodaj zdarzenie"
        >
          <Zap size={13} strokeWidth={2.25} />
          <span className="hidden sm:inline">Zdarzenie</span>
        </button>
        <button
          type="button"
          onClick={() =>
            openEditor(null, { pickPositionKind: true, role: "work" })
          }
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-110"
          title="Dodaj pozycję harmonogramu"
        >
          <Plus size={14} strokeWidth={2.5} />
          <span className="hidden sm:inline">Dodaj pozycję</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {chromeInParent && toolbarSlot
        ? createPortal(toolbar, toolbarSlot)
        : !chromeInParent
          ? toolbar
          : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {showEmptyPanel ? (
          <ScheduleEmptyPanel
            mode={mode}
            onAddWork={() => openEditor(null)}
            onAddCrew={() => setCrewEdit("new")}
            onSeedTemplate={
              projectId
                ? () => {
                    const created = repo.seedScheduleTemplate(projectId);
                    if (created.length === 0) {
                      alert("Wszystkie etapy z katalogu są już w planie.");
                    }
                  }
                : undefined
            }
          />
        ) : showMobileList ? (
          <ScheduleMobileList
            mode={mode}
            projects={scopeProjects}
            crews={crews}
            blocks={blocks}
            events={scheduleEvents}
            catalog={state.scheduleCatalog}
            onOpenProject={(id) => {
              onFocusProject?.(id);
              setMobileSurface("list");
            }}
            onOpenTimeline={() => setMobileSurface("timeline")}
            onEditBlock={(b) => openEditor(b)}
            onEditEvent={(event) =>
              openEventSheet({ event, kind: event.kind })
            }
            onAddEvent={(pid) =>
              openEventSheet({ kind: "budowlane", projectId: pid })
            }
            onAddCrew={() => setCrewEdit("new")}
            onEditCrew={(crew) => setCrewEdit(crew)}
          />
        ) : (
          <TimelineBoard
            rows={boardRows}
            range={range}
            crews={crews}
            conflictIds={conflictIds}
            blockById={byId}
            eventsByBlock={eventsByBlock}
            highlightBlockId={highlightBlockId}
            scrollerRef={scrollerRef}
            dayPx={dayPx}
            labelPx={labelPx}
            compactMarkers={isMobile}
            onDayPxChange={(next) => {
              setActiveZoomId(null);
              setDayPx(next);
            }}
            labelHeader={
              mode === "byCrew"
                ? "Brygada"
                : mode === "allBuilds"
                  ? "Budowa"
                  : "Pozycja"
            }
            onEdit={openEditor}
            onMove={moveBlock}
            onMoveCategory={(projectId, categoryId, start, end, opts) => {
              repo.moveCategoryWindow(projectId, categoryId, start, end, opts);
            }}
            categoryCollapse={
              mode === "byCrew"
                ? undefined
                : {
                    collapsedKeys: collapsedRowKeys,
                    revealLevel,
                    showCategoryRows,
                    onToggleShowCategories: () => {
                      setShowCategoryRows((prev) => {
                        const next = !prev;
                        saveScheduleShowCategories(next);
                        return next;
                      });
                    },
                    onToggleProject: toggleProjectCollapse,
                    onToggleCategory: toggleCategoryCollapse,
                    onToggleSubcategory: toggleSubcategoryCollapse,
                    onMinimizeAll: minimizeAllRows,
                    onExpandStep: expandRowsStep,
                    expandStepLabel: nextExpandStepLabel(revealLevel),
                  }
            }
            onEditCrew={
              mode === "byCrew" ? (crew) => setCrewEdit(crew) : undefined
            }
            onAddChild={
              mode !== "byCrew"
                ? (parent) =>
                    openEditor(null, {
                      parentId: parent.id,
                      role: "work",
                      categoryId: parent.categoryId,
                      projectId: parent.projectId,
                    })
                : undefined
            }
            onAddUnderCategory={
              mode !== "byCrew"
                ? (opts) =>
                    openEditor(null, {
                      categoryId: opts.categoryId,
                      projectId: opts.projectId,
                      // Z + przy kategorii: domyślnie podkategoria (można przełączyć na zakres).
                      role: "subcategory",
                    })
                : undefined
            }
            onEditCategory={
              mode !== "byCrew"
                ? (opts) => {
                    const catalogTitle = resolveCategoryTitle(
                      opts.categoryId,
                      state.scheduleCatalog,
                      state.catalog,
                    );
                    const meta = state.categoryMeta.find(
                      (m) =>
                        m.projectId === opts.projectId &&
                        m.categoryId === opts.categoryId,
                    );
                    setCategoryEdit({
                      projectId: opts.projectId,
                      categoryId: opts.categoryId,
                      label: catalogTitle,
                      window: opts.window,
                      title: meta?.title ?? "",
                      note: meta?.note ?? "",
                    });
                  }
                : undefined
            }
            onAddUnderProject={
              mode === "allBuilds" || mode === "project"
                ? (pid) =>
                    openNewCategory({
                      projectId: pid,
                      // Z + przy inwestycji: zakres może od razu trafić na wiersz budowy.
                      blockDraft: {
                        categoryId: PROJECT_LEVEL_EVENT_CATEGORY,
                        role: "work",
                      },
                    })
                : undefined
            }
            onEditProject={
              mode === "allBuilds"
                ? (pid) => {
                    const p = state.projects.find((x) => x.id === pid);
                    if (p) setProjectEdit(p);
                  }
                : undefined
            }
            onAddCategoryEvent={(opts, kind) =>
              openEventSheet({
                projectId: opts.projectId,
                categoryId: opts.categoryId,
                kind,
              })
            }
            onAddProjectEvent={(pid) =>
              openEventSheet({
                projectId: pid,
                kind: "budowlane",
              })
            }
            onEditEvent={(event) => openEventSheet({ event })}
          />
        )}
      </div>

      {(editing || creating) && (
        <BlockEditorSheet
          key={
            editing?.id ??
            `new-${createNonce}-${createDefaults.categoryId ?? "cat"}-${createDefaults.parentId ?? (createDefaults.pickPositionKind ? "pick" : "root")}`
          }
          block={editing}
          creating={creating}
          createDefaults={createDefaults}
          defaultProjectId={
            createDefaults.projectId ??
            projectId ??
            scopeProjects[0]?.id ??
            ""
          }
          projects={myProjects.length ? myProjects : state.projects}
          crews={crews}
          onAddCrew={() => setCrewEdit("new")}
          scheduleCatalog={state.scheduleCatalog}
          allBlocks={
            projectId
              ? state.scheduleBlocks.filter((b) => b.projectId === projectId)
              : state.scheduleBlocks
          }
          onClose={closeEditor}
          onSave={(data) => {
            if (data.newCategoryTitle) {
              repo.upsertCategoryMeta({
                projectId: data.projectId,
                categoryId: data.categoryId,
                title: data.newCategoryTitle,
                note: "",
              });
            }
            repo.upsertScheduleBlock(data);
            // Zakres mógł być niewidoczny przy zwiniętej inwestycji / poziomie „tylko kategorie”.
            if (data.role === "work") {
              const projectLevel = isProjectLevelEventCategory(data.categoryId);
              const nextLvl: ScheduleRevealLevel = projectLevel
                ? revealLevel
                : revealLevel < 2
                  ? 2
                  : revealLevel;
              setCollapsedRowKeys((prev) => {
                const next = new Set(prev);
                next.delete(projectCollapseKey(data.projectId));
                if (!projectLevel) {
                  next.delete(
                    categoryCollapseKey(data.projectId, data.categoryId),
                  );
                  if (data.parentId) {
                    next.delete(subcategoryCollapseKey(data.parentId));
                  }
                }
                saveScheduleCollapseState(next, nextLvl);
                return next;
              });
              if (nextLvl !== revealLevel) setRevealLevel(nextLvl);
            }
            closeEditor();
          }}
          onPickCategory={(draft) => {
            openNewCategory({
              projectId:
                draft?.projectId ??
                createDefaults.projectId ??
                projectId ??
                scopeProjects[0]?.id,
              resumeBlock: true,
              blockDraft: {
                ...createDefaults,
                ...draft,
                role: draft?.role ?? createDefaults.role ?? "work",
              },
            });
          }}
          onPromote={
            editing?.role === "work" &&
            !editing.parentId &&
            !isProjectLevelEventCategory(editing.categoryId)
              ? () => {
                  repo.promoteToSubcategory(editing.id);
                  closeEditor();
                }
              : undefined
          }
          onDemote={
            editing?.role === "subcategory"
              ? () => {
                  repo.demoteSubcategory(editing.id, { keepAsWork: false });
                  closeEditor();
                }
              : undefined
          }
          onDelete={
            editing
              ? () => {
                  repo.deleteScheduleBlock(editing.id);
                  closeEditor();
                }
              : undefined
          }
        />
      )}

      {creatingCategory ? (
        <CategoryLaneSheet
          key="new-category"
          creating
          showKindPicker={Boolean(createDefaults.pickPositionKind)}
          categoryId={state.scheduleCatalog.categories[0]?.id ?? "stan-0"}
          catalogTitle={
            state.scheduleCatalog.categories[0]?.title ?? "Kategoria"
          }
          initialTitle=""
          initialNote=""
          projectId={
            createDefaults.projectId ??
            projectId ??
            scopeProjects[0]?.id ??
            ""
          }
          projects={myProjects.length ? myProjects : state.projects}
          scheduleCatalog={state.scheduleCatalog}
          onClose={closeEditor}
          onAddSubcategory={() =>
            openEditor(null, {
              pickPositionKind: true,
              role: "subcategory",
              projectId:
                createDefaults.projectId ??
                projectId ??
                scopeProjects[0]?.id,
              // Podkategoria wymaga kategorii katalogowej.
              categoryId: isProjectLevelEventCategory(createDefaults.categoryId)
                ? undefined
                : createDefaults.categoryId,
            })
          }
          onAddWork={() =>
            openEditor(null, {
              pickPositionKind: true,
              role: "work",
              projectId:
                createDefaults.projectId ??
                projectId ??
                scopeProjects[0]?.id,
              categoryId: createDefaults.categoryId,
            })
          }
          onSave={(data) => {
            const pid =
              data.projectId ||
              createDefaults.projectId ||
              projectId ||
              scopeProjects[0]?.id;
            if (!pid) return;
            repo.upsertCategoryMeta({
              projectId: pid,
              categoryId: data.categoryId,
              title: data.title,
              note: data.note,
            });
            if (resumeBlockAfterCategory) {
              const draft = { ...createDefaults };
              setCreatingCategory(false);
              setResumeBlockAfterCategory(false);
              setCreating(true);
              setEditing(null);
              setCreateNonce((n) => n + 1);
              setCreateDefaults({
                ...draft,
                projectId: pid,
                categoryId: data.categoryId,
                role: draft.role ?? "work",
                pickPositionKind: false,
              });
              return;
            }
            closeEditor();
          }}
        />
      ) : null}

      {eventEdit ? (
        <ScheduleEventSheet
          key={
            eventEdit.event?.id ??
            `new-event-${eventEdit.blockId ?? eventEdit.categoryId ?? "cat"}`
          }
          projectId={eventEdit.projectId}
          project={
            state.projects.find((p) => p.id === eventEdit.projectId) ?? null
          }
          blocks={state.scheduleBlocks.filter(
            (b) => b.projectId === eventEdit.projectId,
          )}
          categoryMeta={state.categoryMeta.filter(
            (m) => m.projectId === eventEdit.projectId,
          )}
          blockId={eventEdit.blockId}
          defaultCategoryId={eventEdit.categoryId}
          event={eventEdit.event}
          defaultKind={eventEdit.kind}
          lockKind={Boolean(eventEdit.event)}
          defaultDate={todayIso()}
          catalog={state.catalog}
          scheduleCatalog={state.scheduleCatalog}
          users={state.users}
          onClose={() => setEventEdit(null)}
          onSave={(data) => {
            repo.upsertScheduleEvent(data);
            setEventEdit(null);
          }}
          onDelete={
            eventEdit.event
              ? () => {
                  repo.deleteScheduleEvent(eventEdit.event!.id);
                  setEventEdit(null);
                }
              : undefined
          }
        />
      ) : null}

      {categoryEdit ? (
        <CategoryLaneSheet
          key={`${categoryEdit.projectId}-${categoryEdit.categoryId}`}
          categoryId={categoryEdit.categoryId}
          catalogTitle={categoryEdit.label}
          initialTitle={categoryEdit.title}
          initialNote={categoryEdit.note}
          window={categoryEdit.window}
          scheduleCatalog={state.scheduleCatalog}
          onClose={() => setCategoryEdit(null)}
          onSave={(data) => {
            if (data.categoryId !== categoryEdit.categoryId) {
              repo.reclassifyProjectCategory(
                categoryEdit.projectId,
                categoryEdit.categoryId,
                data.categoryId,
              );
            }
            repo.upsertCategoryMeta({
              projectId: categoryEdit.projectId,
              categoryId: data.categoryId,
              title: data.title,
              note: data.note,
            });
            setCategoryEdit(null);
          }}
          onAddSubcategory={() => {
            const { projectId: pid, categoryId: cid } = categoryEdit;
            setCategoryEdit(null);
            openEditor(null, {
              projectId: pid,
              categoryId: cid,
              role: "subcategory",
            });
          }}
          onAddWork={() => {
            const { projectId: pid, categoryId: cid } = categoryEdit;
            setCategoryEdit(null);
            openEditor(null, {
              projectId: pid,
              categoryId: cid,
              role: "work",
            });
          }}
          onDelete={() => {
            const { projectId: pid, categoryId: cid } = categoryEdit;
            repo.removeProjectCategory(pid, cid);
            setCategoryEdit(null);
          }}
        />
      ) : null}

      {crewEdit !== null ? (
        <CrewEditorSheet
          crew={crewEdit === "new" ? null : crewEdit}
          users={state.users}
          currentUserId={state.viewAsUserId}
          onClose={() => setCrewEdit(null)}
          onSave={(data) => {
            repo.upsertCrew(data);
            setCrewEdit(null);
            if (mode !== "byCrew" && !projectId) setMode("byCrew");
          }}
          onDelete={
            crewEdit !== "new"
              ? () => {
                  const res = repo.deleteCrew(crewEdit.id);
                  if (!res.ok) {
                    alert(res.error);
                    return;
                  }
                  setCrewEdit(null);
                }
              : undefined
          }
        />
      ) : null}

      <ProjectFormDialog
        open={Boolean(projectEdit)}
        project={projectEdit}
        onClose={() => setProjectEdit(null)}
      />
    </div>
  );
}

type TimelineRow = {
  id: string;
  label: string;
  color?: string;
  meta?: string;
  /** Category / project / crew section header (no bars). */
  section?: boolean;
  /** Investment-level documentary events lane. */
  docLane?: boolean;
  /** Category lane — chart track for category-level events. */
  categoryLane?: boolean;
  /** Zakres na wierszu inwestycji (Bez kategorii). */
  projectLevel?: boolean;
  categoryId?: string;
  projectId?: string;
  /** Subcategory container row. */
  subcategory?: boolean;
  /** Child work indented under subcategory. */
  indented?: boolean;
  /** Parent subcategory for overflow visuals. */
  parentId?: string | null;
  /** When set, row is a crew lane — show edit pencil. */
  crew?: PreviewCrew;
  blocks: ScheduleBlock[];
  /** Child works for subcategory ghost spill. */
  childBlocks?: ScheduleBlock[];
  /** Events rendered on this row (category lane or leftover). */
  looseEvents?: ScheduleEvent[];
  /** Planned window for category lane (manual or derived from children). */
  categoryWindow?: { start: string; end: string };
  /** Span of child blocks — grey spill when outside planned window. */
  categoryBlockWindow?: { start: string; end: string };
};

function rowHeightOf(row: TimelineRow): number {
  if (row.categoryLane) return ROW_CATEGORY;
  if (row.subcategory) return ROW_SUBCATEGORY;
  return ROW_WORK;
}

function categoryEventsForLane(
  events: ScheduleEvent[],
  projectId: string,
  categoryId: string,
  blockIds: Set<string>,
): ScheduleEvent[] {
  return events.filter(
    (e) =>
      e.kind === "budowlane" &&
      e.projectId === projectId &&
      e.categoryId === categoryId &&
      !isProjectLevelEventCategory(e.categoryId) &&
      (!e.blockId || !blockIds.has(e.blockId)),
  );
}

/** Docs + budowlane pinned to the investment row (not a category lane). */
function projectHeaderEvents(
  events: ScheduleEvent[],
  projectId: string,
): ScheduleEvent[] {
  return events.filter(
    (e) =>
      e.projectId === projectId &&
      (e.kind === "dokumentacyjne" ||
        (e.kind === "budowlane" && isProjectLevelEventCategory(e.categoryId))),
  );
}

function projectDocEvents(
  events: ScheduleEvent[],
  projectId: string,
): ScheduleEvent[] {
  return events.filter(
    (e) => e.projectId === projectId && e.kind === "dokumentacyjne",
  );
}

function projectLevelBudowlaneEvents(
  events: ScheduleEvent[],
  projectId: string,
): ScheduleEvent[] {
  return events.filter(
    (e) =>
      e.projectId === projectId &&
      e.kind === "budowlane" &&
      isProjectLevelEventCategory(e.categoryId),
  );
}

function spanFromBlocks(
  blocks: ScheduleBlock[],
): { start: string; end: string } | null {
  if (blocks.length === 0) return null;
  let start = blocks[0]!.startDate;
  let end = blocks[0]!.endDate;
  for (const b of blocks) {
    if (b.startDate < start) start = b.startDate;
    if (b.endDate > end) end = b.endDate;
  }
  return { start, end };
}

function extendSpanWithEvents(
  span: { start: string; end: string } | null,
  events: ScheduleEvent[],
): { start: string; end: string } | null {
  let start = span?.start ?? null;
  let end = span?.end ?? null;
  for (const e of events) {
    if (!start || e.date < start) start = e.date;
    if (!end || e.date > end) end = e.date;
  }
  return start && end ? { start, end } : null;
}

function resolveCategoryTitle(
  catId: string,
  scheduleCatalog: ScheduleCatalogPreset,
  docCatalog: SupervisionCatalogPreset,
): string {
  if (catId === "inny") return "Inny";
  return (
    scheduleCatalog.categories.find((c) => c.id === catId)?.title ??
    docCatalog.categories.find((c) => c.id === catId)?.title ??
    catId
  );
}

function buildProjectScopeRows(
  blocks: ScheduleBlock[],
  scheduleCatalog: ScheduleCatalogPreset,
  docCatalog: SupervisionCatalogPreset,
  crewName: (id: string) => string,
  events: ScheduleEvent[],
  projectId: string,
  categoryMeta: ScheduleCategoryMeta[] = [],
  opts?: { includeDocLane?: boolean; investmentLabel?: string },
): TimelineRow[] {
  const cats = scheduleCatalog.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const byCat = new Map<string, ScheduleBlock[]>();
  const projectLevelWorks: ScheduleBlock[] = [];
  for (const b of blocks) {
    if (isProjectLevelEventCategory(b.categoryId)) {
      if (b.role === "work") projectLevelWorks.push(b);
      continue;
    }
    const key = b.categoryId || "stan-0";
    const list = byCat.get(key) ?? [];
    list.push(b);
    byCat.set(key, list);
  }
  projectLevelWorks.sort((a, b) => a.startDate.localeCompare(b.startDate));
  const blockIds = new Set(blocks.map((b) => b.id));
  const metaFor = (catId: string) =>
    categoryMeta.find(
      (m) => m.projectId === projectId && m.categoryId === catId,
    );

  const appendProjectLevelWorkRows = (): TimelineRow[] =>
    projectLevelWorks.map((b) => ({
      id: b.id,
      label: b.title || b.scope,
      meta: crewName(b.crewId),
      color: b.color,
      indented: true,
      projectLevel: true,
      projectId,
      categoryId: PROJECT_LEVEL_EVENT_CATEGORY,
      blocks: [b],
    }));

  const appendCatRows = (catId: string, catLabel: string, list: ScheduleBlock[]) => {
    const laneEvents = categoryEventsForLane(
      events,
      projectId,
      catId,
      blockIds,
    );
    const allCatEvents = events.filter(
      (e) =>
        e.projectId === projectId &&
        e.categoryId === catId &&
        !isProjectLevelEventCategory(e.categoryId),
    );
    const blockWindow = spanFromBlocks(list);
    const eventSpan = extendSpanWithEvents(null, allCatEvents);
    const meta = metaFor(catId);
    const plannedFromMeta =
      meta?.startDate && meta?.endDate
        ? { start: meta.startDate, end: meta.endDate }
        : null;
    const categoryWindow =
      plannedFromMeta ?? blockWindow ?? eventSpan ?? null;
    const displayLabel = meta?.title?.trim() || catLabel;
    const tipBits = [
      categoryWindow
        ? shortDateRange(categoryWindow.start, categoryWindow.end)
        : null,
      meta?.note?.trim() || null,
    ].filter(Boolean);
    const rows: TimelineRow[] = [];
    if (list.length === 0 && laneEvents.length === 0 && !meta) return rows;

    rows.push({
      id: `cat-${projectId}-${catId}`,
      label: displayLabel,
      meta: tipBits.length ? tipBits.join("\n") : undefined,
      categoryLane: true,
      categoryId: catId,
      projectId,
      blocks: [],
      childBlocks: list,
      looseEvents: laneEvents,
      categoryWindow: categoryWindow ?? undefined,
      categoryBlockWindow: blockWindow ?? undefined,
    });

    const subcats = list
      .filter((b) => b.role === "subcategory")
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const topWorks = list
      .filter((b) => b.role === "work" && !b.parentId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    for (const sub of subcats) {
      const children = list
        .filter((b) => b.role === "work" && b.parentId === sub.id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      rows.push({
        id: sub.id,
        label: sub.title || sub.scope,
        meta: shortDateRange(sub.startDate, sub.endDate),
        color: sub.color,
        subcategory: true,
        indented: true,
        projectId,
        categoryId: catId,
        blocks: [sub],
        childBlocks: children,
      });
      for (const child of children) {
        const overflow = scheduleOverflow(child, sub);
        rows.push({
          id: child.id,
          label: child.title || child.scope,
          meta: `${crewName(child.crewId)}${overflow.outside ? " · poza oknem" : ""}`,
          color: child.color,
          indented: true,
          parentId: sub.id,
          projectId,
          categoryId: catId,
          blocks: [child],
        });
      }
    }

    for (const b of topWorks) {
      rows.push({
        id: b.id,
        label: b.title || b.scope,
        meta: crewName(b.crewId),
        color: b.color,
        indented: true,
        projectId,
        categoryId: catId,
        blocks: [b],
      });
    }
    return rows;
  };

  const rows: TimelineRow[] = [];
  if (opts?.includeDocLane) {
    rows.push({
      id: `inv-lane-${projectId}`,
      label: opts.investmentLabel?.trim() || "Inwestycja",
      section: true,
      projectId,
      blocks: [],
      looseEvents: projectLevelBudowlaneEvents(events, projectId),
    });
    rows.push(...appendProjectLevelWorkRows());
    rows.push({
      id: `doc-lane-${projectId}`,
      label: "Dokumentacja",
      section: true,
      docLane: true,
      projectId,
      blocks: [],
      looseEvents: projectDocEvents(events, projectId),
    });
  } else {
    rows.push(...appendProjectLevelWorkRows());
  }
  const seen = new Set<string>();
  for (const cat of cats) {
    seen.add(cat.id);
    rows.push(
      ...appendCatRows(cat.id, cat.title, byCat.get(cat.id) ?? []),
    );
  }
  const extraIds = new Set<string>([
    ...byCat.keys(),
    ...events
      .filter(
        (e) =>
          e.kind === "budowlane" && !isProjectLevelEventCategory(e.categoryId),
      )
      .map((e) => e.categoryId)
      .filter((id): id is string => Boolean(id)),
    ...categoryMeta
      .filter(
        (m) =>
          m.projectId === projectId &&
          !isProjectLevelEventCategory(m.categoryId),
      )
      .map((m) => m.categoryId),
  ]);
  for (const catId of extraIds) {
    if (seen.has(catId) || isProjectLevelEventCategory(catId)) continue;
    seen.add(catId);
    rows.push(
      ...appendCatRows(
        catId,
        resolveCategoryTitle(catId, scheduleCatalog, docCatalog),
        byCat.get(catId) ?? [],
      ),
    );
  }
  return rows;
}

/** Wszystkie budowy: sekcja budowy → kategorie → podkategorie / roboty. */
function buildAllBuildsRows(
  blocks: ScheduleBlock[],
  projects: PreviewProject[],
  scheduleCatalog: ScheduleCatalogPreset,
  docCatalog: SupervisionCatalogPreset,
  crewName: (id: string) => string,
  events: ScheduleEvent[],
  categoryMeta: ScheduleCategoryMeta[] = [],
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const p of projects) {
    const projectBlocks = blocks.filter((b) => b.projectId === p.id);
    const projectEvents = events.filter((e) => e.projectId === p.id);
    const headerEvents = projectHeaderEvents(projectEvents, p.id);
    const catRows = buildProjectScopeRows(
      projectBlocks,
      scheduleCatalog,
      docCatalog,
      crewName,
      projectEvents,
      p.id,
      categoryMeta,
    );
    // Pusta inwestycja (bez kategorii, zakresów i zdarzeń na wierszu) — pomijamy.
    if (catRows.length === 0 && headerEvents.length === 0) continue;
    rows.push({
      id: `sec-proj-${p.id}`,
      label: projectLabel(p),
      section: true,
      projectId: p.id,
      blocks: [],
      looseEvents: headerEvents,
    });
    rows.push(...catRows);
  }
  return rows;
}

/** Według brygad: sekcja brygady + jeden wiersz na robotę. */
function buildByCrewRows(
  workBlocks: ScheduleBlock[],
  crews: PreviewCrew[],
  projects: PreviewProject[],
): TimelineRow[] {
  const projectLabelOf = (id: string) => {
    const p = projects.find((x) => x.id === id);
    return p ? projectLabel(p) : "Budowa";
  };
  const rows: TimelineRow[] = [];
  const lanes: Array<{ crew: PreviewCrew | null; list: ScheduleBlock[] }> =
    crews.map((crew) => ({
      crew,
      list: workBlocks.filter((b) => b.crewId === crew.id),
    }));
  const unassigned = workBlocks.filter((b) => !b.crewId);
  if (unassigned.length > 0) lanes.push({ crew: null, list: unassigned });

  for (const lane of lanes) {
    const list = lane.list
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    rows.push({
      id: lane.crew ? `sec-crew-${lane.crew.id}` : "sec-crew-none",
      label: lane.crew?.name ?? "Bez brygady",
      section: true,
      ...(lane.crew ? { crew: lane.crew } : {}),
      blocks: [],
    });
    for (const b of list) {
      rows.push({
        id: b.id,
        label: `#${projects.find((p) => p.id === b.projectId)?.number ?? "?"} ${b.title || b.scope}`,
        meta: projectLabelOf(b.projectId),
        color: lane.crew?.color || b.color,
        indented: true,
        blocks: [b],
      });
    }
  }
  return rows;
}

function projectNumberLabel(
  projects: PreviewProject[],
  projectId: string,
): string {
  const p = projects.find((x) => x.id === projectId);
  return p ? `#${p.number}` : "#?";
}

function ScheduleMobileList({
  mode,
  projects,
  crews,
  blocks,
  events,
  catalog,
  onOpenProject,
  onOpenTimeline,
  onEditBlock,
  onEditEvent,
  onAddEvent,
  onAddCrew,
  onEditCrew,
}: {
  mode: ScheduleViewMode;
  projects: PreviewProject[];
  crews: PreviewCrew[];
  blocks: ScheduleBlock[];
  events: ScheduleEvent[];
  catalog: ScheduleCatalogPreset;
  onOpenProject: (projectId: string) => void;
  onOpenTimeline: () => void;
  onEditBlock: (b: ScheduleBlock) => void;
  onEditEvent: (e: ScheduleEvent) => void;
  onAddEvent: (projectId: string) => void;
  onAddCrew?: () => void;
  onEditCrew?: (crew: PreviewCrew) => void;
}) {
  const today = todayIso();
  const single = mode === "project" && projects.length === 1 ? projects[0] : null;

  if (mode === "byCrew") {
    const workBlocks = blocks
      .filter((b) => b.role === "work")
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const lanes: Array<{ crew: PreviewCrew | null; list: ScheduleBlock[] }> =
      crews.map((crew) => ({
        crew,
        list: workBlocks.filter((b) => b.crewId === crew.id),
      }));
    const unassigned = workBlocks.filter((b) => !b.crewId);
    if (unassigned.length > 0) lanes.push({ crew: null, list: unassigned });

    const projectOf = (id: string) => projects.find((p) => p.id === id);

    return (
      <div className="flex h-full flex-col overflow-y-auto thin-scrollbar bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <p className="min-w-0 flex-1 text-[12px] text-ink-faint">
            Brygady i ich prace
          </p>
          <button
            type="button"
            onClick={onOpenTimeline}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-[12px] font-semibold text-accent"
          >
            <GanttChart size={14} />
            Oś
          </button>
          {onAddCrew ? (
            <button
              type="button"
              onClick={onAddCrew}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] font-medium text-ink-light"
            >
              <Plus size={14} />
              Brygada
            </button>
          ) : null}
        </div>

        {lanes.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-ink-faint">
            Brak brygad. Dodaj brygadę albo przypisz roboty.
          </p>
        ) : (
          <div className="space-y-3 p-3 pb-6">
            {lanes.map((lane) => {
              const key = lane.crew?.id ?? "none";
              const color = lane.crew?.color ?? "#9b9a97";
              return (
                <section
                  key={key}
                  className="overflow-hidden rounded-2xl border border-line bg-surface-overlay/60"
                >
                  <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                      {lane.crew?.name ?? "Bez brygady"}
                    </h3>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                      {lane.list.length}
                    </span>
                    {lane.crew && onEditCrew ? (
                      <button
                        type="button"
                        onClick={() => onEditCrew(lane.crew!)}
                        className="rounded-md p-1 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                        title="Edytuj brygadę"
                      >
                        <Pencil size={13} />
                      </button>
                    ) : null}
                  </div>
                  {lane.list.length === 0 ? (
                    <p className="px-3 py-3 text-[12px] text-ink-faint">
                      Brak przypisanych prac
                    </p>
                  ) : (
                    <ul className="divide-y divide-line/50">
                      {lane.list.map((b) => {
                        const p = projectOf(b.projectId);
                        return (
                          <li key={b.id}>
                            <button
                              type="button"
                              onClick={() => onEditBlock(b)}
                              className="flex w-full min-h-12 items-start gap-2 px-3 py-2.5 text-left transition active:bg-surface-raised"
                            >
                              <span
                                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                                style={{ background: b.color || color }}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-ink">
                                  {b.title || b.scope || "Zakres"}
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                                  {p ? (
                                    <>
                                      <span className="text-ink-light">
                                        #{p.number}
                                      </span>{" "}
                                      {p.name}
                                    </>
                                  ) : (
                                    "Budowa"
                                  )}
                                  {" · "}
                                  {formatDayShort(b.startDate)}
                                  {b.endDate !== b.startDate
                                    ? ` – ${formatDayShort(b.endDate)}`
                                    : ""}
                                  {" · "}
                                  {SCHEDULE_STATUS_LABEL[b.status]}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (single) {
    const works = blocks
      .filter((b) => b.projectId === single.id && b.role === "work")
      .slice()
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const projectEvents = events
      .filter((e) => e.projectId === single.id)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = projectEvents.filter((e) => e.date >= today).slice(0, 12);
    const past = projectEvents.filter((e) => e.date < today).slice(-4).reverse();

    return (
      <div className="flex h-full flex-col overflow-y-auto thin-scrollbar bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            onClick={onOpenTimeline}
            className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 text-sm font-semibold text-accent"
          >
            <GanttChart size={16} />
            Oś czasu
          </button>
          <button
            type="button"
            onClick={() => onAddEvent(single.id)}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-accent px-3 text-sm font-semibold text-white"
          >
            <Zap size={15} />
            Zdarzenie
          </button>
        </div>

        <section className="border-b border-line p-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Pozycje harmonogramu
          </h3>
          {works.length === 0 ? (
            <p className="text-sm text-ink-faint">Brak pozycji w planie.</p>
          ) : (
            <ul className="space-y-1.5">
              {works.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onEditBlock(b)}
                    className="flex w-full min-h-12 flex-col gap-0.5 rounded-xl border border-line/70 bg-surface-raised/30 px-3 py-2.5 text-left transition active:bg-surface-raised"
                  >
                    <span className="truncate text-sm font-medium text-ink">
                      {b.title || b.scope || "Pozycja"}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {formatDayShort(b.startDate)}
                      {b.startDate !== b.endDate
                        ? ` – ${formatDayShort(b.endDate)}`
                        : ""}
                      {" · "}
                      {SCHEDULE_STATUS_LABEL[b.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="p-3 pb-6">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Zdarzenia
          </h3>
          {upcoming.length === 0 && past.length === 0 ? (
            <p className="text-sm text-ink-faint">Brak zdarzeń.</p>
          ) : (
            <ul className="space-y-1.5">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onEditEvent(e)}
                    className="flex w-full min-h-12 items-start gap-2 rounded-xl border border-dashed border-line/60 bg-surface-raised/20 px-3 py-2.5 text-left"
                  >
                    <span className="w-14 shrink-0 pt-0.5 text-[11px] text-ink-faint">
                      {formatDayShort(e.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 truncate text-sm text-ink">
                        {e.kind === "budowlane" ? (
                          <Zap size={12} className="shrink-0 text-amber-400" />
                        ) : (
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                        )}
                        {scheduleEventLabel(e)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {past.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onEditEvent(e)}
                    className="flex w-full min-h-11 items-start gap-2 rounded-xl px-3 py-2 text-left opacity-70"
                  >
                    <span className="w-14 shrink-0 text-[11px] text-ink-faint">
                      {formatDayShort(e.date)}
                    </span>
                    <span className="truncate text-sm text-ink-light">
                      {scheduleEventLabel(e)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto thin-scrollbar bg-surface p-3 pb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[12px] text-ink-faint">
          Budowy w zakresie — wejdź w szczegóły lub otwórz oś.
        </p>
        <button
          type="button"
          onClick={onOpenTimeline}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-[12px] font-semibold text-accent"
        >
          <GanttChart size={14} />
          Oś
        </button>
      </div>
      {projects.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-faint">Brak budów.</p>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => {
            const stage = projectStageLabel(p.id, blocks, catalog);
            const nextEvent = events
              .filter((e) => e.projectId === p.id && e.date >= today)
              .sort((a, b) => a.date.localeCompare(b.date))[0];
            const works = blocks.filter(
              (b) => b.projectId === p.id && b.role === "work",
            ).length;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className="flex w-full min-h-[4.25rem] flex-col gap-1 rounded-2xl border border-line bg-surface-overlay px-3.5 py-3 text-left transition active:bg-surface-raised"
                >
                  <span className="truncate text-[15px] font-semibold text-ink">
                    <span className="text-accent">#{p.number}</span> {p.name}
                  </span>
                  <span className="text-[12px] text-ink-faint">
                    {stage ?? "Bez etapu"}
                    {works > 0 ? ` · ${works} poz.` : ""}
                  </span>
                  {nextEvent ? (
                    <span className="truncate text-[12px] text-ink-light">
                      {formatDayShort(nextEvent.date)} ·{" "}
                      {scheduleEventLabel(nextEvent)}
                    </span>
                  ) : (
                    <span className="text-[12px] text-ink-faint">
                      Brak nadchodzących zdarzeń
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Cold start: nothing planned yet — offer both ways in. */
function ScheduleEmptyPanel({
  mode,
  onAddWork,
  onSeedTemplate,
  onAddCrew,
}: {
  mode: ScheduleViewMode;
  onAddWork: () => void;
  onSeedTemplate?: () => void;
  onAddCrew?: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-raised/40 p-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <LayoutTemplate size={18} />
        </div>
        <h3 className="text-sm font-semibold text-ink">
          {mode === "byCrew"
            ? "Brak brygad w planie"
            : "Nie ma jeszcze harmonogramu"}
        </h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
          Zacznij od jednego Projektu Inwestycyjnego albo wstaw okna terminów dla
          wszystkich etapów z katalogu i dopiero potem dokładaj prace.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAddWork}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
          >
            <Plus size={13} />
            Dodaj pierwszy Projekt Inwestycyjny
          </button>
          {mode === "byCrew" && onAddCrew ? (
            <button
              type="button"
              onClick={onAddCrew}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
            >
              <Users size={13} />
              Dodaj brygadę
            </button>
          ) : null}
          {onSeedTemplate ? (
            <button
              type="button"
              onClick={onSeedTemplate}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-light transition hover:border-line-strong hover:text-ink"
            >
              <LayoutTemplate size={13} />
              Szablon etapów
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineBoard({
  rows,
  range,
  crews,
  conflictIds,
  blockById,
  eventsByBlock,
  highlightBlockId,
  scrollerRef,
  dayPx,
  onDayPxChange,
  labelPx = LABEL_PX,
  compactMarkers = false,
  labelHeader = "Czynność",
  onEdit,
  onMove,
  onMoveCategory,
  categoryCollapse,
  onAddChild,
  onAddUnderCategory,
  onEditCategory,
  onAddUnderProject,
  onEditProject,
  onAddProjectEvent,
  onAddCategoryEvent,
  onEditEvent,
  onEditCrew,
  barLabel,
}: {
  rows: TimelineRow[];
  range: { start: string; end: string; days: number };
  crews: PreviewCrew[];
  conflictIds: Set<string>;
  blockById: Map<string, ScheduleBlock>;
  eventsByBlock: Map<string, ScheduleEvent[]>;
  highlightBlockId?: string | null;
  scrollerRef: React.RefObject<HTMLDivElement>;
  dayPx: number;
  onDayPxChange?: (next: number) => void;
  labelPx?: number;
  compactMarkers?: boolean;
  labelHeader?: string;
  onEdit: (b: ScheduleBlock) => void;
  onMove: (
    id: string,
    start: string,
    end: string,
    opts?: { shiftChildrenByDays?: number },
  ) => void;
  onMoveCategory?: (
    projectId: string,
    categoryId: string,
    start: string,
    end: string,
    opts?: { shiftChildrenByDays?: number },
  ) => void;
  /** Chevron + bulk zwiń/rozwiń (stan w localStorage). */
  categoryCollapse?: {
    collapsedKeys: Set<string>;
    revealLevel: ScheduleRevealLevel;
    showCategoryRows: boolean;
    onToggleShowCategories: () => void;
    onToggleProject: (projectId: string) => void;
    onToggleCategory: (projectId: string, categoryId: string) => void;
    onToggleSubcategory: (subcategoryId: string) => void;
    onMinimizeAll: () => void;
    onExpandStep: () => void;
    expandStepLabel: string;
  };
  onAddChild?: (parent: ScheduleBlock) => void;
  onAddUnderCategory?: (opts: {
    projectId: string;
    categoryId: string;
  }) => void;
  onEditCategory?: (opts: {
    projectId: string;
    categoryId: string;
    label: string;
    window?: { start: string; end: string };
  }) => void;
  onAddUnderProject?: (projectId: string) => void;
  onEditProject?: (projectId: string) => void;
  /** Add schedule event on a build (kind chooser in sheet; default budowlane). */
  onAddProjectEvent?: (projectId: string) => void;
  onAddCategoryEvent?: (
    opts: { projectId: string; categoryId: string },
    kind: ScheduleEventKind,
  ) => void;
  onEditEvent?: (event: ScheduleEvent) => void;
  onEditCrew?: (crew: PreviewCrew) => void;
  barLabel?: (b: ScheduleBlock) => string;
}) {
  const ticks = useMemo(
    () => ticksForRange(range.start, range.days, dayPx),
    [range.start, range.days, dayPx],
  );
  const weekendBand = useMemo(
    () => weekendBandStyle(range.start, dayPx),
    [range.start, dayPx],
  );
  const todayOffset = useMemo(() => {
    const offset = dayOffset(range.start, todayIso());
    return offset >= 0 && offset < range.days ? offset : null;
  }, [range.start, range.days]);
  const showMarkers = dayPx >= (compactMarkers ? 14 : MARKER_MIN_DAY_PX);
  /** Lewa krawędź widocznego wykresu w px osi (nie całego scrollerа). */
  const [chartScrollLeft, setChartScrollLeft] = useState(0);
  const [chartViewWidth, setChartViewWidth] = useState(800);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setChartScrollLeft(el.scrollLeft);
      setChartViewWidth(Math.max(120, el.clientWidth - labelPx));
    };
    const onScrollOrResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [scrollerRef, labelPx, rows.length, dayPx]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const viewportX = e.clientX - rect.left;
      const chartX = el.scrollLeft + viewportX - labelPx;
      const iso = isoAtChartX(
        range.start,
        range.days,
        dayPx,
        Math.max(0, chartX),
      );
      const next = dayPxAfterWheel(dayPx, e.deltaY);
      if (next === dayPx) return;
      onDayPxChange?.(next);
      requestAnimationFrame(() => {
        el.scrollLeft = scrollLeftForAnchor({
          labelPx,
          rangeStart: range.start,
          dayPx: next,
          iso,
          viewportX,
        });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dayPx, range.start, range.days, onDayPxChange, scrollerRef, labelPx]);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-ink-faint">
        Brak danych do wyświetlenia.
      </p>
    );
  }

  const chartW = range.days * dayPx;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto thin-scrollbar"
      >
        <div
          className="relative"
          style={{ minWidth: labelPx + chartW, width: labelPx + chartW }}
        >
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-line bg-surface px-1.5 py-1 text-[11px] font-medium text-ink-faint"
              style={{ width: labelPx }}
            >
              <span className="min-w-0 flex-1 truncate px-1">{labelHeader}</span>
              {categoryCollapse ? (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    title={
                      categoryCollapse.showCategoryRows
                        ? "Ukryj kategorie i podkategorie (zakresy zostają)"
                        : "Pokaż kategorie i podkategorie"
                    }
                    aria-label={
                      categoryCollapse.showCategoryRows
                        ? "Ukryj kategorie"
                        : "Pokaż kategorie"
                    }
                    aria-pressed={categoryCollapse.showCategoryRows}
                    onClick={categoryCollapse.onToggleShowCategories}
                    className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium transition hover:bg-surface-raised ${
                      categoryCollapse.showCategoryRows
                        ? "bg-accent/15 text-accent"
                        : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    <Layers size={14} className="shrink-0" />
                    <span className="hidden sm:inline">
                      {categoryCollapse.showCategoryRows
                        ? "Ukryj kategorie"
                        : "Pokaż kategorie"}
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Zwiń wszystkie kategorie, podkategorie i zakresy"
                    aria-label="Zwiń wszystko"
                    onClick={categoryCollapse.onMinimizeAll}
                    className="rounded p-0.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink"
                  >
                    <FoldVertical size={14} />
                  </button>
                  <button
                    type="button"
                    title={categoryCollapse.expandStepLabel}
                    aria-label={categoryCollapse.expandStepLabel}
                    disabled={categoryCollapse.revealLevel >= 2}
                    onClick={categoryCollapse.onExpandStep}
                    className="rounded p-0.5 text-ink-faint transition hover:bg-surface-raised hover:text-ink disabled:opacity-35"
                  >
                    <UnfoldVertical size={14} />
                  </button>
                </span>
              ) : null}
            </div>
            <div className="relative" style={{ width: chartW, height: HEADER_H }}>
              {todayOffset !== null ? (
                <div
                  className="absolute inset-y-0 bg-accent/10"
                  style={{ left: todayOffset * dayPx, width: dayPx }}
                  aria-hidden
                />
              ) : null}
              {ticks.map((tick) =>
                tick.weekday ? (
                  <div
                    key={tick.iso}
                    className="absolute inset-y-0 border-r border-line/40 text-center"
                    style={{ left: tick.offsetDays * dayPx, width: dayPx }}
                  >
                    {tick.label ? (
                      <div className="px-0.5 pt-0.5 text-[9px] font-medium text-ink-light">
                        {tick.label}
                      </div>
                    ) : (
                      <div className="h-3.5" />
                    )}
                    <div className="pb-0.5 text-[9px] text-ink-faint">
                      {tick.weekday}
                    </div>
                  </div>
                ) : (
                  <div
                    key={tick.iso}
                    className="absolute inset-y-0 whitespace-nowrap border-l border-line/40 pl-0.5 pt-0.5 text-[9px] font-medium text-ink-light"
                    style={{ left: tick.offsetDays * dayPx }}
                  >
                    {tick.label}
                  </div>
                ),
              )}
            </div>
          </div>

          {rows.map((row) =>
            row.section ? (
              (() => {
                const isProjectHeader = Boolean(
                  row.projectId && !row.crew && !row.docLane,
                );
                const projKey =
                  isProjectHeader && row.projectId
                    ? projectCollapseKey(row.projectId)
                    : null;
                const projCollapsed = projKey
                  ? Boolean(categoryCollapse?.collapsedKeys.has(projKey))
                  : false;
                const showProjToggle =
                  Boolean(categoryCollapse) && isProjectHeader;
                return (
              <div
                key={row.id}
                className="flex border-b border-line bg-surface-raised"
                style={{ height: ROW_SECTION }}
              >
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface-raised px-2.5"
                  style={{ width: labelPx }}
                >
                  {showProjToggle ? (
                    <button
                      type="button"
                      title={
                        projCollapsed
                          ? "Rozwiń inwestycję"
                          : "Zwiń inwestycję"
                      }
                      aria-expanded={!projCollapsed}
                      onClick={(e) => {
                        e.stopPropagation();
                        categoryCollapse!.onToggleProject(row.projectId!);
                      }}
                      className="shrink-0 rounded p-0.5 text-ink-faint hover:bg-surface-overlay hover:text-ink"
                    >
                      {projCollapsed ? (
                        <ChevronRight size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                    </button>
                  ) : null}
                  {row.crew ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: row.crew.color }}
                      aria-hidden
                    />
                  ) : null}
                  {row.projectId && onEditProject && !row.crew && !row.docLane ? (
                    <button
                      type="button"
                      onClick={() => onEditProject(row.projectId!)}
                      className="sched-label min-w-0 flex-1 truncate text-left font-semibold text-ink transition hover:text-accent"
                      title="Zarządzaj budową (uczestnicy)"
                    >
                      {row.label}
                    </button>
                  ) : (
                    <span className="sched-label min-w-0 flex-1 truncate font-semibold text-ink">
                      {row.label}
                    </span>
                  )}
                  {row.projectId && onAddUnderProject && !row.crew && !row.docLane ? (
                    <button
                      type="button"
                      title="Dodaj pozycję na budowie"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddUnderProject(row.projectId!);
                      }}
                      className="relative z-10 shrink-0 rounded p-0.5 text-ink-faint hover:bg-surface-overlay hover:text-accent"
                    >
                      <Plus size={12} />
                    </button>
                  ) : null}
                  {row.projectId && onAddProjectEvent && !row.crew ? (
                    <button
                      type="button"
                      title="Dodaj zdarzenie"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddProjectEvent(row.projectId!);
                      }}
                      className="relative z-10 shrink-0 rounded p-0.5 text-ink-faint hover:bg-surface-overlay hover:text-accent"
                    >
                      <Zap size={12} />
                    </button>
                  ) : null}
                  {row.crew && onEditCrew ? (
                    <button
                      type="button"
                      title="Edytuj brygadę"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditCrew(row.crew!);
                      }}
                      className="relative z-10 shrink-0 rounded p-0.5 text-ink-faint hover:bg-surface-overlay hover:text-accent"
                    >
                      <Pencil size={12} />
                    </button>
                  ) : null}
                </div>
                <div className="relative" style={{ width: chartW, height: ROW_SECTION }}>
                  {showMarkers && row.looseEvents && row.looseEvents.length > 0
                    ? (() => {
                        const list = row.looseEvents;
                        const stack = eventMarkerStack(list);
                        return list.map((ev) => {
                          const s = stack.get(ev.id) ?? { index: 0, total: 1 };
                          return (
                            <ScheduleEventMarker
                              key={ev.id}
                              event={ev}
                              rangeStart={range.start}
                              dayPx={dayPx}
                              rowH={ROW_SECTION}
                              stackIndex={s.index}
                              stackTotal={s.total}
                              onOpen={() => onEditEvent?.(ev)}
                            />
                          );
                        });
                      })()
                    : null}
                </div>
              </div>
                );
              })()
            ) : (
              (() => {
                const h = rowHeightOf(row);
                const isCat = Boolean(row.categoryLane);
                const isSub = Boolean(row.subcategory);
                const isWorkChild = Boolean(row.parentId);
                const editable = row.blocks[0] ?? null;
                const tip = [row.label, row.meta].filter(Boolean).join("\n");
                const canOpenCategory =
                  isCat &&
                  Boolean(onEditCategory) &&
                  Boolean(row.categoryId) &&
                  Boolean(row.projectId);
                const catKey =
                  isCat && row.projectId && row.categoryId
                    ? categoryCollapseKey(row.projectId, row.categoryId)
                    : null;
                const catCollapsed = catKey
                  ? categoryCollapse!.revealLevel <= 0 ||
                    Boolean(categoryCollapse?.collapsedKeys.has(catKey))
                  : false;
                const showCatToggle =
                  Boolean(categoryCollapse) &&
                  Boolean(row.projectId) &&
                  Boolean(row.categoryId) &&
                  isCat;
                const subId = isSub
                  ? (row.blocks[0]?.id ?? row.id)
                  : null;
                const subCollapsed = subId
                  ? (categoryCollapse?.revealLevel ?? 2) < 2 ||
                    Boolean(
                      categoryCollapse?.collapsedKeys.has(
                        subcategoryCollapseKey(subId),
                      ),
                    )
                  : false;
                const showSubToggle =
                  Boolean(categoryCollapse) &&
                  isSub &&
                  Boolean(subId) &&
                  (row.childBlocks?.length ?? 0) > 0;
                const openRowEdit = () => {
                  if (editable) {
                    onEdit(editable);
                    return;
                  }
                  if (canOpenCategory) {
                    onEditCategory!({
                      projectId: row.projectId!,
                      categoryId: row.categoryId!,
                      label: row.label,
                      window: row.categoryWindow,
                    });
                  }
                };
                const labelInteractive = Boolean(editable) || canOpenCategory;
                const workBlock = row.blocks[0];
                const crewColor = workBlock?.crewId
                  ? crews.find((c) => c.id === workBlock.crewId)?.color
                  : undefined;
                const workColor =
                  crewColor || row.color || workBlock?.color;
                const workDot = workColor
                  ? softenScheduleColor(workColor)
                  : undefined;
                return (
                  <div
                    key={row.id}
                    className={`group flex border-b border-line/35 ${
                      isCat
                        ? "sched-row-cat"
                        : isSub
                          ? "sched-row-sub"
                          : "sched-row-work"
                    } ${
                      highlightBlockId && row.blocks[0]?.id === highlightBlockId
                        ? "ring-1 ring-inset ring-accent/50"
                        : ""
                    }`}
                    style={{ height: h }}
                  >
                    <div
                      role={labelInteractive ? "button" : undefined}
                      tabIndex={labelInteractive ? 0 : undefined}
                      onClick={labelInteractive ? openRowEdit : undefined}
                      onKeyDown={
                        labelInteractive
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openRowEdit();
                              }
                            }
                          : undefined
                      }
                      className={`sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line ${
                        isCat
                          ? "sched-row-cat pl-1.5 pr-1"
                          : isSub
                            ? "sched-row-sub pl-5 pr-1"
                            : isWorkChild
                              ? "sched-row-work pl-8 pr-1"
                              : row.indented
                                ? "sched-row-work pl-5 pr-1"
                                : "sched-row-work pl-1.5 pr-1"
                      } ${
                        labelInteractive
                          ? "sched-row-interactive cursor-pointer"
                          : ""
                      }`}
                      style={{ width: labelPx }}
                      title={tip}
                    >
                      {showCatToggle ? (
                        <button
                          type="button"
                          title={
                            catCollapsed
                              ? "Rozwiń kategorię"
                              : "Zwiń kategorię"
                          }
                          aria-expanded={!catCollapsed}
                          onClick={(e) => {
                            e.stopPropagation();
                            categoryCollapse!.onToggleCategory(
                              row.projectId!,
                              row.categoryId!,
                            );
                          }}
                          className="shrink-0 rounded p-0.5 text-sched-cat-muted hover:bg-white/10 hover:text-sched-cat"
                        >
                          {catCollapsed ? (
                            <ChevronRight size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                        </button>
                      ) : isCat ? (
                        <span className="w-[17px] shrink-0" aria-hidden />
                      ) : null}
                      {showSubToggle ? (
                        <button
                          type="button"
                          title={
                            subCollapsed
                              ? "Rozwiń podkategorię"
                              : "Zwiń podkategorię"
                          }
                          aria-expanded={!subCollapsed}
                          onClick={(e) => {
                            e.stopPropagation();
                            categoryCollapse!.onToggleSubcategory(subId!);
                          }}
                          className="shrink-0 rounded p-0.5 text-[rgb(var(--sched-sub-muted))] hover:bg-white/10 hover:text-sched-sub"
                        >
                          {subCollapsed ? (
                            <ChevronRight size={12} />
                          ) : (
                            <ChevronDown size={12} />
                          )}
                        </button>
                      ) : isSub ? (
                        <span
                          className="h-1 w-1 shrink-0 rounded-full bg-[rgb(var(--sched-sub-muted))]"
                          aria-hidden
                        />
                      ) : null}
                      {!isCat && !isSub && workDot ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: workDot }}
                          aria-hidden
                        />
                      ) : null}
                      {row.crew ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: row.crew.color }}
                          aria-hidden
                        />
                      ) : null}
                      <span
                        className={`sched-label min-w-0 flex-1 truncate ${
                          isCat
                            ? "sched-label-cat text-sched-cat"
                            : isSub
                              ? "sched-label-sub text-sched-sub"
                              : "sched-label-work text-sched-work"
                        }`}
                      >
                        {row.label}
                      </span>
                      {row.parentId &&
                      row.blocks[0] &&
                      (() => {
                        const parent = blockById.get(row.parentId!);
                        return parent
                          ? scheduleOverflow(row.blocks[0], parent).outside
                          : false;
                      })() ? (
                        <span title="Poza przedziałem podkategorii">
                          <AlertTriangle
                            size={11}
                            className="shrink-0 text-amber-400"
                          />
                        </span>
                      ) : null}
                      <span className="sched-label-actions shrink-0">
                        {isSub && onAddChild && row.blocks[0] ? (
                          <button
                            type="button"
                            title="Dodaj zakres"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddChild(row.blocks[0]!);
                            }}
                            className="rounded p-0.5 text-sched-sub-muted hover:bg-black/5 hover:text-sched-sub dark:hover:bg-white/10"
                          >
                            <Plus size={12} />
                          </button>
                        ) : null}
                        {onAddUnderCategory &&
                        isCat &&
                        row.categoryId &&
                        row.projectId ? (
                          <button
                            type="button"
                            title="Dodaj podkategorię lub zakres"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddUnderCategory({
                                projectId: row.projectId!,
                                categoryId: row.categoryId!,
                              });
                            }}
                            className="rounded p-0.5 text-sched-cat-muted hover:bg-white/10 hover:text-sched-cat"
                          >
                            <Plus size={12} />
                          </button>
                        ) : null}
                        {onAddCategoryEvent &&
                        isCat &&
                        row.categoryId &&
                        row.projectId ? (
                          <button
                            type="button"
                            title="Dodaj zdarzenie"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddCategoryEvent(
                                {
                                  projectId: row.projectId!,
                                  categoryId: row.categoryId!,
                                },
                                "budowlane",
                              );
                            }}
                            className="rounded p-0.5 text-sched-cat-muted hover:bg-white/10 hover:text-sched-cat"
                          >
                            <Zap size={12} />
                          </button>
                        ) : null}
                      </span>
                    </div>
                    <div
                      className={`relative ${
                        isCat
                          ? "sched-row-cat"
                          : isSub
                            ? "sched-row-sub"
                            : "sched-row-work"
                      }`}
                      style={{
                        width: chartW,
                        height: h,
                        ...(weekendBand ?? {}),
                      }}
                    >
                      {todayOffset !== null ? (
                        <div
                          className="absolute inset-y-0 bg-accent/10"
                          style={{ left: todayOffset * dayPx, width: dayPx }}
                          aria-hidden
                        />
                      ) : null}
                      {isSub && row.blocks[0] ? (
                        <SubcategoryWindow
                          block={row.blocks[0]}
                          childBlocks={row.childBlocks ?? []}
                          rangeStart={range.start}
                          dayPx={dayPx}
                          rowH={h}
                          onEdit={() => onEdit(row.blocks[0]!)}
                          onMove={onMove}
                        />
                      ) : null}
                      {isCat && row.categoryWindow ? (
                        <CategoryWindow
                          label={row.label}
                          planned={row.categoryWindow}
                          content={row.categoryBlockWindow}
                          rangeStart={range.start}
                          dayPx={dayPx}
                          rowH={h}
                          onEdit={
                            canOpenCategory
                              ? () =>
                                  onEditCategory!({
                                    projectId: row.projectId!,
                                    categoryId: row.categoryId!,
                                    label: row.label,
                                    window: row.categoryWindow,
                                  })
                              : undefined
                          }
                          onMove={
                            onMoveCategory && row.projectId && row.categoryId
                              ? (start, end, opts) =>
                                  onMoveCategory(
                                    row.projectId!,
                                    row.categoryId!,
                                    start,
                                    end,
                                    opts,
                                  )
                              : undefined
                          }
                        />
                      ) : null}
                      {!isSub && !isCat
                        ? row.blocks.map((b) => {
                            const parent = b.parentId
                              ? blockById.get(b.parentId)
                              : undefined;
                            return (
                              <DraggableBar
                                key={b.id}
                                block={b}
                                rangeStart={range.start}
                                dayPx={dayPx}
                                rowH={h}
                                crews={crews}
                                conflict={conflictIds.has(b.id)}
                                label={barLabel?.(b) ?? b.title}
                                chartScrollLeft={chartScrollLeft}
                                chartViewWidth={chartViewWidth}
                                parentWindow={parent ?? null}
                                onEdit={() => onEdit(b)}
                                onMove={onMove}
                              />
                            );
                          })
                        : null}
                      {showMarkers
                        ? (() => {
                            const list = rowEvents(row, eventsByBlock);
                            const stack = eventMarkerStack(list);
                            return list.map((ev) => {
                              const s = stack.get(ev.id) ?? { index: 0, total: 1 };
                              return (
                                <ScheduleEventMarker
                                  key={ev.id}
                                  event={ev}
                                  rangeStart={range.start}
                                  dayPx={dayPx}
                                  rowH={h}
                                  stackIndex={s.index}
                                  stackTotal={s.total}
                                  onOpen={() => onEditEvent?.(ev)}
                                />
                              );
                            });
                          })()
                        : null}
                    </div>
                  </div>
                );
              })()
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function rowEvents(
  row: TimelineRow,
  eventsByBlock: Map<string, ScheduleEvent[]>,
): ScheduleEvent[] {
  if (row.looseEvents) return row.looseEvents;
  return row.blocks.flatMap((b) => eventsByBlock.get(b.id) ?? []);
}

/** Pozycja w stosie markerów tego samego dnia (żeby widać ⚡ i kropkę naraz). */
function eventMarkerStack(
  events: ScheduleEvent[],
): Map<string, { index: number; total: number }> {
  const byDate = new Map<string, ScheduleEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const out = new Map<string, { index: number; total: number }>();
  for (const list of byDate.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "budowlane" ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    list.forEach((e, index) => {
      out.set(e.id, { index, total: list.length });
    });
  }
  return out;
}

/** One marker for both kinds — square ⚡ for budowlane, status dot for docs. */
function ScheduleEventMarker({
  event,
  rangeStart,
  dayPx,
  rowH = ROW_WORK,
  stackIndex = 0,
  stackTotal = 1,
  onOpen,
}: {
  event: ScheduleEvent;
  rangeStart: string;
  dayPx: number;
  rowH?: number;
  stackIndex?: number;
  stackTotal?: number;
  onOpen?: () => void;
}) {
  const label = scheduleEventLabel(event);
  const center = dayOffset(rangeStart, event.date) * dayPx + dayPx / 2;
  const compact = rowH <= ROW_CATEGORY;
  const gap = Math.min(11, Math.max(6, dayPx * 0.4));
  const spreadX =
    stackTotal > 1 ? (stackIndex - (stackTotal - 1) / 2) * gap : 0;
  const spreadY =
    stackTotal > 1 ? (stackIndex - (stackTotal - 1) / 2) * (compact ? 2 : 3) : 0;
  const z = 3 + stackIndex;

  if (event.kind === "budowlane") {
    const size = compact ? 10 : 12;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
        }}
        className="absolute flex items-center justify-center rounded-sm bg-amber-400 text-ink shadow-sm ring-1 ring-amber-600/50 hover:scale-125"
        style={{
          left: center - size / 2 + spreadX,
          top: Math.max(1, (rowH - size) / 2 - (compact ? 0 : 2) + spreadY),
          width: size,
          height: size,
          zIndex: z,
        }}
        title={`${SCHEDULE_EVENT_KIND_LABEL.budowlane}: ${label}\n${event.date}${
          event.note ? `\n${event.note}` : ""
        }${stackTotal > 1 ? `\n(${stackIndex + 1}/${stackTotal} tego dnia)` : ""}`}
        aria-label={`Zdarzenie budowlane: ${label}`}
      >
        <Zap size={compact ? 7 : 8} className="text-ink" />
      </button>
    );
  }

  const status = event.status ?? "do_wpisania";
  const dot = compact ? 8 : 10;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      className="absolute rounded-full bg-sky-400 shadow-sm ring-1 ring-sky-700/50 transition hover:scale-150"
      style={{
        left: center - dot / 2 + spreadX,
        top: Math.max(1, (rowH - dot) / 2 + (compact ? 0 : 2) + spreadY),
        width: dot,
        height: dot,
        zIndex: z,
      }}
      title={`${SCHEDULE_EVENT_KIND_LABEL.dokumentacyjne}: ${label}\n${event.date} · ${
        DOC_EVENT_STATUS_LABEL[status]
      }${event.note ? `\n${event.note}` : ""}${
        stackTotal > 1 ? `\n(${stackIndex + 1}/${stackTotal} tego dnia)` : ""
      }`}
      aria-label={`Zdarzenie dokumentacyjne: ${label}`}
    />
  );
}

function CategoryWindow({
  label,
  planned,
  content,
  rangeStart,
  dayPx,
  rowH,
  onEdit,
  onMove,
}: {
  label: string;
  planned: { start: string; end: string };
  content?: { start: string; end: string };
  rangeStart: string;
  dayPx: number;
  rowH: number;
  onEdit?: () => void;
  onMove?: (
    start: string,
    end: string,
    opts?: { shiftChildrenByDays?: number },
  ) => void;
}) {
  const barH = Math.max(6, rowH - 10);
  const top = (rowH - barH) / 2;
  const drag = usePlannedWindowDrag({
    startDate: planned.start,
    endDate: planned.end,
    dayPx,
    onCommit: onMove,
    onEdit,
  });
  const start = drag.live?.start ?? planned.start;
  const end = drag.live?.end ?? planned.end;
  const left = dayOffset(rangeStart, start) * dayPx;
  const width = Math.max(BAR_MIN_PX, (dayOffset(start, end) + 1) * dayPx);

  let spillStart = start;
  let spillEnd = end;
  if (content) {
    if (content.start < spillStart) spillStart = content.start;
    if (content.end > spillEnd) spillEnd = content.end;
  }
  const hasSpill = spillStart < start || spillEnd > end;
  const spillLeft = dayOffset(rangeStart, spillStart) * dayPx;
  const spillWidth = Math.max(
    BAR_MIN_PX,
    (dayOffset(spillStart, spillEnd) + 1) * dayPx,
  );

  const title = `${label}\nOkno: ${shortDateRange(start, end)}${
    hasSpill ? "\nSzare = zakresy poza oknem" : ""
  }`;

  return (
    <>
      {hasSpill ? (
        <div
          className="pointer-events-none absolute rounded border border-dashed border-ink/20 bg-ink/10"
          style={{
            left: spillLeft,
            width: spillWidth,
            top,
            height: barH,
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(100,100,100,0.12) 3px, rgba(100,100,100,0.12) 6px)",
          }}
          aria-hidden
        />
      ) : null}
      <div
        className="sched-bar-cat absolute rounded border"
        style={{ left, width, top, height: barH }}
        title={title}
      >
        <div
          role={onEdit || onMove ? "button" : undefined}
          tabIndex={onEdit || onMove ? 0 : undefined}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && onEdit) onEdit();
          }}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.finishPointer}
          onPointerCancel={drag.cancelPointer}
          className={`absolute inset-0 flex items-stretch rounded ${
            onMove ? "cursor-grab active:cursor-grabbing" : ""
          } ${onEdit || onMove ? "" : "pointer-events-none"}`}
        >
          {onMove ? (
            <div
              className="sched-bar-handle-cat w-1.5 shrink-0 cursor-ew-resize rounded-l"
              onPointerDown={(e) => drag.onPointerDown(e, "resize-start")}
              title="Zmień początek okna"
            />
          ) : null}
          <div
            className="min-w-0 flex-1"
            onPointerDown={
              onMove
                ? (e) => drag.onPointerDown(e, "move")
                : onEdit
                  ? (e) => {
                      e.stopPropagation();
                      onEdit();
                    }
                  : undefined
            }
          />
          {onMove ? (
            <div
              className="sched-bar-handle-cat w-1.5 shrink-0 cursor-ew-resize rounded-r"
              onPointerDown={(e) => drag.onPointerDown(e, "resize-end")}
              title="Zmień koniec okna"
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

function SubcategoryWindow({
  block,
  childBlocks,
  rangeStart,
  dayPx,
  rowH,
  onEdit,
  onMove,
}: {
  block: ScheduleBlock;
  childBlocks: ScheduleBlock[];
  rangeStart: string;
  dayPx: number;
  rowH: number;
  onEdit: () => void;
  onMove: (
    id: string,
    start: string,
    end: string,
    opts?: { shiftChildrenByDays?: number },
  ) => void;
}) {
  const barH = Math.max(8, rowH - 10);
  const top = (rowH - barH) / 2;
  const drag = usePlannedWindowDrag({
    startDate: block.startDate,
    endDate: block.endDate,
    dayPx,
    onCommit: (start, end, opts) => onMove(block.id, start, end, opts),
    onEdit,
  });
  const start = drag.live?.start ?? block.startDate;
  const end = drag.live?.end ?? block.endDate;
  const left = dayOffset(rangeStart, start) * dayPx;
  const width = Math.max(BAR_MIN_PX, (dayOffset(start, end) + 1) * dayPx);

  let spillStart = start;
  let spillEnd = end;
  for (const c of childBlocks) {
    if (c.startDate < spillStart) spillStart = c.startDate;
    if (c.endDate > spillEnd) spillEnd = c.endDate;
  }
  const hasSpill = spillStart < start || spillEnd > end;
  const spillLeft = dayOffset(rangeStart, spillStart) * dayPx;
  const spillWidth = Math.max(
    BAR_MIN_PX,
    (dayOffset(spillStart, spillEnd) + 1) * dayPx,
  );

  return (
    <>
      {hasSpill ? (
        <div
          className="pointer-events-none absolute rounded border border-dashed border-ink/20 bg-ink/10"
          style={{
            left: spillLeft,
            width: spillWidth,
            top,
            height: barH,
            backgroundImage:
              "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(100,100,100,0.12) 3px, rgba(100,100,100,0.12) 6px)",
          }}
          aria-hidden
        />
      ) : null}
      <div
        className="sched-bar-sub absolute rounded border"
        style={{
          left,
          width,
          top,
          height: barH,
        }}
        title={`${block.title}\nOkno: ${shortDateRange(start, end)}${
          hasSpill ? "\nSzare = zakresy poza oknem" : ""
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onEdit();
          }}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.finishPointer}
          onPointerCancel={drag.cancelPointer}
          className="absolute inset-0 flex cursor-grab items-stretch rounded active:cursor-grabbing"
        >
          <div
            className="sched-bar-handle-sub w-1.5 shrink-0 cursor-ew-resize rounded-l"
            onPointerDown={(e) => drag.onPointerDown(e, "resize-start")}
            title="Zmień początek okna"
          />
          <div
            className="min-w-0 flex-1"
            onPointerDown={(e) => drag.onPointerDown(e, "move")}
          />
          <div
            className="sched-bar-handle-sub w-1.5 shrink-0 cursor-ew-resize rounded-r"
            onPointerDown={(e) => drag.onPointerDown(e, "resize-end")}
            title="Zmień koniec okna"
          />
        </div>
      </div>
    </>
  );
}

function usePlannedWindowDrag({
  startDate,
  endDate,
  dayPx,
  onCommit,
  onEdit,
}: {
  startDate: string;
  endDate: string;
  dayPx: number;
  onCommit?: (
    start: string,
    end: string,
    opts?: { shiftChildrenByDays?: number },
  ) => void;
  onEdit?: () => void;
}) {
  const dragRef = useRef<{
    mode: "move" | "resize-start" | "resize-end";
    originX: number;
    start: string;
    end: string;
    moved: boolean;
  } | null>(null);
  const liveRef = useRef<{ start: string; end: string } | null>(null);
  const [live, setLive] = useState<{ start: string; end: string } | null>(null);

  const onPointerDown = (
    e: React.PointerEvent,
    mode: "move" | "resize-start" | "resize-end",
  ) => {
    if (!onCommit) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode,
      originX: e.clientX,
      start: startDate,
      end: endDate,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !onCommit) return;
    const deltaDays = Math.round((e.clientX - drag.originX) / dayPx);
    if (deltaDays !== 0) drag.moved = true;
    const len = dayOffset(drag.start, drag.end);
    let nextStart = drag.start;
    let nextEnd = drag.end;
    if (drag.mode === "move") {
      nextStart = addDaysIso(drag.start, deltaDays);
      nextEnd = addDaysIso(nextStart, len);
    } else if (drag.mode === "resize-start") {
      nextStart = addDaysIso(drag.start, deltaDays);
      if (dayOffset(nextStart, drag.end) < 0) nextStart = drag.end;
      nextEnd = drag.end;
    } else {
      nextEnd = addDaysIso(drag.end, deltaDays);
      if (dayOffset(drag.start, nextEnd) < 0) nextEnd = drag.start;
      nextStart = drag.start;
    }
    liveRef.current = { start: nextStart, end: nextEnd };
    setLive({ start: nextStart, end: nextEnd });
  };

  const finishPointer = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      liveRef.current = null;
      setLive(null);
      onEdit?.();
      return;
    }
    const next = liveRef.current ?? { start: drag.start, end: drag.end };
    liveRef.current = null;
    setLive(null);
    if (
      onCommit &&
      (next.start !== startDate || next.end !== endDate)
    ) {
      const shiftChildrenByDays =
        drag.mode === "move" ? dayOffset(drag.start, next.start) : 0;
      onCommit(
        next.start,
        next.end,
        shiftChildrenByDays
          ? { shiftChildrenByDays }
          : undefined,
      );
    }
  };

  const cancelPointer = () => {
    dragRef.current = null;
    liveRef.current = null;
    setLive(null);
  };

  return {
    live,
    onPointerDown,
    onPointerMove,
    finishPointer,
    cancelPointer,
  };
}

function DraggableBar({
  block,
  rangeStart,
  dayPx,
  rowH = ROW_WORK,
  crews,
  conflict,
  label,
  chartScrollLeft = 0,
  chartViewWidth = 800,
  parentWindow,
  onEdit,
  onMove,
}: {
  block: ScheduleBlock;
  rangeStart: string;
  dayPx: number;
  rowH?: number;
  crews: PreviewCrew[];
  conflict: boolean;
  label: string;
  /** scrollLeft scrollerа (= lewa krawędź widocznego wykresu w px osi). */
  chartScrollLeft?: number;
  chartViewWidth?: number;
  parentWindow: ScheduleBlock | null;
  onEdit: () => void;
  onMove: (id: string, start: string, end: string) => void;
}) {
  const crew = crews.find((c) => c.id === block.crewId);
  // Kolor belki = zawsze kolor brygady (zmiana brygady odświeża belki).
  const color = softenScheduleColor(
    (block.crewId ? crew?.color : undefined) ||
      block.color ||
      "#7a8494",
  );
  const barH = Math.max(14, rowH - 8);
  const top = (rowH - barH) / 2;
  const dragRef = useRef<{
    mode: "move" | "resize-start" | "resize-end";
    originX: number;
    start: string;
    end: string;
    moved: boolean;
  } | null>(null);
  const liveRef = useRef<{ start: string; end: string } | null>(null);
  const [live, setLive] = useState<{ start: string; end: string } | null>(null);

  const start = live?.start ?? block.startDate;
  const end = live?.end ?? block.endDate;
  const left = dayOffset(rangeStart, start) * dayPx;
  const width = Math.max(BAR_MIN_PX, (dayOffset(start, end) + 1) * dayPx);

  // Przesuń etykietę w prawo, gdy początek paska jest poza lewym brzegiem widoku.
  const handleW = 6;
  const labelPad = Math.max(
    0,
    Math.min(
      chartScrollLeft - left,
      Math.max(0, width - handleW * 2 - 36),
    ),
  );
  const visibleStart = Math.max(left, chartScrollLeft);
  const visibleEnd = Math.min(left + width, chartScrollLeft + chartViewWidth);
  const visibleW = Math.max(0, visibleEnd - visibleStart);
  const showCrew = Boolean(crew?.name) && visibleW >= Math.max(56, dayPx * 2.5);

  const overflow = parentWindow
    ? scheduleOverflow({ startDate: start, endDate: end }, parentWindow)
    : null;

  const onPointerDown = (
    e: React.PointerEvent,
    mode: "move" | "resize-start" | "resize-end",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode,
      originX: e.clientX,
      start: block.startDate,
      end: block.endDate,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaDays = Math.round((e.clientX - drag.originX) / dayPx);
    if (deltaDays !== 0) drag.moved = true;
    const len = dayOffset(drag.start, drag.end);
    let nextStart = drag.start;
    let nextEnd = drag.end;
    if (drag.mode === "move") {
      nextStart = addDaysIso(drag.start, deltaDays);
      nextEnd = addDaysIso(nextStart, len);
    } else if (drag.mode === "resize-start") {
      nextStart = addDaysIso(drag.start, deltaDays);
      if (dayOffset(nextStart, drag.end) < 0) nextStart = drag.end;
      nextEnd = drag.end;
    } else {
      nextEnd = addDaysIso(drag.end, deltaDays);
      if (dayOffset(drag.start, nextEnd) < 0) nextEnd = drag.start;
      nextStart = drag.start;
    }
    liveRef.current = { start: nextStart, end: nextEnd };
    setLive({ start: nextStart, end: nextEnd });
  };

  const finishPointer = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      liveRef.current = null;
      setLive(null);
      onEdit();
      return;
    }
    const next = liveRef.current ?? { start: drag.start, end: drag.end };
    liveRef.current = null;
    setLive(null);
    if (next.start !== block.startDate || next.end !== block.endDate) {
      onMove(block.id, next.start, next.end);
    }
  };

  // Split bar into in-window (full color) and overflow (gray) segments
  const segments = parentWindow
    ? splitBarSegments(start, end, parentWindow.startDate, parentWindow.endDate)
    : [{ start, end, muted: false }];

  const paused = block.status === "wstrzymane";
  const done = block.status === "zakonczone";

  return (
    <div
      className={`absolute overflow-hidden rounded-md ${paused ? "opacity-70" : ""} ${
        done ? "opacity-60" : ""
      }`}
      style={{ left, width, top, height: barH }}
    >
      {segments.map((seg) => {
        const segLeft =
          (dayOffset(start, seg.start) / Math.max(1, dayOffset(start, end) + 1)) *
          100;
        const segWidth =
          ((dayOffset(seg.start, seg.end) + 1) /
            Math.max(1, dayOffset(start, end) + 1)) *
          100;
        return (
          <div
            key={`${seg.start}-${seg.end}-${seg.muted}`}
            className={`absolute inset-y-0 ${
              seg.muted ? "opacity-40" : ""
            }`}
            style={{
              left: `${segLeft}%`,
              width: `${segWidth}%`,
              background: seg.muted ? "#6b7280" : color,
              backgroundImage: seg.muted
                ? "repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)"
                : paused
                  ? "repeating-linear-gradient(45deg, rgba(0,0,0,0.28), rgba(0,0,0,0.28) 4px, transparent 4px, transparent 8px)"
                  : undefined,
            }}
          />
        );
      })}
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onEdit();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={() => {
          dragRef.current = null;
          liveRef.current = null;
          setLive(null);
        }}
        className={`absolute inset-0 flex cursor-grab items-stretch active:cursor-grabbing ${
          conflict
            ? "text-[#ffb4b4] ring-2 ring-red-400"
            : overflow?.outside
              ? "text-white ring-2 ring-amber-400"
              : "text-white shadow-sm"
        }`}
        title={`${label}\n${start} → ${end}\n${crew?.name ?? "Bez brygady"}\n${SCHEDULE_STATUS_LABEL[block.status]}${
          conflict ? "\n⚠ Konflikt brygad" : ""
        }${
          overflow?.outside
            ? "\n⚠ Poza przedziałem czasowym podkategorii"
            : ""
        }`}
      >
        <div
          className="w-1.5 shrink-0 cursor-ew-resize bg-black/20 hover:bg-black/35"
          onPointerDown={(e) => onPointerDown(e, "resize-start")}
        />
        <div
          className="relative min-w-0 flex-1 self-stretch overflow-hidden"
          onPointerDown={(e) => onPointerDown(e, "move")}
        >
          <div
            className="flex h-full min-w-0 items-center gap-1 truncate px-1.5 text-left text-[10px] font-semibold leading-none"
            style={{
              marginLeft: labelPad,
              maxWidth: Math.max(40, visibleW - handleW - 2),
              textShadow: conflict
                ? "0 0 3px rgba(0,0,0,0.95), 0 1px 2px rgba(0,0,0,0.9), 0 0 1px #450a0a"
                : "0 1px 2px rgba(0,0,0,0.55)",
            }}
          >
            {done ? (
              <CheckCircle2 size={9} className="shrink-0" aria-hidden />
            ) : null}
            <span className="truncate">{label}</span>
            {showCrew ? (
              <span className="truncate font-normal opacity-90">
                · {crew!.name}
              </span>
            ) : null}
          </div>
        </div>
        <div
          className="w-1.5 shrink-0 cursor-ew-resize bg-black/20 hover:bg-black/35"
          onPointerDown={(e) => onPointerDown(e, "resize-end")}
        />
      </div>
    </div>
  );
}

/** Split a work interval into in-window vs outside-parent segments. */
function splitBarSegments(
  start: string,
  end: string,
  winStart: string,
  winEnd: string,
): Array<{ start: string; end: string; muted: boolean }> {
  const segs: Array<{ start: string; end: string; muted: boolean }> = [];
  if (end < winStart || start > winEnd) {
    return [{ start, end, muted: true }];
  }
  if (start < winStart) {
    segs.push({
      start,
      end: addDaysIso(winStart, -1),
      muted: true,
    });
  }
  const inStart = start < winStart ? winStart : start;
  const inEnd = end > winEnd ? winEnd : end;
  if (inStart <= inEnd) {
    segs.push({ start: inStart, end: inEnd, muted: false });
  }
  if (end > winEnd) {
    segs.push({
      start: addDaysIso(winEnd, 1),
      end,
      muted: true,
    });
  }
  return segs.length ? segs : [{ start, end, muted: false }];
}

function CategoryLaneSheet({
  categoryId,
  catalogTitle,
  initialTitle,
  initialNote,
  window,
  scheduleCatalog,
  onClose,
  onSave,
  onAddSubcategory,
  onAddWork,
  onDelete,
  creating = false,
  showKindPicker = false,
  projectId: initialProjectId,
  projects = [],
}: {
  categoryId: string;
  catalogTitle: string;
  initialTitle: string;
  initialNote: string;
  window?: { start: string; end: string };
  scheduleCatalog: ScheduleCatalogPreset;
  onClose: () => void;
  onSave: (data: {
    categoryId: string;
    title: string;
    note: string;
    projectId?: string;
  }) => void;
  onAddSubcategory?: () => void;
  onAddWork?: () => void;
  onDelete?: () => void;
  creating?: boolean;
  /** Toolbar: Kategoria | Podkategoria | Zakres. */
  showKindPicker?: boolean;
  projectId?: string;
  projects?: PreviewProject[];
}) {
  const categories = scheduleCatalog.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const known = categories.some((c) => c.id === categoryId);
  /** Własna nazwa albo id spoza katalogu → tryb „Inny”. */
  const startAsInny = Boolean(initialTitle.trim()) || !known;
  const [preset, setPreset] = useState(
    startAsInny ? CATEGORY_INNY_VALUE : categoryId,
  );
  const [customTitle, setCustomTitle] = useState(
    startAsInny ? initialTitle.trim() || (known ? "" : catalogTitle) : "",
  );
  /** Przy edycji zachowaj id (np. stan-0 z własną nazwą / custom). */
  const [innyCategoryId] = useState(() =>
    startAsInny
      ? creating
        ? "" // nadamy przy zapisie z tytułu
        : categoryId || ""
      : "",
  );
  const [note, setNote] = useState(initialNote);
  const [projectId, setProjectId] = useState(
    initialProjectId ?? projects[0]?.id ?? "",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isInny = preset === CATEGORY_INNY_VALUE;
  const showProject = creating && projects.length > 1;

  const submit = () => {
    if (isInny && !customTitle.trim()) {
      alert("Podaj własną nazwę kategorii.");
      return;
    }
    const resolvedId = isInny
      ? innyCategoryId || newCustomCategoryId(customTitle.trim())
      : preset;
    onSave({
      categoryId: resolvedId,
      title: isInny ? customTitle.trim() : "",
      note: note.trim(),
      projectId: projectId || undefined,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div
        className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-md sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">
            {creating && showKindPicker
              ? "Nowa pozycja harmonogramu"
              : creating
                ? "Nowa kategoria"
                : "Edycja kategorii"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {showKindPicker && creating ? (
            <div className="flex gap-1 rounded-lg bg-surface-raised/60 p-0.5">
              <button
                type="button"
                aria-pressed
                className="flex-1 rounded-md bg-accent/15 px-2 py-1.5 text-[12px] font-medium text-accent"
              >
                Kategoria
              </button>
              <button
                type="button"
                onClick={() => onAddSubcategory?.()}
                className="flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-ink-faint transition hover:text-ink"
              >
                Podkategoria
              </button>
              <button
                type="button"
                onClick={() => onAddWork?.()}
                className="flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-ink-faint transition hover:text-ink"
              >
                Zakres
              </button>
            </div>
          ) : null}

          <FormSection>
            {showProject ? (
              <Field label="Budowa">
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {projectLabel(p)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Kategoria">
              <select
                value={preset}
                onChange={(e) => {
                  const v = e.target.value;
                  setPreset(v);
                  if (v !== CATEGORY_INNY_VALUE) setCustomTitle("");
                }}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
                <option value={CATEGORY_INNY_VALUE}>Inny</option>
              </select>
            </Field>
            {isInny ? (
              <Field label="Nazwa">
                <input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                  placeholder="Własna nazwa kategorii"
                  autoFocus={creating}
                />
              </Field>
            ) : null}
          </FormSection>

          {window ? (
            <p className="text-[12px] text-ink-faint">
              Okno na osi:{" "}
              <span className="text-ink-light">
                {shortDateRange(window.start, window.end)}
              </span>
              <span className="text-ink-faint"> (z pozycji w kategorii)</span>
            </p>
          ) : null}

          <FormSection>
            <Field label="Notatka">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                placeholder="Opcjonalnie…"
              />
            </Field>
          </FormSection>

          {!creating && (onAddSubcategory || onAddWork) ? (
            <div className="flex flex-col gap-1.5 border-t border-line/60 pt-3">
              {onAddSubcategory ? (
                <button
                  type="button"
                  onClick={onAddSubcategory}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-light hover:border-accent hover:text-accent"
                >
                  <FolderTree size={13} />
                  Dodaj podkategorię
                </button>
              ) : null}
              {onAddWork ? (
                <button
                  type="button"
                  onClick={onAddWork}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-light hover:border-accent hover:text-accent"
                >
                  <Plus size={13} />
                  Dodaj zakres
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {onDelete && confirmDelete ? (
            <div className="flex w-full flex-col gap-2">
              <p className="text-[12px] leading-snug text-red-300/90">
                Usunąć tę kategorię z harmonogramu budowy wraz z podkategoriami,
                zakresami i powiązanymi pozycjami?
              </p>
              <div className="flex flex-wrap justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-ink-light hover:bg-surface-raised"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={() => onDelete()}
                  className="rounded-lg bg-red-600/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
                >
                  Usuń definitywnie
                </button>
              </div>
            </div>
          ) : (
            <>
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30"
                >
                  Usuń
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-3 py-1.5 text-sm text-ink-light"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={submit}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Zapisz
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BlockEditorSheet({
  block,
  creating,
  createDefaults,
  defaultProjectId,
  projects,
  crews,
  scheduleCatalog,
  allBlocks,
  onClose,
  onSave,
  onPromote,
  onDemote,
  onDelete,
  onAddCrew,
  onPickCategory,
}: {
  block: ScheduleBlock | null;
  creating: boolean;
  createDefaults: {
    parentId?: string | null;
    role?: ScheduleBlockRole;
    categoryId?: string;
    projectId?: string;
    pickPositionKind?: boolean;
    scopePreset?: string;
    customScope?: string;
    startDate?: string;
    endDate?: string;
    crewId?: string;
    status?: ScheduleBlockStatus;
    note?: string;
    color?: string;
  };
  defaultProjectId: string;
  projects: PreviewProject[];
  crews: PreviewCrew[];
  scheduleCatalog: ScheduleCatalogPreset;
  allBlocks: ScheduleBlock[];
  onClose: () => void;
  onSave: (
    data: Omit<ScheduleBlock, "id"> & {
      id?: string;
      newCategoryTitle?: string;
    },
  ) => void;
  onPromote?: () => void;
  onDemote?: () => void;
  onDelete?: () => void;
  onAddCrew?: () => void;
  onPickCategory?: (draft?: {
    role?: ScheduleBlockRole;
    projectId?: string;
    parentId?: string | null;
    scopePreset?: string;
    customScope?: string;
    startDate?: string;
    endDate?: string;
    crewId?: string;
    status?: ScheduleBlockStatus;
    note?: string;
    color?: string;
  }) => void;
}) {
  const categories = scheduleCatalog.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const initialRole: ScheduleBlockRole =
    block?.role ?? createDefaults.role ?? "work";
  const [role, setRole] = useState<ScheduleBlockRole>(initialRole);
  const [projectId, setProjectId] = useState(
    block?.projectId ?? createDefaults.projectId ?? defaultProjectId,
  );
  const initialCategoryId =
    block?.categoryId ??
    createDefaults.categoryId ??
    categories[0]?.id ??
    "stan-0";
  const knownCategory = categories.some((c) => c.id === initialCategoryId);
  const startNoCategory = isProjectLevelEventCategory(initialCategoryId);
  const [categoryPreset, setCategoryPreset] = useState(
    startNoCategory
      ? PROJECT_LEVEL_EVENT_CATEGORY
      : knownCategory
        ? initialCategoryId
        : CATEGORY_INNY_VALUE,
  );
  const [customCategoryTitle, setCustomCategoryTitle] = useState("");
  const [categoryId, setCategoryId] = useState(
    startNoCategory ? PROJECT_LEVEL_EVENT_CATEGORY : initialCategoryId,
  );
  const scopes =
    categoryPreset === CATEGORY_INNY_VALUE ||
    categoryPreset === PROJECT_LEVEL_EVENT_CATEGORY
      ? ["Inny"]
      : (categories.find((c) => c.id === categoryId)?.scopes ?? ["Inny"]);
  /** Nazwa pracy = zakres; stare bloki mogły mieć title ≠ scope. */
  const initialScope =
    createDefaults.customScope?.trim() ||
    createDefaults.scopePreset ||
    block?.title?.trim() ||
    block?.scope ||
    scopes[0] ||
    "Inny";
  const scopeInList = scopes.includes(initialScope);
  const [scopePreset, setScopePreset] = useState(
    createDefaults.scopePreset && scopes.includes(createDefaults.scopePreset)
      ? createDefaults.scopePreset
      : scopeInList
        ? initialScope
        : "Inny",
  );
  const [customScope, setCustomScope] = useState(
    createDefaults.customScope ?? (scopeInList ? "" : initialScope),
  );
  const [parentId, setParentId] = useState<string | null>(
    block?.parentId ?? createDefaults.parentId ?? null,
  );
  const [crewId, setCrewId] = useState(
    block?.crewId ?? createDefaults.crewId ?? "",
  );
  const initialParent =
    createDefaults.parentId
      ? allBlocks.find((b) => b.id === createDefaults.parentId)
      : undefined;
  const [startDate, setStartDate] = useState(
    block?.startDate ??
      createDefaults.startDate ??
      initialParent?.startDate ??
      todayIso(),
  );
  const [endDate, setEndDate] = useState(
    block?.endDate ??
      createDefaults.endDate ??
      initialParent?.endDate ??
      todayIso(),
  );
  const [status, setStatus] = useState<ScheduleBlockStatus>(
    block?.status ?? createDefaults.status ?? "planowane",
  );
  const [note, setNote] = useState(block?.note ?? createDefaults.note ?? "");
  const [color, setColor] = useState(
    block?.color ??
      createDefaults.color ??
      crews.find((c) => c.id === crewId)?.color ??
      "#3b82f6",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDemote, setConfirmDemote] = useState(false);
  const childCount = block
    ? allBlocks.filter((b) => b.parentId === block.id).length
    : 0;
  const deleteMessage =
    block?.role === "subcategory" && childCount > 0
      ? `Ta podkategoria zawiera ${childCount} ${
          childCount === 1 ? "zakres" : childCount < 5 ? "zakresy" : "zakresów"
        }. Usunąć podkategorię wraz z zakresami?`
      : block?.role === "subcategory"
        ? "Usunąć tę podkategorię?"
        : "Usunąć ten zakres?";

  const parentOptions = allBlocks.filter(
    (b) =>
      b.role === "subcategory" &&
      b.projectId === projectId &&
      b.categoryId === categoryId &&
      b.id !== block?.id,
  );

  const parent = parentId
    ? allBlocks.find((b) => b.id === parentId)
    : undefined;
  const overflow =
    role === "work" && parent
      ? scheduleOverflow(
          {
            startDate,
            endDate: endDate < startDate ? startDate : endDate,
          },
          parent,
        )
      : null;

  const onPickRole = (value: ScheduleBlockRole) => {
    setRole(value);
    if (value !== "subcategory") return;
    setParentId(null);
    if (categoryPreset !== PROJECT_LEVEL_EVENT_CATEGORY) return;
    const first = categories[0]?.id ?? "stan-0";
    setCategoryPreset(first);
    setCategoryId(first);
    const next = categories.find((c) => c.id === first)?.scopes[0] ?? "Inny";
    setScopePreset(next);
    setCustomScope("");
  };

  const onCategoryChange = (id: string) => {
    if (id === CATEGORY_INNY_VALUE) {
      setCategoryPreset(CATEGORY_INNY_VALUE);
      setParentId(null);
      setScopePreset("Inny");
      setCustomScope("");
      return;
    }
    if (id === PROJECT_LEVEL_EVENT_CATEGORY) {
      setCategoryPreset(PROJECT_LEVEL_EVENT_CATEGORY);
      setCategoryId(PROJECT_LEVEL_EVENT_CATEGORY);
      setCustomCategoryTitle("");
      setParentId(null);
      setScopePreset("Inny");
      setCustomScope("");
      if (role === "subcategory") setRole("work");
      return;
    }
    setCategoryPreset(id);
    setCategoryId(id);
    setCustomCategoryTitle("");
    const next = categories.find((c) => c.id === id)?.scopes[0] ?? "Inny";
    setScopePreset(next);
    setCustomScope("");
    setParentId(null);
  };

  const resolvedScope =
    scopePreset === "Inny" ? customScope.trim() || "Inny" : scopePreset;

  const noCategory = categoryPreset === PROJECT_LEVEL_EVENT_CATEGORY;

  const draftSnapshot = () => ({
    role,
    projectId,
    parentId,
    scopePreset,
    customScope,
    startDate,
    endDate,
    crewId,
    status,
    note,
    color,
  });

  const submit = () => {
    if (!projectId) return;
    if (categoryPreset === CATEGORY_INNY_VALUE && !customCategoryTitle.trim()) {
      alert("Podaj nazwę nowej kategorii.");
      return;
    }
    if (scopePreset === "Inny" && !customScope.trim()) {
      alert("Podaj własną nazwę.");
      return;
    }
    if (role === "subcategory" && noCategory) {
      alert("Podkategoria wymaga kategorii. Wybierz kategorię albo dodaj zakres bez kategorii.");
      return;
    }
    const isNewCat = categoryPreset === CATEGORY_INNY_VALUE;
    const resolvedCategoryId = noCategory
      ? PROJECT_LEVEL_EVENT_CATEGORY
      : isNewCat
        ? newCustomCategoryId(customCategoryTitle.trim())
        : categoryId;
    const resolvedCrewId = role === "subcategory" ? "" : crewId;
    const crewColor = crews.find((c) => c.id === resolvedCrewId)?.color;
    onSave({
      id: block?.id,
      projectId,
      categoryId: resolvedCategoryId,
      scope: resolvedScope,
      title: resolvedScope,
      role: noCategory ? "work" : role,
      parentId: role === "work" && !noCategory ? parentId : null,
      crewId: resolvedCrewId,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      status: role === "subcategory" ? "planowane" : status,
      color: crewColor || color,
      note,
      newCategoryTitle: isNewCat ? customCategoryTitle.trim() : undefined,
    });
  };

  const heading =
    creating && createDefaults.pickPositionKind
      ? "Nowa pozycja harmonogramu"
      : creating && role === "subcategory"
        ? "Nowa podkategoria"
        : creating
          ? "Nowy zakres"
          : role === "subcategory"
            ? "Edycja podkategorii"
            : "Edycja zakresu";

  const showProject = projects.length > 1;
  const isWork = role === "work";
  /** Wejście z + przy podkategorii — od razu zakres, bez przełącznika typu. */
  const lockedAsWork = Boolean(creating && createDefaults.parentId);
  /** Toolbar / luźne dodawanie — wybór Kategoria | Podkategoria | Zakres. */
  const showKindPicker = Boolean(
    creating && createDefaults.pickPositionKind && !lockedAsWork,
  );
  /** Wejście z + przy kategorii — Podkategoria | Zakres. */
  const showTypeToggle = Boolean(
    creating && !lockedAsWork && !createDefaults.pickPositionKind,
  );

  const onParentChange = (id: string | null) => {
    setParentId(id);
    if (!id || block) return;
    const p = allBlocks.find((b) => b.id === id);
    if (!p) return;
    setStartDate(p.startDate);
    setEndDate(p.endDate);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{heading}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {showKindPicker ? (
            <div className="flex gap-1 rounded-lg bg-surface-raised/60 p-0.5">
              <button
                type="button"
                onClick={() => onPickCategory?.(draftSnapshot())}
                className="flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-ink-faint transition hover:text-ink"
              >
                Kategoria
              </button>
              {(
                [
                  ["subcategory", "Podkategoria"],
                  ["work", "Zakres"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onPickRole(value)}
                  aria-pressed={role === value}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
                    role === value
                      ? "bg-accent/15 text-accent"
                      : "text-ink-faint hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          {showTypeToggle ? (
            <div className="flex gap-1 rounded-lg bg-surface-raised/60 p-0.5">
              {(
                [
                  ["subcategory", "Podkategoria"],
                  ["work", "Zakres"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onPickRole(value)}
                  aria-pressed={role === value}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
                    role === value
                      ? "bg-accent/15 text-accent"
                      : "text-ink-faint hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <FormSection>
            {showProject ? (
              <Field label="Budowa">
                <select
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setParentId(null);
                  }}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {projectLabel(p)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Kategoria">
              <select
                value={categoryPreset}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                {isWork ? (
                  <option value={PROJECT_LEVEL_EVENT_CATEGORY}>
                    Bez kategorii (inwestycja)
                  </option>
                ) : null}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
                <option value={CATEGORY_INNY_VALUE}>Inna (nowa kategoria)</option>
              </select>
            </Field>
            {categoryPreset === CATEGORY_INNY_VALUE ? (
              <Field label="Nazwa kategorii">
                <input
                  value={customCategoryTitle}
                  onChange={(e) => setCustomCategoryTitle(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                  placeholder="np. Słoneczne tarasy"
                />
              </Field>
            ) : null}
            {isWork && !noCategory ? (
              <Field label="Podkategoria">
                <select
                  value={parentId ?? ""}
                  onChange={(e) =>
                    onParentChange(e.target.value ? e.target.value : null)
                  }
                  disabled={lockedAsWork}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink disabled:opacity-70"
                >
                  <option value="">Bez podkategorii</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title || p.scope}
                    </option>
                  ))}
                </select>
                {!lockedAsWork && parentOptions.length === 0 ? (
                  <p className="mt-1 text-[11px] text-ink-faint">
                    Brak podkategorii — zakres trafi bezpośrednio pod kategorię.
                  </p>
                ) : null}
              </Field>
            ) : null}
            {isWork && noCategory ? (
              <p className="text-[11px] text-ink-faint">
                Zakres bez kategorii trafi na wiersz inwestycji.
              </p>
            ) : null}
            <Field label={isWork ? "Zakres" : "Nazwa"}>
              <select
                value={scopePreset}
                onChange={(e) => {
                  setScopePreset(e.target.value);
                  if (e.target.value !== "Inny") setCustomScope("");
                }}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                {scopes.map((s) => (
                  <option key={s} value={s}>
                    {s === "Inny" ? "Inna (własna nazwa)" : s}
                  </option>
                ))}
              </select>
            </Field>
            {scopePreset === "Inny" ? (
              <Field label="Własna nazwa">
                <input
                  value={customScope}
                  onChange={(e) => setCustomScope(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                  placeholder={
                    isWork ? "np. Klejenie styropianu" : "np. Elewacja — budynek A"
                  }
                  autoFocus
                />
              </Field>
            ) : (
              <p className="text-[11px] text-ink-faint">
                Proponowane nazwy z katalogu. Wybierz „Inna”, aby wpisać własną.
              </p>
            )}
          </FormSection>

          <FormSection title="Termin">
            <div className="grid grid-cols-2 gap-2">
              <Field label={isWork ? "Od" : "Okno od"}>
                <IsoDateInput
                  value={startDate}
                  onChange={setStartDate}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 pr-9 text-sm text-ink outline-none focus:border-line-strong"
                />
              </Field>
              <Field label={isWork ? "Do" : "Okno do"}>
                <IsoDateInput
                  value={endDate}
                  onChange={setEndDate}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 pr-9 text-sm text-ink outline-none focus:border-line-strong"
                />
              </Field>
            </div>
            {overflow?.outside ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-100">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Termin wykracza poza okno podkategorii (
                  {parent?.startDate} → {parent?.endDate}). Możesz zapisać —
                  poza oknem będzie wyszarzane.
                </span>
              </div>
            ) : null}
          </FormSection>

          {isWork ? (
            <FormSection title="Realizacja">
              <Field label="Brygada">
                <div className="flex gap-2">
                  <select
                    value={crewId}
                    onChange={(e) => {
                      setCrewId(e.target.value);
                      const c = crews.find((x) => x.id === e.target.value);
                      if (c) setColor(c.color);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                  >
                    <option value="">Bez brygady</option>
                    {crews.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {onAddCrew ? (
                    <button
                      type="button"
                      onClick={onAddCrew}
                      title="Dodaj brygadę"
                      className="shrink-0 rounded-lg border border-line px-2.5 text-ink-light hover:border-accent hover:text-accent"
                    >
                      <Plus size={16} />
                    </button>
                  ) : null}
                </div>
              </Field>
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as ScheduleBlockStatus)
                  }
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {SCHEDULE_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </FormSection>
          ) : null}

          <FormSection>
            <Field label="Notatka">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                placeholder="Opcjonalnie…"
              />
            </Field>
          </FormSection>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {onPromote || onDemote ? (
            <div className="flex flex-col gap-1.5 border-t border-line/60 pt-3">
              {onPromote ? (
                <button
                  type="button"
                  onClick={onPromote}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10"
                >
                  <FolderTree size={13} />
                  Przekształć w podkategorię
                </button>
              ) : null}
              {onDemote && confirmDemote ? (
                <div className="flex flex-col gap-2 rounded-lg border border-line/80 bg-surface-raised/40 p-2.5">
                  <p className="text-[12px] leading-snug text-ink-light">
                    Cofnąć podkategorię? Prace zostaną na liście jako osobne
                    roboty.
                  </p>
                  <div className="flex flex-wrap justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDemote(false)}
                      className="rounded-lg px-3 py-1.5 text-xs text-ink-light hover:bg-surface-raised"
                    >
                      Anuluj
                    </button>
                    <button
                      type="button"
                      onClick={() => onDemote()}
                      className="rounded-lg bg-accent/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent"
                    >
                      Cofnij podkategorię
                    </button>
                  </div>
                </div>
              ) : onDemote ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setConfirmDemote(true);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs text-ink-light hover:bg-surface-raised hover:text-ink"
                >
                  Cofnij podkategorię (prace zostają)
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2">
            {onDelete && confirmDelete ? (
              <div className="flex w-full flex-col gap-2">
                <p className="text-[12px] leading-snug text-red-300/90">
                  {deleteMessage}
                </p>
                <div className="flex flex-wrap justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-ink-light hover:bg-surface-raised"
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete()}
                    className="rounded-lg bg-red-600/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
                  >
                    Usuń definitywnie
                  </button>
                </div>
              </div>
            ) : (
              <>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDemote(false);
                      setConfirmDelete(true);
                    }}
                    className="rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30"
                  >
                    Usuń
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-3 py-1.5 text-sm text-ink-light"
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
                  >
                    Zapisz
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FormSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      {title ? (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          {title}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function dayOffset(from: string, to: string) {
  return Math.round((parseDay(to) - parseDay(from)) / 86400000);
}

function addDaysIso(iso: string, days: number) {
  const t = parseDay(iso) + days * 86400000;
  const dt = new Date(t);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
