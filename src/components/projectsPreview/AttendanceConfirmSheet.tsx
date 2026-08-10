import { useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardList, Pencil, Wrench, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  EQUIPMENT_PRESET_LABEL,
  isEquipmentPresetKey,
} from "@/lib/projectsPreview/equipmentPresets";
import {
  WORKER_ABSENCE_LABEL,
  isWorkerAbsenceCode,
  totalLaborHours,
  workerLaborHours,
} from "@/lib/projectsPreview/workerShifts";
import {
  projectLabel,
  type CrewAttendance,
  type CrewEquipmentLog,
  type PreviewCrew,
  type PreviewProject,
  type WorkerAbsenceCode,
} from "@/lib/projectsPreview/types";

interface AttendanceConfirmSheetProps {
  crewLabel: string;
  workDate: string;
  rows: CrewAttendance[];
  equipment: CrewEquipmentLog[];
  crews: PreviewCrew[];
  projects: PreviewProject[];
  onClose: () => void;
  onSaveNote: (id: string, note: string) => void;
  onSetStatus: (status: "declared" | "confirmed") => void;
  onEdit?: (row: CrewAttendance) => void;
}

function formatPlDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function formatRh(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

type FlatPerson = {
  key: string;
  startTime: string | null;
  endTime: string | null;
  hours: number;
  personLabel: string;
  buildLabel: string;
  absence: WorkerAbsenceCode | null;
  /** Fallback when no shift times — show headcount line. */
  summaryOnly?: boolean;
};

/** Read-only attendance summary + confirm / unconfirm status. */
export function AttendanceConfirmSheet({
  crewLabel,
  workDate,
  rows,
  equipment,
  crews,
  projects,
  onClose,
  onSaveNote,
  onSetStatus,
  onEdit,
}: AttendanceConfirmSheetProps) {
  const crewById = useMemo(
    () => new Map(crews.map((c) => [c.id, c])),
    [crews],
  );
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const equipmentByAttendance = useMemo(() => {
    const map = new Map<string, CrewEquipmentLog[]>();
    for (const e of equipment) {
      const list = map.get(e.attendanceId) ?? [];
      list.push(e);
      map.set(e.attendanceId, list);
    }
    return map;
  }, [equipment]);

  const crew = rows[0] ? crewById.get(rows[0].crewId) : undefined;

  const people = useMemo(() => {
    const out: FlatPerson[] = [];
    for (const row of rows) {
      const defaultProject = projectById.get(row.projectId);
      const defaultLabel = defaultProject
        ? projectLabel(defaultProject)
        : "Budowa";
      const workers = row.workers ?? [];
      if (workers.length === 0) {
        if (row.headcount > 0 || row.laborHours > 0) {
          out.push({
            key: `${row.id}-summary`,
            startTime: null,
            endTime: null,
            hours: row.laborHours,
            personLabel: "",
            buildLabel: defaultLabel,
            absence: null,
            summaryOnly: true,
          });
        }
        continue;
      }
      for (const w of workers) {
        const pid = (w.projectId ?? "").trim() || row.projectId;
        const p = projectById.get(pid);
        out.push({
          key: w.id,
          startTime: w.startTime,
          endTime: w.endTime,
          hours: workerLaborHours(w),
          personLabel: (w.label ?? "").trim(),
          buildLabel: p ? projectLabel(p) : defaultLabel,
          absence: isWorkerAbsenceCode(w.absence) ? w.absence : null,
        });
      }
    }
    return out;
  }, [rows, projectById]);

  const totalHeadcount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      const workers = row.workers ?? [];
      n += workers.length > 0 ? workers.length : row.headcount;
    }
    return n;
  }, [rows]);
  const totalRh = useMemo(() => {
    let sum = 0;
    for (const row of rows) {
      const workers = row.workers ?? [];
      sum +=
        workers.length > 0 ? totalLaborHours(workers) : row.laborHours;
    }
    return sum;
  }, [rows]);

  const flatEquipment = useMemo(() => {
    const out: {
      key: string;
      label: string;
      quantity: number;
      hours: number;
      buildLabel: string;
    }[] = [];
    for (const row of rows) {
      const project = projectById.get(row.projectId);
      const build = project ? projectLabel(project) : "Budowa";
      for (const e of equipmentByAttendance.get(row.id) ?? []) {
        out.push({
          key: e.id,
          label:
            e.equipmentLabel ||
            (isEquipmentPresetKey(e.equipmentKey)
              ? EQUIPMENT_PRESET_LABEL[e.equipmentKey]
              : e.equipmentKey),
          quantity: e.quantity,
          hours: e.hours,
          buildLabel: build,
        });
      }
    }
    return out;
  }, [rows, equipmentByAttendance, projectById]);

  const [noteDrafts, setNoteDrafts] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.note ?? ""])),
  );

  const allConfirmed =
    rows.length > 0 && rows.every((r) => r.status === "confirmed");

  const persistNotes = () => {
    for (const row of rows) {
      const next = (noteDrafts[row.id] ?? "").trim();
      if (next !== (row.note ?? "").trim()) {
        onSaveNote(row.id, next);
      }
    }
  };

  const setStatus = (status: "declared" | "confirmed") => {
    persistNotes();
    onSetStatus(status);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9200] flex items-end justify-center bg-black/50 sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-3xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
            <ClipboardList size={14} className="shrink-0 text-accent" />
            <span className="truncate">Obecność — {crewLabel}</span>
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

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            Brak oświadczeń na ten dzień.
          </p>
        ) : (
          <div className="space-y-3">
            <InfoField label="Dzień">
              <p className="rounded-lg border border-line/60 bg-surface-raised/40 px-3 py-2 text-sm text-ink">
                {formatPlDate(workDate)}
              </p>
            </InfoField>

            <InfoField label="Brygada">
              <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-raised/40 px-3 py-2 text-sm text-ink">
                {crew ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: crew.color }}
                    aria-hidden
                  />
                ) : null}
                <span className="truncate">
                  {crew?.name ?? crewLabel}
                  {crew?.company ? (
                    <span className="text-ink-faint"> · {crew.company}</span>
                  ) : null}
                </span>
              </div>
            </InfoField>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Osoby na budowie
                </p>
                <p className="text-[11px] text-ink-faint">
                  {totalHeadcount} os. · {formatRh(totalRh)} RH
                </p>
              </div>
              {people.length === 0 ? (
                <p className="rounded-lg border border-line/50 bg-surface-raised/20 px-3 py-2 text-[12px] text-ink-faint">
                  Brak osób.
                </p>
              ) : (
                <ul className="overflow-x-auto rounded-lg border border-line/70 thin-scrollbar">
                  {people.map((person, index) => (
                    <li
                      key={person.key}
                      className="flex min-w-[32rem] items-center gap-2 border-b border-line/50 bg-surface-raised/30 px-2.5 py-1.5 text-[12px] last:border-b-0"
                    >
                      <span className="w-4 shrink-0 text-center font-semibold tabular-nums text-ink-faint">
                        {index + 1}
                      </span>
                      {person.summaryOnly ? (
                        <span className="min-w-0 shrink text-ink-faint">
                          bez rozbicia na godziny
                        </span>
                      ) : person.absence ? (
                        <span
                          className="inline-flex shrink-0 items-center gap-1.5"
                          title={WORKER_ABSENCE_LABEL[person.absence]}
                        >
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">
                            {person.absence}
                          </span>
                          <span className="text-[11px] text-ink-faint">
                            {WORKER_ABSENCE_LABEL[person.absence]}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
                          <span className="font-semibold text-ink">
                            {person.startTime}
                          </span>
                          <span className="text-ink-faint">→</span>
                          <span className="font-semibold text-ink">
                            {person.endTime}
                          </span>
                        </span>
                      )}
                      <span
                        className={`w-[7.5rem] shrink-0 truncate ${
                          person.personLabel
                            ? "font-medium text-ink"
                            : "text-ink-faint"
                        }`}
                        title={person.personLabel || undefined}
                      >
                        {person.personLabel || "—"}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-[11px] text-ink-faint"
                        title={person.buildLabel}
                      >
                        [{person.buildLabel}]
                      </span>
                      <span className="w-8 shrink-0 text-right tabular-nums text-ink-faint">
                        {formatRh(person.hours)}h
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Sprzęt ciężki
              </p>
              {flatEquipment.length === 0 ? (
                <p className="text-[12px] text-ink-faint">Brak sprzętu.</p>
              ) : (
                <ul className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line/70">
                  {flatEquipment.map((e) => (
                    <li
                      key={e.key}
                      className="flex items-center gap-2 bg-surface-raised/30 px-2.5 py-1.5 text-[12px] text-ink"
                    >
                      <Wrench
                        size={12}
                        className="shrink-0 text-ink-faint"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {e.label}
                        {rows.length > 1 ? (
                          <span className="text-ink-faint">
                            {" "}
                            [{e.buildLabel}]
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-faint">
                        {e.quantity}× · {formatRh(e.hours)}h
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {rows.map((row) => {
              const project = projectById.get(row.projectId);
              const note = noteDrafts[row.id] ?? "";
              const showBuildInNote = rows.length > 1;
              return (
                <div key={row.id} className="space-y-2">
                  <InfoField
                    label={
                      showBuildInNote
                        ? `Notatka — ${project ? projectLabel(project) : "budowa"}`
                        : "Notatka (opcjonalnie)"
                    }
                  >
                    <textarea
                      value={note}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [row.id]: e.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                      placeholder="Opcjonalnie…"
                    />
                  </InfoField>
                  {onEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        persistNotes();
                        onEdit(row);
                      }}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
                    >
                      <Pencil size={12} />
                      Edytuj oświadczenie
                      {showBuildInNote && project
                        ? ` (${projectLabel(project)})`
                        : ""}
                    </button>
                  ) : null}
                </div>
              );
            })}

            <div className="space-y-1.5 border-t border-line/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Status
              </p>
              <div
                className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-raised/60 p-1"
                role="group"
                aria-label="Status potwierdzenia"
              >
                <button
                  type="button"
                  onClick={() => setStatus("confirmed")}
                  className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold transition ${
                    allConfirmed
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "text-ink-faint hover:bg-surface-overlay hover:text-ink"
                  }`}
                >
                  <Check size={13} />
                  Potwierdzam
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("declared")}
                  className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold transition ${
                    !allConfirmed
                      ? "bg-surface-overlay text-ink"
                      : "text-ink-faint hover:bg-surface-overlay hover:text-ink"
                  }`}
                >
                  Nie potwierdzam
                </button>
              </div>
              <p className="text-[11px] text-ink-faint">
                {allConfirmed
                  ? "Oświadczenie jest potwierdzone."
                  : "Oświadczenie zapisane — jeszcze niepotwierdzone."}
              </p>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t border-line/60 pt-3">
          <button
            type="button"
            onClick={() => {
              persistNotes();
              onClose();
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          >
            Gotowe
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InfoField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}
