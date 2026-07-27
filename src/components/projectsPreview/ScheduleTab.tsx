import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Copy,
  ListTodo,
  Plus,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  SCHEDULE_STATUS_LABEL,
  projectLabel,
  type PreviewProject,
  type ScheduleBlock,
  type ScheduleBlockStatus,
} from "@/lib/projectsPreview/types";
import {
  SimulateItemDialog,
  type SimulateKind,
} from "./SimulateItemDialog";

type ScheduleViewMode = "project" | "allBuilds" | "byCrew";

interface ScheduleTabProps {
  /** When set, default to single-project axis. */
  projectId?: string;
  showViewSwitcher?: boolean;
}

const STATUSES = Object.keys(SCHEDULE_STATUS_LABEL) as ScheduleBlockStatus[];

export function ScheduleTab({
  projectId,
  showViewSwitcher = true,
}: ScheduleTabProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const [mode, setMode] = useState<ScheduleViewMode>(
    projectId ? "project" : "allBuilds",
  );
  const [editing, setEditing] = useState<ScheduleBlock | null>(null);
  const [creating, setCreating] = useState(false);
  const [simulate, setSimulate] = useState<{
    kind: SimulateKind;
    block: ScheduleBlock;
    project: PreviewProject;
  } | null>(null);

  const budowaProjects = useMemo(
    () =>
      state.projects.filter(
        (p) =>
          p.kind === "budowa" &&
          (p.adminUserId === state.viewAsUserId ||
            p.memberIds.includes(state.viewAsUserId)),
      ),
    [state.projects, state.viewAsUserId],
  );

  const blocks =
    mode === "project" && projectId
      ? repo.listSchedule(projectId)
      : repo.listSchedule();

  const conflicts = repo.crewConflicts();
  const conflictIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      s.add(c.a.id);
      s.add(c.b.id);
    }
    return s;
  }, [conflicts]);

  const range = useMemo(() => dateRange(blocks), [blocks]);

  const crewName = (id: string) =>
    state.crews.find((c) => c.id === id)?.name ?? "Ekipa";

  const openEditor = (block: ScheduleBlock | null) => {
    if (block) {
      setEditing(block);
      setCreating(false);
    } else {
      setCreating(true);
      setEditing(null);
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setCreating(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        {showViewSwitcher ? (
          <div className="flex flex-wrap gap-1">
            {(
              [
                projectId ? (["project", "Ta budowa"] as const) : null,
                ["allBuilds", "Wszystkie budowy"] as const,
                ["byCrew", "Według ekip"] as const,
              ].filter(Boolean) as Array<[ScheduleViewMode, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  mode === id
                    ? "bg-accent/15 text-accent"
                    : "text-ink-faint hover:bg-surface-raised hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => openEditor(null)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white"
        >
          <Plus size={13} />
          Dodaj robotę
        </button>
      </div>

      {conflicts.length > 0 ? (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-100">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Wykryto {conflicts.length}{" "}
            {conflicts.length === 1 ? "konflikt" : "konflikty"} terminów ekip
            (ostrzeżenie — nie blokuje zapisu).
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto thin-scrollbar p-3 sm:p-4">
        {mode === "byCrew" ? (
          <CrewLanes
            crews={state.crews}
            blocks={blocks}
            projects={state.projects}
            range={range}
            conflictIds={conflictIds}
            onEdit={openEditor}
          />
        ) : mode === "allBuilds" ? (
          <ProjectLanes
            projects={budowaProjects}
            blocks={blocks}
            crews={state.crews}
            range={range}
            conflictIds={conflictIds}
            onEdit={openEditor}
          />
        ) : (
          <ProjectTimeline
            blocks={blocks
              .filter((b) => !projectId || b.projectId === projectId)
              .slice()
              .sort((a, b) => a.startDate.localeCompare(b.startDate))}
            crews={state.crews}
            conflictIds={conflictIds}
            onEdit={openEditor}
            onCopy={(id) => repo.copyScheduleBlock(id)}
            onSimulate={(kind, block) => {
              const p =
                repo.getProjectIfVisible(block.projectId) ??
                state.projects.find((x) => x.id === block.projectId);
              if (!p) return;
              setSimulate({ kind, block, project: p });
            }}
            crewName={crewName}
          />
        )}
      </div>

      {(editing || creating) && (
        <BlockEditorSheet
          key={editing?.id ?? "new"}
          block={editing}
          creating={creating}
          defaultProjectId={projectId ?? budowaProjects[0]?.id ?? ""}
          projects={budowaProjects.length ? budowaProjects : state.projects}
          crews={state.crews}
          onClose={closeEditor}
          onSave={(data) => {
            repo.upsertScheduleBlock(data);
            closeEditor();
          }}
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

      {simulate ? (
        <SimulateItemDialog
          open
          kind={simulate.kind}
          project={simulate.project}
          block={simulate.block}
          crewName={crewName(simulate.block.crewId)}
          onClose={() => setSimulate(null)}
        />
      ) : null}
    </div>
  );
}

function ProjectTimeline({
  blocks,
  crews,
  conflictIds,
  onEdit,
  onCopy,
  onSimulate,
  crewName,
}: {
  blocks: ScheduleBlock[];
  crews: { id: string; name: string; color: string }[];
  conflictIds: Set<string>;
  onEdit: (b: ScheduleBlock) => void;
  onCopy: (id: string) => void;
  onSimulate: (kind: SimulateKind, b: ScheduleBlock) => void;
  crewName: (id: string) => string;
}) {
  if (blocks.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-faint">
        Brak bloków w planie. Dodaj pierwszą robotę.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {blocks.map((b) => {
        const crew = crews.find((c) => c.id === b.crewId);
        return (
          <li
            key={b.id}
            className={`rounded-xl border px-3 py-2.5 ${
              conflictIds.has(b.id)
                ? "border-amber-500/50 bg-amber-950/20"
                : "border-line bg-surface-raised/30"
            }`}
          >
            <button
              type="button"
              onClick={() => onEdit(b)}
              className="w-full text-left"
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: b.color || crew?.color || "#888" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink">{b.title}</div>
                  <div className="mt-0.5 text-[11px] text-ink-faint">
                    {crewName(b.crewId)} · {b.startDate} → {b.endDate} ·{" "}
                    {SCHEDULE_STATUS_LABEL[b.status]}
                  </div>
                </div>
              </div>
            </button>
            <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
              <MiniAction
                icon={<Copy size={12} />}
                label="Kopiuj"
                onClick={() => onCopy(b.id)}
              />
              <MiniAction
                icon={<ListTodo size={12} />}
                label="Utwórz zadanie"
                onClick={() => onSimulate("task", b)}
              />
              <MiniAction
                icon={<CalendarPlus size={12} />}
                label="Utwórz wydarzenie"
                onClick={() => onSimulate("event", b)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectLanes({
  projects,
  blocks,
  crews,
  range,
  conflictIds,
  onEdit,
}: {
  projects: PreviewProject[];
  blocks: ScheduleBlock[];
  crews: { id: string; name: string; color: string }[];
  range: { start: string; end: string; days: number };
  conflictIds: Set<string>;
  onEdit: (b: ScheduleBlock) => void;
}) {
  if (projects.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-faint">
        Brak widocznych projektów typu Budowa.
      </p>
    );
  }
  return (
    <div className="min-w-[36rem] space-y-3">
      <AxisHeader range={range} />
      {projects.map((p) => (
        <div key={p.id}>
          <div className="mb-1 truncate text-[11px] font-medium text-ink-faint">
            {projectLabel(p)}
          </div>
          <LaneTrack
            blocks={blocks.filter((b) => b.projectId === p.id)}
            range={range}
            crews={crews}
            conflictIds={conflictIds}
            onEdit={onEdit}
          />
        </div>
      ))}
    </div>
  );
}

function CrewLanes({
  crews,
  blocks,
  projects,
  range,
  conflictIds,
  onEdit,
}: {
  crews: { id: string; name: string; color: string }[];
  blocks: ScheduleBlock[];
  projects: PreviewProject[];
  range: { start: string; end: string; days: number };
  conflictIds: Set<string>;
  onEdit: (b: ScheduleBlock) => void;
}) {
  return (
    <div className="min-w-[36rem] space-y-3">
      <AxisHeader range={range} />
      {crews.map((crew) => (
        <div key={crew.id}>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-faint">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: crew.color }}
            />
            {crew.name}
          </div>
          <LaneTrack
            blocks={blocks.filter((b) => b.crewId === crew.id)}
            range={range}
            crews={crews}
            conflictIds={conflictIds}
            onEdit={onEdit}
            labelFor={(b) => {
              const p = projects.find((x) => x.id === b.projectId);
              return p ? `#${p.number} ${b.title}` : b.title;
            }}
          />
        </div>
      ))}
    </div>
  );
}

function AxisHeader({
  range,
}: {
  range: { start: string; end: string; days: number };
}) {
  return (
    <div className="text-[10px] text-ink-faint">
      Oś: {range.start} → {range.end} ({range.days} dni) · przewiń poziomo na
      telefonie
    </div>
  );
}

function LaneTrack({
  blocks,
  range,
  crews,
  conflictIds,
  onEdit,
  labelFor,
}: {
  blocks: ScheduleBlock[];
  range: { start: string; end: string; days: number };
  crews: { id: string; name: string; color: string }[];
  conflictIds: Set<string>;
  onEdit: (b: ScheduleBlock) => void;
  labelFor?: (b: ScheduleBlock) => string;
}) {
  return (
    <div className="relative h-10 overflow-hidden rounded-lg border border-line bg-surface-raised/20">
      {blocks.map((b) => {
        const left = dayOffset(range.start, b.startDate) / range.days;
        const width =
          (dayOffset(b.startDate, b.endDate) + 1) / range.days;
        const crew = crews.find((c) => c.id === b.crewId);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onEdit(b)}
            title={`${b.title} (${b.startDate}–${b.endDate})`}
            className={`absolute top-1 bottom-1 truncate rounded px-1.5 text-left text-[10px] font-medium text-white shadow-sm ${
              conflictIds.has(b.id) ? "ring-2 ring-amber-400" : ""
            }`}
            style={{
              left: `${Math.max(0, left) * 100}%`,
              width: `${Math.max(0.04, width) * 100}%`,
              background: b.color || crew?.color || "#64748b",
            }}
          >
            {labelFor?.(b) ?? b.title}
          </button>
        );
      })}
    </div>
  );
}

function BlockEditorSheet({
  block,
  creating,
  defaultProjectId,
  projects,
  crews,
  onClose,
  onSave,
  onDelete,
}: {
  block: ScheduleBlock | null;
  creating: boolean;
  defaultProjectId: string;
  projects: PreviewProject[];
  crews: { id: string; name: string; color: string }[];
  onClose: () => void;
  onSave: (data: Omit<ScheduleBlock, "id"> & { id?: string }) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(block?.title ?? "");
  const [projectId, setProjectId] = useState(
    block?.projectId ?? defaultProjectId,
  );
  const [crewId, setCrewId] = useState(block?.crewId ?? crews[0]?.id ?? "");
  const [startDate, setStartDate] = useState(
    block?.startDate ?? todayIso(),
  );
  const [endDate, setEndDate] = useState(block?.endDate ?? todayIso());
  const [status, setStatus] = useState<ScheduleBlockStatus>(
    block?.status ?? "planowane",
  );
  const [note, setNote] = useState(block?.note ?? "");
  const [color, setColor] = useState(
    block?.color ?? crews.find((c) => c.id === crewId)?.color ?? "#3b82f6",
  );

  const submit = () => {
    if (!title.trim() || !projectId || !crewId) return;
    onSave({
      id: block?.id,
      projectId,
      title: title.trim(),
      crewId,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      status,
      color,
      note,
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
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">
            {creating ? "Nowa robota" : "Edycja bloku"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-[11px] text-ink-faint">
          Zmień daty tutaj (wygodne na telefonie zamiast przeciągania).
        </p>
        <div className="space-y-2.5">
          <Field label="Nazwa">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label="Projekt">
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
          <Field label="Ekipa">
            <select
              value={crewId}
              onChange={(e) => {
                setCrewId(e.target.value);
                const c = crews.find((x) => x.id === e.target.value);
                if (c) setColor(c.color);
              }}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            >
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Od">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Do">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
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
          <Field label="Notatka">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
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
        </div>
      </div>
    </div>,
    document.body,
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

function MiniAction({
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
      className="inline-flex items-center gap-1 rounded-md border border-line/70 px-1.5 py-1 text-[10px] font-medium text-ink-light transition hover:border-accent/40 hover:text-accent"
    >
      {icon}
      {label}
    </button>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function dayOffset(from: string, to: string) {
  return Math.round((parseDay(to) - parseDay(from)) / 86400000);
}

function dateRange(blocks: ScheduleBlock[]) {
  if (blocks.length === 0) {
    const t = todayIso();
    return { start: t, end: t, days: 14 };
  }
  let start = blocks[0]!.startDate;
  let end = blocks[0]!.endDate;
  for (const b of blocks) {
    if (b.startDate < start) start = b.startDate;
    if (b.endDate > end) end = b.endDate;
  }
  const days = Math.max(7, dayOffset(start, end) + 1);
  return { start, end, days };
}
