import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  aggregateAttendanceByCrew,
  type AttendanceDayCell,
  type CrewAttendanceBoardRow,
} from "@/lib/projectsPreview/attendanceAggregate";
import {
  ATTENDANCE_RANGE_LABEL,
  ATTENDANCE_RANGE_MODES,
  ATTENDANCE_RANGE_TITLE,
  attendanceDaysForMode,
  shiftAttendanceFocus,
  type AttendanceRangeMode,
} from "@/lib/projectsPreview/attendanceWindow";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import type { CrewAttendance } from "@/lib/projectsPreview/types";
import { AttendanceConfirmSheet } from "./AttendanceConfirmSheet";
import { CrewAttendanceSheet } from "./CrewAttendanceSheet";

interface AttendanceWeekViewProps {
  projectIds?: string[] | "all";
}

const DOW = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"] as const;
const DOW_LONG = [
  "Niedziela",
  "Poniedziałek",
  "Wtorek",
  "Środa",
  "Czwartek",
  "Piątek",
  "Sobota",
] as const;

function utcDayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function dayLabel(iso: string): { dow: string; day: string } {
  const jsDay = utcDayOfWeek(iso);
  return {
    dow: DOW[jsDay]!,
    day: String(Number(iso.slice(8))).padStart(2, "0"),
  };
}

function formatLongDay(iso: string): string {
  const jsDay = utcDayOfWeek(iso);
  const day = Number(iso.slice(8));
  const month = Number(iso.slice(5, 7));
  return `${DOW_LONG[jsDay]} ${day}.${String(month).padStart(2, "0")}.${iso.slice(0, 4)}`;
}

/** Sobota lekko szara, niedziela mocniej — tło całej kolumny. */
function weekendColClass(iso: string): string {
  const jsDay = utcDayOfWeek(iso);
  if (jsDay === 6) return "bg-white/[0.04]";
  if (jsDay === 0) return "bg-white/[0.09]";
  return "";
}

function formatMonthSpan(start: string, end: string): string {
  const a = start.slice(0, 7);
  const b = end.slice(0, 7);
  if (a === b) {
    const [y, m] = a.split("-");
    return `${m}.${y}`;
  }
  return `${start.slice(5, 7)}.${start.slice(0, 4)} – ${end.slice(5, 7)}.${end.slice(0, 4)}`;
}

function formatHours(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function cellTitle(cell: AttendanceDayCell, empty: boolean): string {
  if (empty) return "Brak oświadczenia — kliknij, aby dodać";
  const parts = [
    `${cell.headcount} os.`,
    `${formatHours(cell.laborHours)} RH`,
  ];
  if (cell.equipmentHours > 0) {
    parts.push(
      `sprzęt ${cell.equipmentQty} szt. · ${formatHours(cell.equipmentHours)} h`,
    );
  }
  if (cell.allConfirmed) parts.push("potwierdzone");
  else if (cell.hasDeclared) parts.push("do potwierdzenia");
  return parts.join(" · ");
}

/** Company × day attendance board with 1 / 5 / 11 / month ranges. */
export function AttendanceWeekView({
  projectIds = "all",
}: AttendanceWeekViewProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const today = todayIso();
  const isMobile = useIsMobile();
  const [rangeMode, setRangeMode] = useState<AttendanceRangeMode>(() =>
    isMobile ? "day" : "days11",
  );
  const [focusDate, setFocusDate] = useState(today);
  const [confirm, setConfirm] = useState<{
    crewId: string;
    crewLabel: string;
    workDate: string;
  } | null>(null);
  const [adding, setAdding] = useState<{
    crewId: string;
    crewLabel: string;
    workDate: string;
  } | null>(null);
  const [editingAttendance, setEditingAttendance] =
    useState<CrewAttendance | null>(null);


  const window = useMemo(
    () => attendanceDaysForMode(focusDate, rangeMode),
    [focusDate, rangeMode],
  );

  const rows = useMemo(
    () =>
      aggregateAttendanceByCrew(
        state.crewAttendance,
        state.crewEquipmentLogs,
        state.crews,
        window.days,
        { projectIds },
      ),
    [
      state.crewAttendance,
      state.crewEquipmentLogs,
      state.crews,
      window.days,
      projectIds,
    ],
  );

  const confirmRows: CrewAttendance[] = useMemo(() => {
    if (!confirm) return [];
    const projectFilter =
      projectIds === "all" ? null : new Set(projectIds);
    return state.crewAttendance.filter((a) => {
      if (a.workDate !== confirm.workDate) return false;
      if (a.crewId !== confirm.crewId) return false;
      if (projectFilter && !projectFilter.has(a.projectId)) return false;
      return true;
    });
  }, [confirm, state.crewAttendance, projectIds]);

  const openCell = (
    crewId: string,
    crewLabel: string,
    workDate: string,
    hasEntries: boolean,
  ) => {
    if (!hasEntries) {
      setAdding({ crewId, crewLabel, workDate });
      return;
    }
    setConfirm({ crewId, crewLabel, workDate });
  };

  const addingCrew = useMemo(() => {
    if (!adding) return null;
    return state.crews.find((c) => c.id === adding.crewId) ?? null;
  }, [adding, state.crews]);

  const editingCrew = useMemo(() => {
    if (!editingAttendance) return null;
    return state.crews.find((c) => c.id === editingAttendance.crewId) ?? null;
  }, [editingAttendance, state.crews]);

  const confirmEquipment = useMemo(() => {
    if (!confirmRows.length) return [];
    const ids = new Set(confirmRows.map((r) => r.id));
    return state.crewEquipmentLogs.filter((e) => ids.has(e.attendanceId));
  }, [confirmRows, state.crewEquipmentLogs]);

  const editingEquipment = useMemo(() => {
    if (!editingAttendance) return [];
    return state.crewEquipmentLogs.filter(
      (e) => e.attendanceId === editingAttendance.id,
    );
  }, [editingAttendance, state.crewEquipmentLogs]);

  const visibleProjects = useMemo(() => {
    const list = state.projects.filter(
      (p) =>
        p.status === "active" &&
        (p.adminUserId === state.viewAsUserId ||
          p.memberIds.includes(state.viewAsUserId)),
    );
    if (projectIds === "all") return list;
    const wanted = new Set(projectIds);
    return list.filter((p) => wanted.has(p.id));
  }, [state.projects, state.viewAsUserId, projectIds]);

  const rangeCaption =
    rangeMode === "day"
      ? formatLongDay(window.start)
      : rangeMode === "month"
        ? formatMonthSpan(window.start, window.end)
        : `${formatMonthSpan(window.start, window.end)} · ${window.days.length} dni`;

  const tableMinWidth =
    rangeMode === "month"
      ? Math.max(640, 120 + window.days.length * 28)
      : rangeMode === "days11"
        ? 720
        : rangeMode === "days5"
          ? 480
          : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setFocusDate((d) => shiftAttendanceFocus(d, rangeMode, -1))
            }
            className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
            aria-label="Poprzedni okres"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() =>
              setFocusDate((d) => shiftAttendanceFocus(d, rangeMode, 1))
            }
            className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-raised hover:text-ink"
            aria-label="Następny okres"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setFocusDate(today)}
            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
          >
            Dziś
          </button>
        </div>

        <div
          className="inline-flex rounded-lg border border-line bg-surface-raised/60 p-0.5"
          role="group"
          aria-label="Zakres widoku"
        >
          {ATTENDANCE_RANGE_MODES.map((mode) => {
            const active = mode === rangeMode;
            return (
              <button
                key={mode}
                type="button"
                title={ATTENDANCE_RANGE_TITLE[mode]}
                onClick={() => setRangeMode(mode)}
                className={`min-w-[1.75rem] rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums transition ${
                  active
                    ? "bg-accent text-white"
                    : "text-ink-faint hover:text-ink"
                }`}
              >
                {ATTENDANCE_RANGE_LABEL[mode]}
              </button>
            );
          })}
        </div>

        <p className="max-w-full truncate text-[12px] text-ink-light sm:text-right">
          {rangeCaption}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto thin-scrollbar">
        {state.crews.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-faint">
            Brak brygad — dodaj je w zakładce Brygady, potem wpisuj obecność.
          </p>
        ) : rangeMode === "day" ? (
          <DayCrewList
            workDate={window.start}
            today={today}
            rows={rows}
            onOpen={(row, hasEntries) =>
              openCell(row.crewId, row.crewLabel, window.start, hasEntries)
            }
          />
        ) : (
          <table
            className="w-full border-collapse text-left text-[11px]"
            style={
              tableMinWidth ? { minWidth: `${tableMinWidth}px` } : undefined
            }
          >
            <thead className="sticky top-0 z-10 bg-surface-raised/95 backdrop-blur-sm">
              <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="sticky left-0 z-20 min-w-[8rem] bg-surface-raised/95 px-2 py-1">
                  Brygada
                </th>
                {window.days.map((iso) => {
                  const { dow, day } = dayLabel(iso);
                  const isToday = iso === today;
                  const weekend = weekendColClass(iso);
                  return (
                    <th
                      key={iso}
                      className={`px-0.5 py-1 text-center ${
                        rangeMode === "month" ? "w-7" : "w-[3.2rem]"
                      } ${weekend} ${isToday ? "text-accent" : ""}`}
                    >
                      <div>{rangeMode === "month" ? dow.charAt(0) : dow}</div>
                      <div className="tabular-nums normal-case tracking-normal">
                        {day}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CrewRow
                  key={row.crewId}
                  label={row.crewLabel}
                  company={row.company}
                  days={window.days}
                  today={today}
                  cells={row.days}
                  compact={rangeMode === "month"}
                  onOpen={(workDate, hasEntries) =>
                    openCell(row.crewId, row.crewLabel, workDate, hasEntries)
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm ? (
        <AttendanceConfirmSheet
          crewLabel={confirm.crewLabel}
          workDate={confirm.workDate}
          rows={confirmRows}
          equipment={confirmEquipment}
          crews={state.crews}
          projects={state.projects}
          onClose={() => setConfirm(null)}
          onSaveNote={(id, note) => {
            const prev = state.crewAttendance.find((a) => a.id === id);
            if (!prev) return;
            repo.upsertCrewAttendance({
              id: prev.id,
              crewId: prev.crewId,
              projectId: prev.projectId,
              workDate: prev.workDate,
              note,
              status: prev.status,
            });
          }}
          onSetStatus={(status) => {
            for (const r of confirmRows) {
              repo.setAttendanceStatus(r.id, status);
            }
          }}
          onEdit={(row) => {
            setConfirm(null);
            setEditingAttendance(row);
          }}
        />
      ) : null}

      {adding && addingCrew ? (
        <CrewAttendanceSheet
          key={`add-${adding.crewId}-${adding.workDate}`}
          crew={addingCrew}
          crews={state.crews}
          attendanceHistory={state.crewAttendance}
          projects={visibleProjects}
          blocks={state.scheduleBlocks}
          defaultDate={adding.workDate}
          onClose={() => setAdding(null)}
          onSave={(data) => {
            repo.upsertCrewAttendance(data);
            setAdding(null);
          }}
        />
      ) : null}

      {editingAttendance && editingCrew ? (
        <CrewAttendanceSheet
          key={`edit-${editingAttendance.id}`}
          crew={editingCrew}
          crews={state.crews}
          attendanceHistory={state.crewAttendance}
          projects={visibleProjects}
          blocks={state.scheduleBlocks}
          existing={editingAttendance}
          existingEquipment={editingEquipment}
          onClose={() => setEditingAttendance(null)}
          onSave={(data) => {
            repo.upsertCrewAttendance(data);
            setEditingAttendance(null);
          }}
          onDelete={() => {
            repo.deleteCrewAttendance(editingAttendance.id);
            setEditingAttendance(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DayCrewList({
  workDate,
  today,
  rows,
  onOpen,
}: {
  workDate: string;
  today: string;
  rows: CrewAttendanceBoardRow[];
  onOpen: (row: CrewAttendanceBoardRow, hasEntries: boolean) => void;
}) {
  return (
    <ul className="divide-y divide-line/60 sm:mx-auto sm:max-w-lg">
      {rows.map((row) => {
        const cell = row.days[workDate]!;
        const empty = cell.attendanceIds.length === 0;
        const isToday = workDate === today;
        return (
          <li key={row.crewId}>
            <button
              type="button"
              onClick={() => onOpen(row, !empty)}
              className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-surface-raised/50 ${
                isToday ? "bg-accent/[0.04]" : ""
              }`}
              title={cellTitle(cell, empty)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">
                  {row.crewLabel}
                </p>
                {row.company ? (
                  <p className="truncate text-[11px] text-ink-faint">
                    {row.company}
                  </p>
                ) : null}
                {empty ? (
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    Brak wpisu — dodaj obecność
                  </p>
                ) : (
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-light">
                    <span className="inline-flex items-center gap-1 font-medium text-ink">
                      {cell.allConfirmed ? (
                        <Check size={12} className="text-emerald-300" />
                      ) : null}
                      {cell.headcount} os. · {formatHours(cell.laborHours)} RH
                    </span>
                    {cell.equipmentHours > 0 ? (
                      <span className="inline-flex items-center gap-1 text-ink-faint">
                        <Wrench size={11} />
                        {formatHours(cell.equipmentHours)}h
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                  empty
                    ? "bg-accent/15 text-accent"
                    : cell.allConfirmed
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-surface-raised text-ink-light"
                }`}
              >
                {empty ? "Dodaj" : cell.allConfirmed ? "OK" : "Otwórz"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One row per brigade — people + equipment in the same cell. */
function CrewRow({
  label,
  company,
  days,
  today,
  cells,
  compact,
  onOpen,
}: {
  label: string;
  company: string;
  days: string[];
  today: string;
  cells: Record<string, AttendanceDayCell>;
  compact?: boolean;
  onOpen: (workDate: string, hasEntries: boolean) => void;
}) {
  return (
    <tr className="border-b border-line/40">
      <td className="sticky left-0 z-10 max-w-[10rem] bg-surface px-2 py-1">
        <div className="truncate text-[12px] font-semibold text-ink">{label}</div>
        {company ? (
          <div className="truncate text-[10px] text-ink-faint">{company}</div>
        ) : null}
      </td>
      {days.map((iso) => {
        const cell = cells[iso]!;
        const empty = cell.attendanceIds.length === 0;
        const weekend = weekendColClass(iso);
        const hasEq = cell.equipmentHours > 0;
        return (
          <td
            key={iso}
            className={`px-0.5 py-0.5 text-center ${weekend}`}
          >
            <button
              type="button"
              onClick={() => onOpen(iso, !empty)}
              className={`inline-flex min-h-[2rem] w-full min-w-[1.6rem] flex-col items-center justify-center rounded px-0.5 tabular-nums transition hover:bg-surface-raised ${
                iso === today ? "ring-1 ring-accent/30" : ""
              } ${
                empty
                  ? "text-ink-faint"
                  : cell.allConfirmed
                    ? "font-semibold text-emerald-300"
                    : "font-medium text-ink"
              }`}
              title={cellTitle(cell, empty)}
            >
              {empty ? (
                "—"
              ) : compact ? (
                <span className="inline-flex items-center gap-0.5">
                  {cell.allConfirmed ? <Check size={8} /> : null}
                  {cell.headcount}
                  {hasEq ? (
                    <span className="text-[8px] text-ink-faint">·</span>
                  ) : null}
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-0.5 leading-none">
                    {cell.allConfirmed ? <Check size={9} /> : null}
                    {cell.headcount}
                  </span>
                  {hasEq ? (
                    <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-normal leading-none text-ink-faint">
                      <Wrench size={8} />
                      {formatHours(cell.equipmentHours)}
                    </span>
                  ) : (
                    <span className="mt-0.5 text-[9px] font-normal leading-none text-ink-faint">
                      {formatHours(cell.laborHours)}RH
                    </span>
                  )}
                </>
              )}
            </button>
          </td>
        );
      })}
    </tr>
  );
}
